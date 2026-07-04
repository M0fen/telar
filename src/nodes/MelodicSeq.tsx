import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import type { NodeData } from '../graph/types';
import { playSynthNote, playDrumHit } from '../audio/playNote';
import { getScheduler } from '../audio/engine';
import { ACCIDENTAL, midiToName, noteToMidi } from '../ui/pianoRollHelpers';
import { LiveScope } from './LiveScope';
import { MiniSlider } from './MiniSlider';

// Secuenciador MELÓDICO por source (unifica con el synth): piano roll inline monofónico
// para colocar NOTAS por paso con la octava correcta, viendo la onda en vivo y oyendo
// el TIMBRE real al colocar. Edita el `note("…")` del código conservando el resto
// (s, synth, efectos). Resuelve el problema del teclado del synth (una sola nota / se
// re-pitcheaba): aquí ubicas cada nota con precisión.
//
// PRODUCCIÓN por paso (como un LFO/automatización): además de la nota, cada paso tiene
// VELOCITY (volumen) y DURACIÓN (gate/legato) editables arrastrando barras. Se emiten
// como patrones paralelos `.gain("…")` y `.clip("…")` alineados a los pasos (el .gain
// se MULTIPLICA con el del canal, así que compone bien). Se ocultan por defecto para no
// saturar; se abren con «vel/dur».

