import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import type { NodeData, SynthParams } from '../graph/types';
import { DEFAULT_SYNTH, VOICE_SCALES } from '../graph/types';
import { playSynthNote } from '../audio/playNote';
import { PC_FLAT, ACCIDENTAL, SCALE_STEPS, scaleName, midiToName, noteToMidi } from './pianoRollHelpers';

// Piano roll / CLIP general con DURACIÓN y VELOCITY. Edita el `code` de cualquier
// Source como patrón de notas visual:
//   • clic = nota (1 paso) · arrastrar horizontal = alargar (usa el sostenido `_`).
//   • fila de VELOCITY (bajo el grid): arrastra vertical para el volumen de cada nota
//     → genera `.gain("…")` alineado.
// Conserva el prefijo `s("…")` (instrumentos de sample afinados). Audición con el synth.

interface Parsed { sName: string | null; tokens: string[]; scale: string; gains: number[] }

function parseCode(code: string): Parsed {
  const sName = /s\(\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1]?.match(/[A-Za-z0-9_]+/)?.[0] ?? null;
  const scale = /\.scale\(\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1] ?? '';
  const notes = /\.?\bnote\(\s*["'`]([^"'`]*)["'`]/.exec(code)?.[1]
    ?? /\.?\bn\(\s*["'`]([^"'`]*)["'`]/.exec(code)?.[1] ?? '';
  const tokens = notes.trim() ? notes.trim().split(/\s+/) : [];
  const gainStr = /\.gain\(\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1] ?? '';
  const gains = gainStr.trim() ? gainStr.trim().split(/\s+/).map((x) => Number(x)) : [];
  return { sName, tokens, scale, gains };
}
function rootedScale(scale: string, oct: number): string {
  if (!scale) return '';
  return /\d/.test(scale) ? scale : scale.replace(/^([A-Ga-g][#bfs]?)/, (m) => m + oct);
}
// limpia sostenidos huérfanos (`_` sin nota que lo preceda) → silencio, para emitir.
function sanitize(cells: string[]): string[] {
  const out = cells.slice();
  let inside = false;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === '~') inside = false;
    else if (out[i] === '_') { if (!inside) out[i] = '~'; }
    else inside = true;
  }
  return out;
}
function buildCode(p: { sName: string | null; cells: string[]; vels: number[]; scale: string; oct: number }): string {
  const cells = sanitize(p.cells);
  const hasNote = cells.some((c) => c !== '~' && c !== '_');
  const notePat = hasNote ? cells.join(' ') : '~';
  const scale = p.scale;
  let body = scale ? `n("${notePat}").scale("${rootedScale(scale, p.oct)}")` : `note("${notePat}")`;
  // gain solo si alguna nota (onset) tiene velocity < 1
  const onsetLow = cells.some((c, i) => c !== '~' && c !== '_' && (p.vels[i] ?? 1) < 0.99);
  if (hasNote && onsetLow) body += `.gain("${p.vels.map((v) => (v ?? 1).toFixed(2)).join(' ')}")`;
  return p.sName ? `s("${p.sName}").${body}` : body;
}

interface Row { val: string; label: string; sub: string; acc: boolean; root: boolean; midi: number }

export function ClipStudio() {
  const clipEditId = useGraphStore((s) => s.clipEditId);
  const setClipEdit = useGraphStore((s) => s.setClipEdit);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === s.clipEditId));
  const update = useGraphStore((s) => s.updateNodeData);

  const code = (node?.data as NodeData | undefined)?.code ?? '';
  const parsed = useMemo(() => parseCode(code), [code]);
  const [oct, setOct] = useState(3);
  const [scaleSel, setScaleSel] = useState(parsed.scale);
  const [steps, setSteps] = useState(() => Math.max(1, Math.min(32, parsed.tokens.length || 8)));
  const dragNote = useRef<{ start: number; val: string } | null>(null);
  const dragVel = useRef(false);

  useEffect(() => { setScaleSel(parsed.scale); }, [parsed.scale]);
  useEffect(() => { setSteps((s) => Math.max(s, Math.min(32, parsed.tokens.length))); }, [parsed.tokens.length]);
  useEffect(() => {
    const up = () => { dragNote.current = null; dragVel.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const scaleMode = !!scaleSel.trim();
  const cells = useMemo(() => {
    const arr = parsed.tokens.slice(0, steps);
    while (arr.length < steps) arr.push('~');
    return arr;
  }, [parsed.tokens, steps]);
  const vels = useMemo(() => {
    const arr = parsed.gains.slice(0, steps);
    while (arr.length < steps) arr.push(1);
    return arr.map((v) => (isFinite(v) ? Math.max(0, Math.min(1, v)) : 1));
  }, [parsed.gains, steps]);
  // dueño de cada columna (nota que la controla, onset o sostenido)
  const owners = useMemo(() => {
    const out: (string | null)[] = [];
    let cur: string | null = null;
    for (const c of cells) {
      if (c === '~') cur = null;
      else if (c === '_') { /* mantiene cur */ }
      else cur = c;
      out.push(c === '_' ? cur : (c === '~' ? null : cur));
    }
    return out;
  }, [cells]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const rootMidi = (oct + 1) * 12;
    if (scaleMode) {
      const st = SCALE_STEPS[scaleName(scaleSel)] ?? SCALE_STEPS.minor;
      const len = st.length;
      for (let d = len * 2; d >= 0; d--) {
        const pc = st[d % len];
        const semi = st[d % len] + 12 * Math.floor(d / len);
        out.push({ val: String(d), label: String(d), sub: PC_FLAT[pc] + "'".repeat(Math.floor(d / len)), acc: ACCIDENTAL.has(pc), root: d % len === 0, midi: rootMidi + semi });
      }
    } else {
      for (let m = rootMidi + 23; m >= rootMidi; m--) {
        const pc = ((m % 12) + 12) % 12;
        out.push({ val: midiToName(m), label: midiToName(m), sub: '', acc: ACCIDENTAL.has(pc), root: pc === 0, midi: m });
      }
    }
    return out;
  }, [scaleMode, scaleSel, oct]);

  if (!clipEditId || !node) return null;
  const data = node.data as NodeData;
  const syn: SynthParams = data.synthOn ? { ...DEFAULT_SYNTH, ...(data.synth ?? {}) } : { ...DEFAULT_SYNTH, wave: 'triangle' };

  const tokMatch = (tok: string | null, row: Row) => {
    if (!tok) return false;
    if (scaleMode) return parseInt(tok, 10) === parseInt(row.val, 10);
    const a = noteToMidi(tok), b = noteToMidi(row.val);
    return a != null && a === b;
  };
  const commit = (nextCells: string[], nextVels = vels) =>
    update(clipEditId, { code: buildCode({ sName: parsed.sName, cells: nextCells, vels: nextVels, scale: scaleSel, oct }) });

  // coloca/quita una nota (longitud 1) y arranca el arrastre para alargarla
  const placeNote = (col: number, row: Row) => {
    const next = cells.slice();
    if (cells[col] !== '_' && tokMatch(cells[col], row)) {
      // clic en el onset de la misma nota → quitarla (y su sostenido)
      next[col] = '~';
      let k = col + 1;
      while (k < steps && next[k] === '_') { next[k] = '~'; k++; }
      dragNote.current = null;
      commit(next);
      return;
    }
    next[col] = row.val;
    let k = col + 1;
    while (k < steps && next[k] === '_') { next[k] = '~'; k++; } // corta sostenidos previos
    dragNote.current = { start: col, val: row.val };
    void playSynthNote(syn, row.midi, 0.4, clipEditId);
    commit(next);
  };
  // alarga la nota en curso hasta la columna j (arrastre horizontal)
  const extendTo = (j: number) => {
    const d = dragNote.current;
    if (!d || j < d.start) return;
    const next = cells.slice();
    next[d.start] = d.val;
    let k = d.start + 1;
    while (k <= j && k < steps) { next[k] = '_'; k++; }
    while (k < steps && next[k] === '_') { next[k] = '~'; k++; } // acorta el sobrante
    commit(next);
  };

  const setVel = (col: number, v: number) => {
    if (owners[col] == null || cells[col] === '_') return; // solo onsets
    const nv = vels.slice();
    nv[col] = Math.max(0.05, Math.min(1, v));
    commit(cells, nv);
  };

  const changeScale = (sc: string) => {
    const crossed = !scaleSel.trim() !== !sc.trim();
    setScaleSel(sc);
    update(clipEditId, { code: buildCode({ sName: parsed.sName, cells: crossed ? cells.map(() => '~') : cells, vels, scale: sc, oct }) });
  };

  return (
    <>
      <div className="vs-backdrop" onClick={() => setClipEdit(null)} />
      <div className="ss-panel">
        <header className="vs-head">
          <input className="vs-name" value={data.name ?? ''} placeholder="clip…" onChange={(e) => update(clipEditId, { name: e.target.value })} />
          <span className="vs-title">piano roll · clip</span>
          <button className="vs-reset" onClick={() => update(clipEditId, { code: buildCode({ sName: parsed.sName, cells: cells.map(() => '~'), vels: vels.map(() => 1), scale: scaleSel, oct }) })} title="vaciar el patrón">vaciar</button>
          <button className="vs-x" onClick={() => setClipEdit(null)} title="cerrar">×</button>
        </header>

        <div className="vs-sec" style={{ borderTop: 'none', paddingTop: 4 }}>
          <div className="vs-roll">
            <div className="vs-roll-ctl">
              <select className="vs-scale" value={scaleSel} onChange={(e) => changeScale(e.target.value)} title="escala (autotune por grados) o cromático">
                <option value="">cromático</option>
                {VOICE_SCALES.map((s) => <option key={s} value={s}>{s.replace('C:', '')}</option>)}
              </select>
              <div className="vs-stepper" title="nº de pasos">
                <button onClick={() => { const n = Math.max(1, steps - 1); setSteps(n); commit(cells.slice(0, n), vels.slice(0, n)); }}>−</button>
                <b>{steps}<i>pasos</i></b>
                <button onClick={() => setSteps((s) => Math.min(32, s + 1))}>+</button>
              </div>
              <div className="vs-stepper" title="octava base">
                <button onClick={() => setOct((o) => Math.max(0, o - 1))}>−</button>
                <b>C{oct}<i>8va</i></b>
                <button onClick={() => setOct((o) => Math.min(6, o + 1))}>+</button>
              </div>
              <span className="vs-hint" style={{ margin: 0 }}>{parsed.sName ? `instrumento: ${parsed.sName}` : 'synth del nodo'}</span>
            </div>

            <div className="vs-roll-grid">
              {rows.map((row) => (
                <div className={`vs-roll-row${row.root ? ' root' : ''}${row.acc ? ' acc' : ''}`} key={row.val}>
                  <div className="vs-roll-lbl"><b>{row.label}</b>{row.sub && <i>{row.sub}</i>}</div>
                  <div className="vs-roll-cells" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
                    {cells.map((c, col) => {
                      const mine = tokMatch(owners[col], row);
                      const onset = mine && c !== '_';
                      const sustain = mine && c === '_';
                      return (
                        <button
                          key={col}
                          className={`vs-cell${onset ? ' on' : ''}${sustain ? ' sus' : ''}${col % 4 === 0 ? ' beat' : ''}`}
                          onPointerDown={() => placeNote(col, row)}
                          onPointerEnter={() => { if (dragNote.current) extendTo(col); }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* fila de velocity: arrastra vertical en un onset para su volumen */}
            <div className="cl-vel-wrap">
              <span className="cl-vel-lbl">vel</span>
              <div className="cl-vel" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}
                onPointerDown={(e) => { dragVel.current = true; velFromEvent(e); }}
                onPointerMove={(e) => { if (dragVel.current) velFromEvent(e); }}
              >
                {cells.map((c, col) => {
                  const isOnset = owners[col] != null && c !== '_' && c !== '~';
                  return (
                    <div key={col} className={`cl-vel-cell${isOnset ? '' : ' off'}${col % 4 === 0 ? ' beat' : ''}`} data-col={col}>
                      {isOnset && <span style={{ height: `${vels[col] * 100}%` }} />}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="vs-roll-steps" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)`, marginLeft: 46 }}>
              {cells.map((c, col) => <span key={col} className={c === '~' ? 'rest' : ''}>{c === '~' ? '·' : c === '_' ? '–' : c}</span>)}
            </div>
            <p className="vs-hint">clic = nota · arrastrar → alargar · fila «vel» = volumen por nota · con escala = autotune. El nodo toca este patrón.</p>
          </div>
        </div>
      </div>
    </>
  );

  // calcula la velocity a partir de la posición del puntero dentro de la fila
  function velFromEvent(e: React.PointerEvent) {
    const cell = (e.target as HTMLElement).closest('.cl-vel-cell') as HTMLElement | null;
    if (!cell) return;
    const col = Number(cell.dataset.col);
    if (isNaN(col)) return;
    const rect = cell.getBoundingClientRect();
    const v = 1 - (e.clientY - rect.top) / rect.height;
    setVel(col, v);
  }
}
