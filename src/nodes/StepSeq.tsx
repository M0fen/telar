import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { getScheduler } from '../audio/engine';
import { playDrumHit } from '../audio/playNote';
import { LiveScope } from './LiveScope';

// SECUENCIADOR por source (unificado): edita el patrón como una rejilla multi-sonido,
// tipo drum-machine/LFO. Permite AÑADIR golpes y AÑADIR OTROS SONIDOS (el "tu" y el
// "pa") por paso, ver cómo se desarrolla el sonido y previsualizar al instante (clic en
// celda = suena ese golpe; ▶/espacio = aísla y reproduce el patrón en bucle). Absorbe la
// idea de la rejilla de silencios (celda apagada = silencio) y la amplía.
//
// VELOCITY por paso: clic derecho en una celda encendida cicla su nivel — normal →
// acento (más fuerte) → ghost (más flojo). Mientras todo esté a nivel normal se emite el
// patrón simple `s("a ~, ~ b")`; en cuanto hay un acento se emite `stack(s("…").gain("…"),
// …)` con un `.gain` por pista (se multiplica con el del canal, así que compone bien).

// niveles de velocity (valor de gain). Ghost/normal/acento; el ciclo pasa por estos.
const NORMAL = 1, ACCENT = 1.4, GHOST = 0.5;
const nextLevel = (v: number) => (Math.abs(v - NORMAL) < 0.01 ? ACCENT : Math.abs(v - ACCENT) < 0.01 ? GHOST : NORMAL);
function fmt(n: number): string {
  if (!isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// paleta de sonidos para añadir pistas (nombres del banco de batería).
const PALETTE: { s: string; label: string }[] = [
  { s: 'bd', label: 'bombo' }, { s: 'sd', label: 'caja' }, { s: 'rim', label: 'rim' },
  { s: 'cp', label: 'clap' }, { s: 'hh', label: 'hat' }, { s: 'oh', label: 'open' },
  { s: 'lt', label: 'tom-b' }, { s: 'mt', label: 'tom-m' }, { s: 'ht', label: 'tom-a' },
  { s: 'cb', label: 'cowbell' }, { s: 'cr', label: 'crash' }, { s: 'rd', label: 'ride' },
];

interface Lane { sound: string; steps: number[] } // steps[i] = 0 (off) | valor de gain
interface Parsed { bank: string; tail: string; lanes: Lane[]; steps: number; complex: boolean }

function splitTop(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const c of s) {
    if (c === '[' || c === '<' || c === '(') { depth++; cur += c; }
    else if (c === ']' || c === '>' || c === ')') { depth--; cur += c; }
    else if (c === sep && depth === 0) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function tokenize(pat: string): string[] {
  return splitTop(pat.trim().replace(/\s+/g, ' '), ' ').map((t) => t.trim()).filter(Boolean);
}
const soundOf = (tok: string) => tok.replace(/\*\d+$/, '').trim();
const isComplex = (tok: string) => /[[\]<>()]/.test(tok);

// tokens de un sublane; expande un único `X*N` a N pasos.
function expand(sl: string): string[] {
  let t = tokenize(sl);
  if (t.length === 1 && /^[A-Za-z][\w:]*\*\d+$/.test(t[0])) {
    const [, base, n] = /^([A-Za-z][\w:]*)\*(\d+)$/.exec(t[0])!;
    t = Array.from({ length: Math.min(32, Number(n)) }, () => base);
  }
  return t;
}

// separa el sufijo de FX tras la llamada `s("…")` o `stack(…)`. Extrae el banco (se
// re-aplica aparte) y devuelve el resto de la cadena tal cual.
function splitTail(tailRaw: string): { bank: string; tail: string } {
  const bankM = /\.bank\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(tailRaw);
  const bank = bankM ? bankM[1] : '';
  const tail = bankM ? tailRaw.slice(0, bankM.index) + tailRaw.slice(bankM.index + bankM[0].length) : tailRaw;
  return { bank, tail: tail.trim() };
}

// construye lanes agrupando por sonido a partir de sublanes ya tokenizados, con sus
// niveles de velocity (gains[i] por posición, def 1). Marca `complex` si hay tokens con
// corchetes o longitudes dispares.
function lanesFromToks(toks: string[][], gainsPerSub: (number[] | null)[]): { lanes: Lane[]; steps: number; complex: boolean } {
  const steps = Math.max(1, ...toks.map((t) => t.length));
  let complex = false;
  for (const t of toks) {
    if (t.length !== steps) complex = true;
    for (const tk of t) if (tk !== '~' && isComplex(tk)) complex = true;
  }
  const laneMap = new Map<string, number[]>();
  if (!complex) {
    toks.forEach((t, si) => {
      const gains = gainsPerSub[si];
      for (let i = 0; i < steps; i++) {
        const tk = t[i];
        if (!tk || tk === '~') continue;
        const snd = soundOf(tk);
        if (!snd) continue;
        if (!laneMap.has(snd)) laneMap.set(snd, Array(steps).fill(0));
        laneMap.get(snd)![i] = gains && isFinite(gains[i]) ? gains[i] : NORMAL;
      }
    });
  }
  const lanes: Lane[] = [...laneMap.entries()].map(([sound, steps2]) => ({ sound, steps: steps2 }));
  return { lanes, steps, complex };
}

// forma STACK (con acentos): stack(s("…").gain("…"), s("…"))<tail>
function parseStackForm(code: string): Parsed | null {
  const open = code.indexOf('(');
  if (open < 0) return null;
  let depth = 0, close = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) return null;
  const inner = code.slice(open + 1, close);
  const { bank, tail } = splitTail(code.slice(close + 1));
  const segs = splitTop(inner, ',').map((s) => s.trim()).filter(Boolean);
  const toks: string[][] = [];
  const gains: (number[] | null)[] = [];
  for (const seg of segs) {
    const sM = /\bs(?:ound)?\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(seg);
    if (!sM) return null; // segmento no es un s("…") → deja el patrón como avanzado
    toks.push(expand(sM[1]));
    const gM = /\.gain\(\s*"([^"]*)"\s*\)/.exec(seg);
    gains.push(gM ? gM[1].trim().split(/\s+/).map((x) => Number(x)).map((n) => (isFinite(n) ? n : 1)) : null);
  }
  const { lanes, steps, complex } = lanesFromToks(toks, gains);
  return { bank, tail, lanes, steps, complex };
}

// forma SIMPLE: s("a ~, ~ b")<tail>
function parseSimpleForm(code: string): Parsed | null {
  const om = /\b(?:s|sound)\(\s*["'`]/.exec(code);
  if (!om) return null;
  const contentStart = om.index + om[0].length;
  const quote = code[contentStart - 1];
  const contentEnd = code.indexOf(quote, contentStart);
  if (contentEnd < 0) return null;
  const content = code.slice(contentStart, contentEnd);
  // salta el cierre `")` y toma el resto como cola de FX.
  let j = contentEnd + 1;
  while (j < code.length && /\s/.test(code[j])) j++;
  if (code[j] === ')') j++;
  const { bank, tail } = splitTail(code.slice(j));
  const sublanes = splitTop(content, ',').map((s) => s.trim()).filter((s) => s.length);
  const toks = sublanes.map(expand);
  const { lanes, steps, complex } = lanesFromToks(toks, toks.map(() => null));
  return { bank, tail, lanes, steps, complex };
}

export function parseSeq(code: string): Parsed | null {
  const t = code.trim();
  if (/^stack\s*\(/.test(t)) return parseStackForm(t);
  return parseSimpleForm(code);
}

function laneBody(l: Lane, steps: number): string {
  return l.steps.slice(0, steps).map((v) => (v > 0 ? l.sound : '~')).join(' ');
}
function buildSeq(p: Parsed, lanes: Lane[], steps: number): string {
  const active = lanes.filter((l) => l.steps.slice(0, steps).some((v) => v > 0));
  const bankSfx = p.bank ? `.bank("${p.bank}")` : '';
  const tail = p.tail || '';
  if (!active.length) return `s("~")${bankSfx}${tail}`;
  const hasAccent = active.some((l) => l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01));
  if (!hasAccent) {
    const body = active.map((l) => laneBody(l, steps)).join(', ');
    return `s("${body}")${bankSfx}${tail}`;
  }
  const parts = active.map((l) => {
    const pat = laneBody(l, steps);
    const laneAccent = l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01);
    const g = laneAccent ? `.gain("${l.steps.slice(0, steps).map((v) => (v > 0 ? fmt(v) : '1')).join(' ')}")` : '';
    return `s("${pat}")${g}`;
  });
  return `stack(${parts.join(', ')})${bankSfx}${tail}`;
}

export function StepSeq({ id, code }: { id: string; code: string }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const parsed = useMemo(() => parseSeq(code), [code]);
  const [steps, setSteps] = useState(() => parsed?.steps || 8);
  const [lanes, setLanes] = useState<Lane[]>(() => parsed?.lanes ?? []);
  const [head, setHead] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState(false);
  const drawing = useRef<number | null>(null); // valor que se está pintando (0 o NORMAL)
  const bank = parsed?.bank || '';

  // resincroniza el estado local si el código cambia por fuera (no en complejo)
  useEffect(() => {
    if (parsed && !parsed.complex) { setLanes(parsed.lanes); setSteps(parsed.steps); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = getScheduler()?.now?.();
      setHead(typeof now === 'number' ? Math.floor((((now % 1) + 1) % 1) * steps) % steps : -1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [steps]);
  useEffect(() => {
    const up = () => { drawing.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // preview: aísla este source (solo) y reproduce. El ESPACIO global reproduce/para
  // el transporte, así que con el source aislado el espacio ya previsualiza sin conflicto.
  const togglePreview = () => {
    const s = useGraphStore.getState();
    const next = !preview;
    setPreview(next);
    s.updateNodeData(id, { solo: next });
    if (next && !s.playing) void s.play();
  };
  // al cerrar el panel, quita el aislado (solo) que hubiera puesto el preview.
  useEffect(() => () => { if (preview) useGraphStore.getState().updateNodeData(id, { solo: false }); }, [id, preview]);

  if (!parsed) return <p className="seqs-none nodrag">este source no tiene un patrón <code>s("…")</code> editable en rejilla</p>;
  if (parsed.complex) {
    return (
      <div className="seqs nodrag" onPointerDown={(e) => e.stopPropagation()}>
        <p className="seqs-none">patrón avanzado (usa [ ] &lt; &gt; …). Empieza una rejilla nueva para editarlo aquí:</p>
        <button className="seqs-norm" onClick={() => { const base = parsed.lanes[0]?.sound || 'bd'; update(id, { code: buildSeq(parsed, [{ sound: base, steps: Array(8).fill(0) }], 8) }); }}>empezar rejilla de 8 pasos</button>
      </div>
    );
  }

  const commit = (nl: Lane[], ns = steps) => update(id, { code: buildSeq(parsed, nl, ns) });
  const paint = (li: number, si: number, val: number) => {
    const nl = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((v, j) => (j === si ? val : v)) } : l));
    setLanes(nl); commit(nl);
    if (val > 0) void playDrumHit(lanes[li].sound, bank, undefined, 0.5, 0.9 * val);
  };
  // clic derecho en celda ENCENDIDA: cicla el nivel de velocity (normal→acento→ghost).
  const cycleLevel = (li: number, si: number) => {
    const cur = lanes[li].steps[si];
    if (cur <= 0) return;
    const nv = nextLevel(cur);
    const nl = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((v, j) => (j === si ? nv : v)) } : l));
    setLanes(nl); commit(nl);
    void playDrumHit(lanes[li].sound, bank, undefined, 0.5, 0.9 * nv);
  };
  const addLane = (snd: string) => {
    setAdding(false);
    if (lanes.some((l) => l.sound === snd)) return;
    const nl = [...lanes, { sound: snd, steps: Array(steps).fill(0) }];
    setLanes(nl);
    void playDrumHit(snd, bank);
  };
  const removeLane = (li: number) => { const nl = lanes.filter((_, i) => i !== li); setLanes(nl); commit(nl); };
  const setStepCount = (n: number) => {
    const c = Math.max(2, Math.min(32, n));
    const nl = lanes.map((l) => { const s = l.steps.slice(0, c); while (s.length < c) s.push(0); return { ...l, steps: s }; });
    setLanes(nl); setSteps(c); commit(nl, c);
  };

  const laneLabel = (snd: string) => PALETTE.find((p) => p.s === snd)?.label ?? snd;
  const lvlClass = (v: number) => (v <= 0 ? '' : Math.abs(v - ACCENT) < 0.01 ? ' on accent' : Math.abs(v - GHOST) < 0.01 ? ' on ghost' : ' on');

  return (
    <div className="seqs nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seqs-ctl">
        <button className={`seqs-play${preview ? ' on' : ''}`} onClick={togglePreview} title="aislar y previsualizar este source (luego ESPACIO reproduce/para)">{preview ? '◉' : '▶'}</button>
        <span className="seqs-tag">secuenciador{bank ? ` · ${bank}` : ''}</span>
        <div className="seqs-steps">
          <button onClick={() => setStepCount(steps - 1)} title="menos pasos">−</button>
          <b>{steps}<i>pasos</i></b>
          <button onClick={() => setStepCount(steps + 1)} title="más pasos">+</button>
        </div>
      </div>

      <LiveScope nodeId={id} height={36} />

      <div className="seqs-lanes">
        {lanes.map((l, li) => (
          <div className="seqs-lane" key={l.sound}>
            <button className="seqs-name" onClick={() => void playDrumHit(l.sound, bank)} title="escuchar este sonido">
              {laneLabel(l.sound)}<span className="seqs-rm" onClick={(e) => { e.stopPropagation(); removeLane(li); }} title="quitar pista">×</span>
            </button>
            <div className="seqs-row" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
              {l.steps.slice(0, steps).map((v, si) => (
                <button
                  key={si}
                  className={`seqs-cell${lvlClass(v)}${si === head ? ' play' : ''}${si % 4 === 0 ? ' beat' : ''}`}
                  onPointerDown={() => { const nv = v > 0 ? 0 : NORMAL; drawing.current = nv; paint(li, si, nv); }}
                  onPointerEnter={() => { if (drawing.current != null) paint(li, si, drawing.current); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); cycleLevel(li, si); }}
                  title={`${laneLabel(l.sound)} · paso ${si + 1}${v > 0 ? ` · ${Math.abs(v - ACCENT) < 0.01 ? 'acento' : Math.abs(v - GHOST) < 0.01 ? 'ghost' : 'normal'} (clic der. cambia)` : ''}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="seqs-add">
        <button className="seqs-addbtn" onClick={() => setAdding((a) => !a)}>+ añadir sonido</button>
        {adding && (
          <div className="seqs-palette">
            {PALETTE.filter((p) => !lanes.some((l) => l.sound === p.s)).map((p) => (
              <button key={p.s} onClick={() => addLane(p.s)} title={`añadir ${p.label}`}>{p.label}</button>
            ))}
          </div>
        )}
      </div>
      <p className="seqs-hint">clic = golpe (arrastra para pintar) · clic derecho = acento/ghost (velocity) · «+ añadir sonido» mete otro tu/pa · ▶/espacio = escuchar aislado</p>
    </div>
  );
}
