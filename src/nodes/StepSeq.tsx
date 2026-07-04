import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { getScheduler } from '../audio/engine';
import { playDrumHit } from '../audio/playNote';
import { midiToName, noteToMidi } from '../ui/pianoRollHelpers';
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
//
// PITCH por paso (A2): una pista puede volverse MELÓDICA (toggle ♪). Entonces se emite
// como `note("c3 ~ eb3 ~").s("cb")` (note() re-afina el sample: 808 afinado, cowbell
// melódico). Cada paso encendido lleva su nota (arrastre vertical en la sub-fila de
// pitch). Sin pitch la pista queda IDÉNTICA a hoy.

// niveles de velocity (valor de gain). Ghost/normal/acento; el ciclo pasa por estos.
const NORMAL = 1, ACCENT = 1.4, GHOST = 0.5;
const nextLevel = (v: number) => (Math.abs(v - NORMAL) < 0.01 ? ACCENT : Math.abs(v - ACCENT) < 0.01 ? GHOST : NORMAL);
const DEFAULT_NOTE = 'c3'; // nota por defecto al afinar una pista
const PITCH_LO = 36, PITCH_RANGE = 36; // rango de afinación de la sub-fila: c2..c5
const PX_PER_SEMI = 6; // píxeles de arrastre vertical por semitono (afinado fluido/orgánico)
// SCALE-LOCK: al afinar, el arrastre se ENGANCHA a una tonalidad (los bajos/808/stabs no
// se desafinan). 'libre' = sin bloqueo.
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES: Record<string, number[]> = {
  menor: [0, 2, 3, 5, 7, 8, 10], mayor: [0, 2, 4, 5, 7, 9, 11],
  'menor pent': [0, 3, 5, 7, 10], 'mayor pent': [0, 2, 4, 7, 9],
  dórica: [0, 2, 3, 5, 7, 9, 10], frigia: [0, 1, 3, 5, 7, 8, 10], 'menor arm': [0, 2, 3, 5, 7, 8, 11],
};
function snapToScale(midi: number, root: number, name: string): number {
  const iv = SCALES[name];
  if (!iv) return midi;
  const set = iv.map((i) => (root + i) % 12);
  for (let d = 0; d < 12; d++) {
    if (set.includes((((midi + d) % 12) + 12) % 12)) return midi + d;
    if (set.includes((((midi - d) % 12) + 12) % 12)) return midi - d;
  }
  return midi;
}
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

interface Lane { sound: string; steps: number[]; notes: (string | null)[]; ratchet: number[] } // steps[i]=0(off)|gain · notes[i]=nota|null · ratchet[i]=1|2|3|4 (roll/tresillo)
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
// niveles de velocity (gains[i]) y notas (notes[i]) por posición. Marca `complex` si hay
// tokens con corchetes o longitudes dispares.
function lanesFromToks(toks: string[][], gainsPerSub: (number[] | null)[], notesPerSub: ((string | null)[] | null)[]): { lanes: Lane[]; steps: number; complex: boolean } {
  const steps = Math.max(1, ...toks.map((t) => t.length));
  let complex = false;
  for (const t of toks) {
    if (t.length !== steps) complex = true;
    for (const tk of t) if (tk !== '~' && isComplex(tk)) complex = true;
  }
  const laneMap = new Map<string, number[]>();
  const noteMap = new Map<string, (string | null)[]>();
  const ratchMap = new Map<string, number[]>();
  if (!complex) {
    toks.forEach((t, si) => {
      const gains = gainsPerSub[si];
      const notes = notesPerSub[si];
      for (let i = 0; i < steps; i++) {
        const tk = t[i];
        if (!tk || tk === '~') continue;
        const snd = soundOf(tk);
        if (!snd) continue;
        if (!laneMap.has(snd)) { laneMap.set(snd, Array(steps).fill(0)); noteMap.set(snd, Array(steps).fill(null)); ratchMap.set(snd, Array(steps).fill(1)); }
        laneMap.get(snd)![i] = gains && isFinite(gains[i]) ? gains[i] : NORMAL;
        if (notes && notes[i]) noteMap.get(snd)![i] = notes[i];
        const rm = /\*(\d+)$/.exec(tk); if (rm) ratchMap.get(snd)![i] = Math.max(1, Math.min(8, Number(rm[1]))); // roll por paso
      }
    });
  }
  const lanes: Lane[] = [...laneMap.entries()].map(([sound, steps2]) => ({ sound, steps: steps2, notes: noteMap.get(sound)!, ratchet: ratchMap.get(sound)! }));
  return { lanes, steps, complex };
}