// formatea un número para la mini-notación (sin ceros de más): 1 → "1", 0.5 → "0.5".
function fmt(n: number): string {
  if (!isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
// alinea un array de números a `len` pasos (rellena con `def`, recorta el sobrante).
function alignNums(src: number[] | null | undefined, len: number, def: number): number[] {
  const out = (src ?? []).slice(0, len);
  while (out.length < len) out.push(def);
  return out;
}
// extrae un patrón por-paso `.method("a b c")` (entrecomillado). Devuelve los tokens y
// el código SIN esa llamada. Un `.gain(0.5)` escalar (sin comillas) NO se toca.
function extractPat(code: string, method: string): { code: string; toks: number[] | null } {
  const re = new RegExp('\\.' + method + '\\(\\s*"([^"]*)"\\s*\\)');
  const m = re.exec(code);
  if (!m) return { code, toks: null };
  const toks = m[1].trim() ? m[1].trim().split(/\s+/).map((t) => (t === '~' ? 1 : Number(t))).map((n) => (isFinite(n) ? n : 1)) : [];
  return { code: code.slice(0, m.index) + code.slice(m.index + m[0].length), toks: toks.length ? toks : null };
}
// extrae un `.method(<número>)` ESCALAR (p.ej. `.slide(0.3)`). Devuelve el valor y el
// código sin esa llamada. Distinto de extractPat (que parsea patrones "a b c" por paso).
function extractScalar(code: string, method: string): { code: string; val: number } {
  const re = new RegExp('\\.' + method + '\\(\\s*([0-9.]+)\\s*\\)');
  const m = re.exec(code);
  if (!m) return { code, val: 0 };
  const val = Number(m[1]);
  return { code: code.slice(0, m.index) + code.slice(m.index + m[0].length), val: isFinite(val) ? val : 0 };
}

interface MelParsed { pre: string; post: string; sName: string | null; bank: string; wave: string | null; tokens: string[]; vels: number[] | null; gates: number[] | null; slide: number }

function parseMel(code: string): MelParsed | null {
  // primero retira nuestros patrones de vel/dur (van al final); luego parsea la nota.
  const g = extractPat(code, 'gain');
  const c = extractPat(g.code, 'clip');
  const sl = extractScalar(c.code, 'slide');
  const base = sl.code;
  const om = /(?:\.)?\b(?:note|n)\(\s*["'`]/.exec(base);
  if (!om) return null;
  const cs = om.index + om[0].length;
  const q = base[cs - 1];
  const ce = base.indexOf(q, cs);
  if (ce < 0) return null;
  const content = base.slice(cs, ce);
  const pre = base.slice(0, cs);
  const post = base.slice(ce);
  const sM = /\bs(?:ound)?\(\s*["'`]([^"'`]+)/.exec(base);
  const sName = sM ? (sM[1].match(/[A-Za-z0-9_]+/)?.[0] ?? null) : null;
  const bankM = /\.bank\(\s*["'`]([^"'`]+)/.exec(base);
  const bank = bankM ? bankM[1] : '';
  const wave = sName && ['sawtooth', 'square', 'triangle', 'sine', 'supersaw'].includes(sName) ? sName : null;
  const tokens = content.trim() ? content.trim().split(/\s+/) : [];
  return { pre, post, sName, bank, wave, tokens, vels: g.toks, gates: c.toks, slide: sl.val };
}
function buildMel(p: MelParsed, cells: string[], vels: number[], gates: number[], slide: number): string {
  const body = cells.some((c) => c !== '~') ? cells.join(' ') : '~';
  let out = p.pre + body + p.post;
  if (vels.some((v) => Math.abs(v - 1) > 0.001)) out += `.gain("${vels.map(fmt).join(' ')}")`;
  if (gates.some((g) => Math.abs(g - 1) > 0.001)) out += `.clip("${gates.map(fmt).join(' ')}")`;
  if (slide > 0.005) out += `.slide(${slide.toFixed(2)})`; // 808: portamento entre notas contiguas
  return out;
}

interface Row { val: string; midi: number; acc: boolean; root: boolean }

export function MelodicSeq({ id, code }: { id: string; code: string }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const parsed = useMemo(() => parseMel(code), [code]);
  const [oct, setOct] = useState(3);
  const [steps, setSteps] = useState(() => Math.max(1, Math.min(32, parsed?.tokens.length || 8)));
  const [head, setHead] = useState(-1);
  const [preview, setPreview] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const drawing = useRef<{ note: string } | null>(null);
  const dragLane = useRef<'vel' | 'gate' | null>(null);

  useEffect(() => { if (parsed?.tokens.length) setSteps((s) => Math.max(s, Math.min(32, parsed.tokens.length))); }, [parsed?.tokens.length]);
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
    const up = () => { drawing.current = null; dragLane.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  useEffect(() => () => { if (preview) useGraphStore.getState().updateNodeData(id, { solo: false }); }, [id, preview]);

  const cells = useMemo(() => {
    const arr = (parsed?.tokens ?? []).slice(0, steps);
    while (arr.length < steps) arr.push('~');
    return arr;
  }, [parsed?.tokens, steps]);
  const vels = useMemo(() => alignNums(parsed?.vels, steps, 1), [parsed?.vels, steps]);
  const gates = useMemo(() => alignNums(parsed?.gates, steps, 1), [parsed?.gates, steps]);

  // filas: 2 octavas cromáticas desde la octava base
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const lo = (oct + 1) * 12;
    for (let m = lo + 23; m >= lo; m--) {
      const pc = ((m % 12) + 12) % 12;
      out.push({ val: midiToName(m), midi: m, acc: ACCIDENTAL.has(pc), root: pc === 0 });
    }
    return out;
  }, [oct]);

  // audición: con el TIMBRE del source (synth activo → oscilador; sample melódico →
  // el sample pitcheado; si no, un sawtooth) para que la nota suene a lo que se oirá.
  const audit = (row: Row, vel = 0.9) => {
    const d = useGraphStore.getState().nodes.find((n) => n.id === id)?.data as NodeData | undefined;
    if (d?.synthOn && d.synth) { void playSynthNote(d.synth, row.midi, 0.6, id); return; }
    if (parsed?.sName && !parsed.wave) { void playDrumHit(parsed.sName, parsed.bank, row.val, 0.5, vel); return; }
    void playSynthNote({ wave: parsed?.wave ?? 'sawtooth' }, row.midi, 0.6, id);
  };

  const slide = parsed?.slide ?? 0; // portamento de pista (0 = sin slide)
  const commit = (nc: string[], nv: number[], ng: number[], sl: number = slide) => { if (parsed) update(id, { code: buildMel(parsed, nc, nv, ng, sl) }); };
  const place = (col: number, row: Row) => {
    const next = cells.slice();
    const on = noteToMidi(next[col]) === row.midi;
    next[col] = on ? '~' : row.val;
    if (!on) audit(row, vels[col] ?? 0.9);
    commit(next, vels, gates);
  };
  const paintTo = (col: number, row: Row) => { const next = cells.slice(); next[col] = row.val; commit(next, vels, gates); };
  const setStepCount = (n: number) => {
    const c = Math.max(2, Math.min(32, n));
    const nc = cells.slice(0, c).concat(Array(Math.max(0, c - cells.length)).fill('~'));
    commit(nc, alignNums(vels, c, 1), alignNums(gates, c, 1));
    setSteps(c);
  };
  const togglePreview = () => { const s = useGraphStore.getState(); const nx = !preview; setPreview(nx); s.updateNodeData(id, { solo: nx }); if (nx && !s.playing) void s.play(); };
  const clearAll = () => commit(Array(steps).fill('~'), Array(steps).fill(1), Array(steps).fill(1));

  // arrastre de una barra de automatización: valor por posición vertical dentro de la
  // celda (arriba = máximo). vel 0..1 · gate 0.2..2 (1 = paso completo).
  const setAuto = (lane: 'vel' | 'gate', col: number, clientY: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    if (lane === 'vel') {
      const nv = vels.slice(); nv[col] = Math.round(t * 100) / 100; commit(cells, nv, gates);
    } else {
      const ng = gates.slice(); ng[col] = Math.round(Math.max(0.2, t * 2) * 100) / 100; commit(cells, vels, ng);
    }
  };

  if (!parsed) return <p className="seqs-none nodrag">este source no tiene notas <code>note("…")</code> editables aquí</p>;

  return (
    <div className="seqs mel nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seqs-ctl">
        <button className={`seqs-play${preview ? ' on' : ''}`} onClick={togglePreview} title="aislar y previsualizar (luego ESPACIO reproduce/para)">{preview ? '◉' : '▶'}</button>
        <span className="seqs-tag">notas</span>
        <div className="seqs-steps" title="octava base">
          <button onClick={() => setOct((o) => Math.max(0, o - 1))}>−</button>
          <b>C{oct}<i>8va</i></b>
          <button onClick={() => setOct((o) => Math.min(7, o + 1))}>+</button>
        </div>
        <div className="seqs-steps">
          <button onClick={() => setStepCount(steps - 1)}>−</button>
          <b>{steps}<i>pasos</i></b>
          <button onClick={() => setStepCount(steps + 1)}>+</button>
        </div>
        <div className="seqs-slide" title="slide/glide: desliza el pitch entre notas contiguas (808 de trap/drift-phonk). 0 = sin slide.">
          <MiniSlider label="slide" value={slide} min={0} max={1} step={0.02} onChange={(v) => commit(cells, vels, gates, v)} />
        </div>
        <button className={`seqs-auto${showAuto ? ' on' : ''}`} onClick={() => setShowAuto((a) => !a)} title="editar volumen (vel) y duración (dur) por paso">vel/dur</button>
        <button className="gate-clear" onClick={clearAll} title="borrar todas las notas y automatización">limpiar</button>
      </div>

      <LiveScope nodeId={id} height={36} />

      <div className="mel-grid">
        {rows.map((row) => (
          <div className={`mel-row${row.root ? ' root' : ''}${row.acc ? ' acc' : ''}`} key={row.midi}>
            <button className="mel-key" onClick={() => audit(row)} title={`probar ${row.val}`}>{row.val}</button>
            <div className="mel-cells" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
              {cells.map((c, col) => (
                <button
                  key={col}
                  className={`mel-cell${noteToMidi(c) === row.midi ? ' on' : ''}${col === head ? ' play' : ''}${col % 4 === 0 ? ' beat' : ''}`}
                  onPointerDown={() => { drawing.current = { note: row.val }; place(col, row); }}
                  onPointerEnter={() => { if (drawing.current) paintTo(col, row); }}
                  title={`${row.val} · paso ${col + 1}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {showAuto && (
        <div className="seq-auto">
          {(['vel', 'gate'] as const).map((lane) => (
            <div className="seq-auto-lane" key={lane}>
              <span className="seq-auto-tag">{lane === 'vel' ? 'vel' : 'dur'}</span>
              <div className="seq-auto-bars" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
                {(lane === 'vel' ? vels : gates).map((v, col) => {
                  const h = lane === 'vel' ? v : v / 2; // gate 0..2 → 0..1 de alto (1 = medio)
                  const active = cells[col] !== '~';
                  return (
                    <div
                      key={col}
                      className={`seq-auto-bar${col === head ? ' play' : ''}${active ? '' : ' rest'}${col % 4 === 0 ? ' beat' : ''}`}
                      onPointerDown={(e) => { dragLane.current = lane; setAuto(lane, col, e.clientY, e.currentTarget); }}
                      onPointerEnter={(e) => { if (dragLane.current === lane) setAuto(lane, col, e.clientY, e.currentTarget); }}
                      title={`${lane === 'vel' ? 'volumen' : 'duración'} · paso ${col + 1}: ${fmt(v)}`}
                    >
                      <div className="seq-auto-fill" style={{ height: `${Math.max(4, Math.min(100, h * 100))}%` }} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="seqs-hint">clic = nota (suena al colocar) · una nota por paso · fila (izq) = probar · «vel/dur» = arrastra volumen y duración · ▶/espacio = escuchar aislado</p>
    </div>
  );
}
