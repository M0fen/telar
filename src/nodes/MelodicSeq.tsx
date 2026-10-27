import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import type { NodeData } from '../graph/types';
import { playSynthNote, playDrumHit } from '../audio/playNote';
import { getScheduler } from '../audio/engine';
import { ACCIDENTAL, midiToName } from '../ui/pianoRollHelpers';
import { LiveScope } from './LiveScope';
import { alignNums, buildMel, chordMidis, chordTok, fmtNum, parseMel } from './melCode';
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

// el código de la melodía (parse/build, acordes) vive en melCode.ts (módulo puro, con tests)
const fmt = fmtNum;

interface Row { val: string; midi: number; acc: boolean; root: boolean }

// `wrap` (opcional): re-envuelve el código emitido antes de guardarlo — lo usa el modo
// SECCIONES del secuenciador para empalmar el brazo editado dentro de un arrange.
// `previewCode`/`headOff`: audición de sección (▶ toca el brazo en loop al instante) y
// playhead apagado cuando la sección editada no es la que suena. Igual que StepGrid.
export function MelodicSeq({ id, code, wrap, previewCode, headOff }: { id: string; code: string; wrap?: (c: string) => string; previewCode?: string; headOff?: boolean }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const parsed = useMemo(() => parseMel(code), [code]);
  // la octava de partida: la de la nota más grave (un .mid de bajo arranca en su octava)
  const [oct, setOct] = useState(() => {
    const lows = (parsed?.tokens ?? []).flatMap(chordMidis);
    return lows.length ? Math.max(0, Math.min(7, Math.floor(Math.min(...lows) / 12) - 1)) : 3;
  });
  const cycles = parsed?.cycles ?? 1;
  const multi = cycles > 1 && Number.isInteger(cycles);
  // con varios compases, todos los pasos del código (y se ven por compás); si no, hasta 32
  const [stepsState, setSteps] = useState(() => Math.max(1, Math.min(32, parsed?.tokens.length || 8)));
  const steps = multi ? Math.max(1, parsed?.tokens.length ?? 1) : stepsState;
  const perPage = multi ? Math.max(1, Math.round(steps / cycles)) : steps;
  const [page, setPage] = useState(0);
  const pg = multi ? Math.min(page, cycles - 1) : 0;
  const off = pg * perPage; // primer paso de la página visible
  const [head, setHead] = useState(-1);
  const [preview, setPreview] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const drawing = useRef<{ note: string } | null>(null);
  const dragLane = useRef<'vel' | 'gate' | null>(null);
  const [saved, setSaved] = useState(false); // pulso "en vivo": cada cambio se guarda y suena al instante
  const savedT = useRef<number | undefined>(undefined);
  const pulseSaved = () => { setSaved(true); clearTimeout(savedT.current); savedT.current = window.setTimeout(() => setSaved(false), 700); };

  useEffect(() => { if (parsed?.tokens.length) setSteps((s) => Math.max(s, Math.min(32, parsed.tokens.length))); }, [parsed?.tokens.length]);
  useEffect(() => {
    let raf = 0;
    const cyc = multi ? cycles : 1;
    const tick = () => {
      const now = getScheduler()?.now?.();
      setHead(typeof now === 'number' && !(headOff && !preview) ? Math.floor((((now % cyc) + cyc) % cyc) / cyc * steps) % steps : -1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [steps, headOff, preview, multi, cycles]);
  useEffect(() => {
    const up = () => { drawing.current = null; dragLane.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  useEffect(() => () => { if (preview) useGraphStore.getState().updateNodeData(id, { solo: false, seqPreviewCode: undefined }); }, [id, preview]);
  // con ▶ activo, cambiar de sección (o editarla) refresca la audición al brazo actual.
  useEffect(() => {
    if (preview && previewCode) useGraphStore.getState().updateNodeData(id, { seqPreviewCode: previewCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCode]);

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

  const slide = parsed?.slide ?? 0; // 808 slide (pitch-env de cada nota)
  const commit = (nc: string[], nv: number[], ng: number[], sl: number = slide) => { if (parsed) { const c = buildMel(parsed, nc, nv, ng, sl); update(id, { code: wrap ? wrap(c) : c }); pulseSaved(); } };
  // clic = poner esa nota (o quitarla si ya estaba); con Mayús = sumarla al ACORDE del paso
  const place = (col: number, row: Row, add = false) => {
    const next = cells.slice();
    const cur = chordMidis(next[col]);
    const on = cur.includes(row.midi);
    next[col] = on ? chordTok(cur.filter((m) => m !== row.midi)) : add ? chordTok([...cur, row.midi]) : row.val;
    if (!on) audit(row, vels[col] ?? 0.9);
    commit(next, vels, gates);
  };
  const paintTo = (col: number, row: Row) => { const next = cells.slice(); next[col] = row.val; commit(next, vels, gates); };
  const setStepCount = (n: number) => {
    if (multi) return; // con varios compases, los pasos los fija el código
    const c = Math.max(2, Math.min(32, n));
    const nc = cells.slice(0, c).concat(Array(Math.max(0, c - cells.length)).fill('~'));
    commit(nc, alignNums(vels, c, 1), alignNums(gates, c, 1));
    setSteps(c);
  };
  const togglePreview = () => { const s = useGraphStore.getState(); const nx = !preview; setPreview(nx); s.updateNodeData(id, { solo: nx, seqPreviewCode: nx && previewCode ? previewCode : undefined }); if (nx && !s.playing) void s.play(); };
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
        <span className="seqs-tag" title="editas las notas de ESTE source, con su propio timbre">notas{parsed.wave || parsed.sName ? ` · ${parsed.wave || parsed.sName}` : ''}{parsed.bank ? ` · ${parsed.bank}` : ''}</span>
        <span className={`seqs-saved${saved ? ' on' : ''}`} title="edición en vivo: cada nota se guarda en el source y suena al instante — no hay que guardar aparte">● en vivo</span>
        <div className="seqs-steps" title="octava base">
          <button onClick={() => setOct((o) => Math.max(0, o - 1))}>−</button>
          <b>C{oct}<i>8va</i></b>
          <button onClick={() => setOct((o) => Math.min(7, o + 1))}>+</button>
        </div>
        {multi ? (
          <div className="seqs-steps" title="compás que ves (las notas ocupan varios compases)">
            <button onClick={() => setPage(Math.max(0, pg - 1))} disabled={pg <= 0}>◀</button>
            <b>{pg + 1}/{cycles}<i>compás</i></b>
            <button onClick={() => setPage(Math.min(cycles - 1, pg + 1))} disabled={pg >= cycles - 1}>▶</button>
          </div>
        ) : (
          <div className="seqs-steps">
            <button onClick={() => setStepCount(steps - 1)}>−</button>
            <b>{steps}<i>pasos</i></b>
            <button onClick={() => setStepCount(steps + 1)}>+</button>
          </div>
        )}
        <div className="seqs-slide" title="slide de 808: cada nota ENTRA deslizando el pitch hasta su tono (trap/drift-phonk). Mueve el pitch-env del sonido. 0 = sin slide.">
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
            <div className="mel-cells" style={{ gridTemplateColumns: `repeat(${perPage}, 1fr)` }}>
              {cells.slice(off, off + perPage).map((c, k) => {
                const col = off + k;
                const notes = chordMidis(c);
                return (
                  <button
                    key={col}
                    className={`mel-cell${notes.includes(row.midi) ? ' on' : ''}${notes.length > 1 && notes.includes(row.midi) ? ' chord' : ''}${col === head ? ' play' : ''}${k % 4 === 0 ? ' beat' : ''}`}
                    onPointerDown={(e) => { drawing.current = e.shiftKey ? null : { note: row.val }; place(col, row, e.shiftKey); }}
                    onPointerEnter={() => { if (drawing.current) paintTo(col, row); }}
                    title={`${row.val} · paso ${col + 1}${notes.length > 1 ? ' · acorde' : ''} · Mayús+clic = sumar al acorde`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {showAuto && (
        <div className="seq-auto">
          {(['vel', 'gate'] as const).map((lane) => (
            <div className="seq-auto-lane" key={lane}>
              <span className="seq-auto-tag">{lane === 'vel' ? 'vel' : 'dur'}</span>
              <div className="seq-auto-bars" style={{ gridTemplateColumns: `repeat(${perPage}, 1fr)` }}>
                {(lane === 'vel' ? vels : gates).slice(off, off + perPage).map((v, k) => {
                  const col = off + k;
                  const h = lane === 'vel' ? v : v / 2; // gate 0..2 → 0..1 de alto (1 = medio)
                  const active = cells[col] !== '~';
                  return (
                    <div
                      key={col}
                      className={`seq-auto-bar${col === head ? ' play' : ''}${active ? '' : ' rest'}${k % 4 === 0 ? ' beat' : ''}`}
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
    </div>
  );
}