// forma STACK: stack(seg, seg, …)<tail>. Cada seg es `s("…")[.gain("…")]` (percusión) o
// `note("…").s("snd")[.gain("…")]` (pista melódica/afinada).
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
  const notes: ((string | null)[] | null)[] = [];
  for (const seg of segs) {
    const gM = /\.gain\(\s*"([^"]*)"\s*\)/.exec(seg);
    const gain = gM ? gM[1].trim().split(/\s+/).map((x) => Number(x)).map((n) => (isFinite(n) ? n : 1)) : null;
    const noteM = /\bnote\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(seg);
    if (noteM) {
      // pista afinada: note("…").s("snd") → presencia por posición + notas aparte.
      const sM = /\.s(?:ound)?\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/.exec(seg);
      if (!sM) return null;
      const nt = expand(noteM[1]);
      toks.push(nt.map((t) => (t === '~' ? '~' : sM[1] + (/\*\d+$/.exec(t)?.[0] ?? '')))); // conserva *N (roll) en la presencia
      notes.push(nt.map((t) => (t === '~' ? null : t.replace(/\*\d+$/, ''))));
      gains.push(gain);
    } else {
      const sM = /\bs(?:ound)?\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(seg);
      if (!sM) return null; // segmento no es un s("…") → deja el patrón como avanzado
      toks.push(expand(sM[1]));
      notes.push(null);
      gains.push(gain);
    }
  }
  const { lanes, steps, complex } = lanesFromToks(toks, gains, notes);
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
  const { lanes, steps, complex } = lanesFromToks(toks, toks.map(() => null), toks.map(() => null));
  return { bank, tail, lanes, steps, complex };
}

export function parseSeq(code: string): Parsed | null {
  const t = code.trim();
  if (/^stack\s*\(/.test(t)) return parseStackForm(t);
  return parseSimpleForm(code);
}

// ¿la pista está afinada? (algún paso encendido tiene nota)
function lanePitched(l: Lane, steps: number): boolean {
  return l.steps.slice(0, steps).some((v, i) => v > 0 && !!l.notes[i]);
}
const ratchSfx = (l: Lane, i: number) => (l.ratchet[i] > 1 ? `*${l.ratchet[i]}` : ''); // roll: hh*3
function laneBody(l: Lane, steps: number): string {
  return l.steps.slice(0, steps).map((v, i) => (v > 0 ? l.sound + ratchSfx(l, i) : '~')).join(' ');
}
function laneNotesBody(l: Lane, steps: number): string {
  return l.steps.slice(0, steps).map((v, i) => (v > 0 ? (l.notes[i] || DEFAULT_NOTE) + ratchSfx(l, i) : '~')).join(' ');
}
export function buildSeq(p: Parsed, lanes: Lane[], steps: number): string {
  const active = lanes.filter((l) => l.steps.slice(0, steps).some((v) => v > 0));
  const bankSfx = p.bank ? `.bank("${p.bank}")` : '';
  const tail = p.tail || '';
  if (!active.length) return `s("~")${bankSfx}${tail}`;
  const hasAccent = active.some((l) => l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01));
  const anyPitched = active.some((l) => lanePitched(l, steps));
  if (!hasAccent && !anyPitched) {
    const body = active.map((l) => laneBody(l, steps)).join(', ');
    return `s("${body}")${bankSfx}${tail}`;
  }
  const parts = active.map((l) => {
    const laneAccent = l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01);
    const g = laneAccent ? `.gain("${l.steps.slice(0, steps).map((v) => (v > 0 ? fmt(v) : '1')).join(' ')}")` : '';
    // pista afinada → note("…").s("snd") (note re-afina el sample); si no, s("…").
    if (lanePitched(l, steps)) return `note("${laneNotesBody(l, steps)}").s("${l.sound}")${g}`;
    return `s("${laneBody(l, steps)}")${g}`;
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
  const [pitchOpen, setPitchOpen] = useState<Record<string, boolean>>({});
  const [scaleName, setScaleName] = useState('off'); // escala para el scale-lock ('off' = libre)
  const [scaleRoot, setScaleRoot] = useState(0); // tónica de la escala (0 = C)
  const drawing = useRef<number | null>(null); // valor que se está pintando (0 o NORMAL)
  const dragPitch = useRef<{ li: number; si: number; startY: number; startMidi: number } | null>(null); // arrastre de pitch activo
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
    const up = () => { drawing.current = null; dragPitch.current = null; };
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
        <button className="seqs-norm" onClick={() => { const base = parsed.lanes[0]?.sound || 'bd'; update(id, { code: buildSeq(parsed, [{ sound: base, steps: Array(8).fill(0), notes: Array(8).fill(null), ratchet: Array(8).fill(1) }], 8) }); }}>empezar rejilla de 8 pasos</button>
      </div>
    );
  }

  const commit = (nl: Lane[], ns = steps) => update(id, { code: buildSeq(parsed, nl, ns) });
  const paint = (li: number, si: number, val: number) => {
    const nl = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((v, j) => (j === si ? val : v)) } : l));
    setLanes(nl); commit(nl);
    if (val > 0) void playDrumHit(lanes[li].sound, bank, lanes[li].notes[si] ?? undefined, 0.5, 0.9 * val);
  };
  // clic derecho en celda ENCENDIDA: cicla el nivel de velocity (normal→acento→ghost).
  const cycleLevel = (li: number, si: number) => {
    const cur = lanes[li].steps[si];
    if (cur <= 0) return;
    const nv = nextLevel(cur);
    const nl = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((v, j) => (j === si ? nv : v)) } : l));
    setLanes(nl); commit(nl);
    void playDrumHit(lanes[li].sound, bank, lanes[li].notes[si] ?? undefined, 0.5, 0.9 * nv);
  };
  // shift+clic en celda encendida: cicla el RATCHET (roll/tresillo) 1→2→3→4 → hh*n.
  const cycleRatchet = (li: number, si: number) => {
    if (lanes[li].steps[si] <= 0) return;
    const cur = lanes[li].ratchet[si] || 1;
    const RATCHETS = [1, 2, 3, 4];
    const nv = RATCHETS[(RATCHETS.indexOf(cur) + 1) % RATCHETS.length] ?? 1;
    const nl = lanes.map((l, i) => (i === li ? { ...l, ratchet: l.ratchet.map((v, j) => (j === si ? nv : v)) } : l));
    setLanes(nl); commit(nl);
    void playDrumHit(lanes[li].sound, bank, lanes[li].notes[si] ?? undefined, 0.5, 0.85);
  };
  const addLane = (snd: string) => {
    setAdding(false);
    if (lanes.some((l) => l.sound === snd)) return;
    const nl = [...lanes, { sound: snd, steps: Array(steps).fill(0), notes: Array(steps).fill(null), ratchet: Array(steps).fill(1) }];
    setLanes(nl);
    void playDrumHit(snd, bank);
  };
  const removeLane = (li: number) => { const nl = lanes.filter((_, i) => i !== li); setLanes(nl); commit(nl); };
  const setStepCount = (n: number) => {
    const c = Math.max(2, Math.min(32, n));
    const nl = lanes.map((l) => {
      const s = l.steps.slice(0, c); while (s.length < c) s.push(0);
      const nt = l.notes.slice(0, c); while (nt.length < c) nt.push(null);
      const rt = l.ratchet.slice(0, c); while (rt.length < c) rt.push(1);
      return { ...l, steps: s, notes: nt, ratchet: rt };
    });
    setLanes(nl); setSteps(c); commit(nl, c);
  };
  // afinar/desafinar una pista: al activar, cada paso encendido toma DEFAULT_NOTE (y se
  // abre la sub-fila de pitch); al desactivar, se limpian las notas → idéntico a hoy.
  const togglePitch = (li: number) => {
    const l = lanes[li];
    const pitched = lanePitched(l, steps);
    const nl = lanes.map((x, i) => (i === li
      ? { ...x, notes: x.steps.map((v, j) => (pitched ? null : (v > 0 ? (x.notes[j] || DEFAULT_NOTE) : null))) }
      : x));
    setLanes(nl); commit(nl);
    setPitchOpen((o) => ({ ...o, [l.sound]: !pitched }));
  };
  // afinar por paso: CLIC + ARRASTRE VERTICAL relativo (tipo perilla). Con captura de
  // puntero se arrastra libremente arriba/abajo y el pitch sube/baja fluido. scale-lock engancha.
  const setNoteAt = (li: number, si: number, nn: string) => {
    if (lanes[li].notes[si] === nn) return;
    const nl = lanes.map((l, i) => (i === li ? { ...l, notes: l.notes.map((v, j) => (j === si ? nn : v)) } : l));
    setLanes(nl); commit(nl);
  };
  const clampMidi = (m: number) => Math.max(PITCH_LO, Math.min(PITCH_LO + PITCH_RANGE, m));
  const startPitchDrag = (li: number, si: number, e: React.PointerEvent) => {
    if (lanes[li].steps[si] <= 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragPitch.current = { li, si, startY: e.clientY, startMidi: noteToMidi(lanes[li].notes[si] || DEFAULT_NOTE) ?? PITCH_LO + 12 };
    void playDrumHit(lanes[li].sound, bank, lanes[li].notes[si] ?? DEFAULT_NOTE, 0.35, 0.7);
  };
  const movePitchDrag = (clientY: number) => {
    const d = dragPitch.current; if (!d) return;
    let midi = clampMidi(d.startMidi + Math.round((d.startY - clientY) / PX_PER_SEMI));
    if (scaleName !== 'off') midi = snapToScale(midi, scaleRoot, scaleName);
    setNoteAt(d.li, d.si, midiToName(midi));
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
        {lanes.some((l) => lanePitched(l, steps)) && (
          <div className="seqs-scale" title="scale-lock: al arrastrar ↕ para afinar, las notas se quedan en esta tonalidad (no se desafinan). «libre» = sin bloqueo.">
            <span>escala</span>
            <select className="nodrag" value={scaleRoot} onChange={(e) => setScaleRoot(Number(e.target.value))}>{ROOTS.map((r, i) => <option key={i} value={i}>{r}</option>)}</select>
            <select className="nodrag" value={scaleName} onChange={(e) => setScaleName(e.target.value)}><option value="off">libre</option>{Object.keys(SCALES).map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
        )}
      </div>

      <LiveScope nodeId={id} height={36} />

      <div className="seqs-lanes">
        {lanes.map((l, li) => {
          const pitched = lanePitched(l, steps);
          const open = pitched || pitchOpen[l.sound];
          return (
            <div className="seqs-lane" key={l.sound}>
              <button className="seqs-name" onClick={() => void playDrumHit(l.sound, bank)} title="escuchar este sonido">
                {laneLabel(l.sound)}
                <span className={`seqs-pitchtog${pitched ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); togglePitch(li); }} title="afinar por paso (pista melódica): 808 afinado, cowbell melódico">♪</span>
                <span className="seqs-rm" onClick={(e) => { e.stopPropagation(); removeLane(li); }} title="quitar pista">×</span>
              </button>
              <div className="seqs-lane-body">
                <div className="seqs-row" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
                  {l.steps.slice(0, steps).map((v, si) => (
                    <button
                      key={si}
                      className={`seqs-cell${lvlClass(v)}${si === head ? ' play' : ''}${si % 4 === 0 ? ' beat' : ''}`}
                      onPointerDown={(e) => { if (e.shiftKey && v > 0) { cycleRatchet(li, si); return; } const nv = v > 0 ? 0 : NORMAL; drawing.current = nv; paint(li, si, nv); }}
                      onPointerEnter={() => { if (drawing.current != null) paint(li, si, drawing.current); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); cycleLevel(li, si); }}
                      title={`${laneLabel(l.sound)} · paso ${si + 1}${v > 0 ? ` · ${Math.abs(v - ACCENT) < 0.01 ? 'acento' : Math.abs(v - GHOST) < 0.01 ? 'ghost' : 'normal'}${l.ratchet[si] > 1 ? ` · roll x${l.ratchet[si]}` : ''} (clic der. = vel · shift+clic = roll)` : ''}`}
                    >
                      {v > 0 && l.ratchet[si] > 1 && <span className="seqs-ratch">{l.ratchet[si]}</span>}
                    </button>
                  ))}
                </div>
                {open && (
                  <>
                  <div className="seqs-pitch-h"><span>↕ afinar cada paso</span><button className="seqs-pitch-x" onClick={() => togglePitch(li)} title="salir del afinador (volver a percusión)">✕ salir</button></div>
                  <div className="seqs-pitch" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
                    {l.steps.slice(0, steps).map((v, si) => {
                      const on = v > 0;
                      const nn = l.notes[si] || DEFAULT_NOTE;
                      const midi = on ? (noteToMidi(nn) ?? PITCH_LO) : PITCH_LO;
                      const t = Math.max(0, Math.min(1, (midi - PITCH_LO) / PITCH_RANGE));
                      return (
                        <div
                          key={si}
                          className={`seqs-pcell${on ? '' : ' rest'}${si % 4 === 0 ? ' beat' : ''}`}
                          onPointerDown={(e) => startPitchDrag(li, si, e)}
                          onPointerMove={(e) => movePitchDrag(e.clientY)}
                          onPointerUp={() => { dragPitch.current = null; }}
                          title={on ? `nota paso ${si + 1}: ${nn} · clic y arrastra ↕ para afinar` : ''}
                        >
                          {on && <><span className="seqs-pfill" style={{ height: `${Math.max(8, t * 100)}%` }} /><span className="seqs-pname">{nn}</span></>}
                        </div>
                      );
                    })}
                  </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
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
      <p className="seqs-hint">clic = golpe (arrastra) · clic der. = acento/ghost · shift+clic = roll/tresillo (×2/3/4) · ♪ = afinar por paso · «+ añadir sonido» · ▶/espacio = escuchar</p>
    </div>
  );
}
