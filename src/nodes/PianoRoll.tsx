import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useTrackColorStore } from '../store/useTrackColorStore';
import type { NodeData } from '../graph/types';
import { playSynthNote, playDrumHit } from '../audio/playNote';
import { previewPattern, eventsOf } from '../audio/patternPreview';
import { keyLong } from '../lib/songKey';
import { ACCIDENTAL, midiToName } from '../ui/pianoRollHelpers';
import { MiniSlider } from './MiniSlider';
import { heardPatternTime, type ArmPos } from './patternClock';
import {
  CHORD_TOOLS, buildMel, chordMidis, chordShape, melState, moveStep, parseMel, placeAt, regrid, removeNote, rollRows,
  scalePcs, setBarsTo, setGate, setPerBar, setVel, shiftByRows, snapGate, type ChordTool, type MelState, type RowMode,
} from './melCode';

// PIANO ROLL GRANDE (Fase 9.4), en el panel de detalle. Las notas de la pista sobre un teclado que
// suena con su timbre, con la escala del tema resaltada (y «plegar» a la escala o a las notas usadas),
// notas largas (se estira el borde), acordes en tono con un clic, las notas de las demás pistas como
// fantasmas para escribir encima sin chocar, el carril de fuerza siempre a la vista y la vista
// centrada en las notas. Edita el mismo código que el piano roll del nodo (melCode.ts): un token por
// paso, `.gain("…")` y `.clip("…")` por paso, `.slow(N)` para varios compases.
//   · clic en vacío: pone la nota (o el acorde elegido); arrastrar a la derecha la alarga y arriba o
//     abajo cambia su altura. Mayús+clic suma la nota al acorde del paso.
//   · arrastrar una nota: la mueve (con su acorde) — en la vista plegada, por grados de la escala;
//     el borde derecho: su duración; clic sin mover o clic derecho: la borra.

const LO = 24; // C1
const HI = 96; // C7
const ROWH_KEY = 'telar.proll.rowh';
const readRowH = () => {
  try {
    const v = Number(localStorage.getItem(ROWH_KEY));
    return v >= 9 && v <= 26 ? v : 14;
  } catch {
    return 14;
  }
};

type Drag =
  | { mode: 'new'; col: number; ri: number; base: MelState; add: boolean; last: string }
  | { mode: 'move'; col: number; c0: number; ri: number; midi: number; base: MelState; moved: boolean; x0: number; y0: number; last: number }
  | { mode: 'resize'; col: number; base: MelState };

interface Ghost { t: number; d: number; note: number; id: string }

export function PianoRoll({ id, code, wrap, previewCode, headOff, armPos }: { id: string; code: string; wrap?: (c: string) => string; previewCode?: string; headOff?: boolean; armPos?: ArmPos }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const songKey = useGraphStore((s) => s.songKey);
  const beats = useGraphStore((s) => s.beatsPerCycle) || 4;
  const colors = useTrackColorStore((s) => s.map);
  const parsed = useMemo(() => parseMel(code), [code]);
  const cycles = parsed?.cycles ?? 1;
  const bars = Math.max(1, Math.round(cycles));
  const rawSteps = parsed?.tokens.length ?? 0;
  // una melodía de un solo token (una nota por compás) se ve a 16 pasos por compás: suena igual
  const steps = rawSteps <= 1 ? 16 * bars : rawSteps;
  const base = useMemo(() => (parsed ? regrid(melState(parsed, Math.max(1, rawSteps)), steps) : null), [parsed, rawSteps, steps]);
  const [draft, setDraftState] = useState<MelState | null>(null);
  const draftRef = useRef<MelState | null>(null);
  const setDraft = (d: MelState | null) => { draftRef.current = d; setDraftState(d); };
  const st = draft ?? base;

  const [rowMode, setRowMode] = useState<RowMode>('todas');
  const [tool, setTool] = useState<ChordTool>('nota');
  const [rowH, setRowHState] = useState(readRowH);
  const setRowH = (h: number) => { const v = Math.max(9, Math.min(26, h)); setRowHState(v); try { localStorage.setItem(ROWH_KEY, String(v)); } catch { /* solo esta sesión */ } };
  const [ghostsOn, setGhostsOn] = useState(true);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedT = useRef<number | undefined>(undefined);
  const pulseSaved = () => { setSaved(true); clearTimeout(savedT.current); savedT.current = window.setTimeout(() => setSaved(false), 700); };
  const [centerNonce, setCenterNonce] = useState(0);
  const drag = useRef<Drag | null>(null);
  const velDrag = useRef<MelState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [headCol, setHeadCol] = useState(-1);

  // FILAS: de C1 a C7 (más si hay notas fuera) — todas, las de la escala o las usadas
  const pcs = useMemo(() => scalePcs(songKey), [songKey]);
  const usedBase = useMemo(() => (base ? [...new Set(base.cells.flatMap(chordMidis))].sort((a, b) => a - b) : []), [base]);
  const lo = Math.min(LO, ...usedBase.map((m) => m - 2));
  const hi = Math.max(HI, ...usedBase.map((m) => m + 2));
  const mode: RowMode = rowMode === 'escala' && !pcs ? 'todas' : rowMode;
  const rows = useMemo(() => rollRows(lo, hi, mode, pcs, usedBase), [lo, hi, mode, pcs, usedBase]);
  const rowIdx = useMemo(() => new Map(rows.map((m, i) => [m, i])), [rows]);

  // NOTAS FANTASMA: lo que tocan las demás pistas en el mismo tramo de la canción
  const others = useGraphStore((s) => s.nodes
    .filter((n) => n.id !== id && n.data.kind === 'source' && !n.data.mute && !Array.isArray(n.data.transitions) && (n.data.code ?? '').trim())
    .map((n) => `${n.id}\u0000${n.data.name ?? ''}\u0000${n.data.code ?? ''}`)
    .join('\u0001'));
  const names = useMemo(() => new Map((others ? others.split('\u0001') : []).map((x) => { const [a, b] = x.split('\u0000'); return [a, b || a] as const; })), [others]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  useEffect(() => {
    if (!ghostsOn || !others) { setGhosts([]); return; }
    let alive = true;
    const w0 = armPos ? armPos.start : 0;
    const t = window.setTimeout(async () => {
      const out: Ghost[] = [];
      for (const pair of others.split('\u0001')) {
        const [nid, , c] = pair.split('\u0000');
        const pat = await previewPattern(c);
        if (!pat) continue;
        for (const e of eventsOf(pat, w0, w0 + cycles)) {
          if (e.note == null || out.length >= 1500) continue;
          out.push({ t: e.t, d: e.d, note: Math.round(e.note), id: nid });
        }
      }
      if (alive) setGhosts(out);
    }, 150);
    return () => { alive = false; window.clearTimeout(t); };
  }, [ghostsOn, others, armPos?.start, cycles]);

  // CABEZAL: lo que se oye, sin re-render por cuadro (se mueve por estilo); el paso, para el teclado
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = headOff && !preview ? NaN : heardPatternTime(armPos, preview);
      const x = Number.isFinite(s) && s >= 0 ? (((s / cycles) % 1) + 1) % 1 : -1;
      const el = headRef.current;
      if (el) {
        el.style.display = x < 0 ? 'none' : 'block';
        if (x >= 0) el.style.left = `${x * 100}%`;
      }
      setHeadCol(x < 0 ? -1 : Math.floor(x * steps));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cycles, steps, headOff, preview, armPos?.start, armPos?.bars, armPos?.total]);

  // VISTA CENTRADA en las notas (o en la raíz del tema) al abrir y con ⌖
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !rows.length) return;
    const target = usedBase.length ? (usedBase[0] + usedBase[usedBase.length - 1]) / 2 : 48 + (songKey?.root ?? 0);
    let best = 0;
    rows.forEach((m, i) => { if (Math.abs(m - target) < Math.abs(rows[best] - target)) best = i; });
    sc.scrollTop = Math.max(0, best * rowH - sc.clientHeight / 2 + rowH / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerNonce, rowH, mode, id]);

  // con ▶ activo, cambiar de sección (o editarla) refresca la audición al brazo actual
  useEffect(() => {
    if (preview && previewCode) useGraphStore.getState().updateNodeData(id, { seqPreviewCode: previewCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCode]);
  useEffect(() => () => { if (preview) useGraphStore.getState().updateNodeData(id, { solo: false, seqPreviewCode: undefined }); }, [id, preview]);

  if (!parsed || !st) return <p className="seqs-none nodrag">este source no tiene notas <code>note("…")</code> editables aquí</p>;

  // audición con el timbre de la pista (synth → su oscilador; sample afinado → el sample)
  const audit = (midis: number[], vel = 0.9) => {
    const d = useGraphStore.getState().nodes.find((n) => n.id === id)?.data as NodeData | undefined;
    for (const m of midis.slice(0, 4)) {
      if (d?.synthOn && d.synth) void playSynthNote(d.synth, m, 0.6, id);
      else if (parsed.sName && !parsed.wave) void playDrumHit(parsed.sName, parsed.bank, midiToName(m), 0.5, vel);
      else void playSynthNote({ wave: parsed.wave ?? 'sawtooth' }, m, 0.6, id);
    }
  };
  const commit = (ns: MelState, cyc = cycles, slide = parsed.slide) => {
    const c = buildMel(parsed, ns.cells, ns.vels, ns.gates, slide, cyc);
    setDraft(null);
    update(id, { code: wrap ? wrap(c) : c });
    pulseSaved();
  };
  const togglePreview = () => {
    const s = useGraphStore.getState();
    const nx = !preview;
    setPreview(nx);
    s.updateNodeData(id, { solo: nx, seqPreviewCode: nx && previewCode ? previewCode : undefined });
    if (nx && !s.playing) void s.play();
  };

  const per = Number.isInteger(steps / bars) ? steps / bars : steps;
  const beatEvery = per % beats === 0 ? per / beats : 4;
  const setBars = (nb: number) => { if (nb !== bars && per * nb <= 64) commit(setBarsTo(st, bars, nb), nb); };
  const setPer = (n: number) => {
    const c = Math.max(2, Math.min(Math.floor(64 / bars), n));
    if (c !== per && Number.isInteger(steps / bars)) commit(setPerBar(st, bars, c));
  };

  // del puntero a (paso, fila)
  const cell = (e: { clientX: number; clientY: number }) => {
    const r = gridRef.current!.getBoundingClientRect();
    const col = Math.max(0, Math.min(steps - 1, Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * steps)));
    const ri = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - r.top) / rowH)));
    return { col, ri, x: e.clientX - r.left, colW: r.width / steps };
  };
  const onGridDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { col, ri } = cell(e);
    const chord = chordShape(rows[ri], tool, songKey);
    drag.current = { mode: 'new', col, ri, base: st, add: e.shiftKey, last: chord.join() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft(placeAt(st, col, chord, e.shiftKey));
    audit(chord, st.vels[col] ?? 0.9);
  };
  const onNoteDown = (e: React.PointerEvent, col: number, midi: number, handle: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    gridRef.current?.setPointerCapture(e.pointerId);
    if (handle) { drag.current = { mode: 'resize', col, base: st }; return; }
    const c = cell(e);
    drag.current = { mode: 'move', col, c0: c.col, ri: c.ri, midi, base: st, moved: false, x0: e.clientX, y0: e.clientY, last: midi };
  };
  const onGridMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { col, ri, x, colW } = cell(e);
    if (d.mode === 'new') {
      const chord = chordShape(rows[ri], tool, songKey);
      const g = Math.max(1, col - d.col + 1);
      setDraft(placeAt(d.base, d.col, chord, d.add, g));
      const k = chord.join();
      if (k !== d.last) { d.last = k; audit(chord, d.base.vels[d.col] ?? 0.9); }
    } else if (d.mode === 'move') {
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4 && Math.abs(e.clientY - d.y0) < 4) return;
      d.moved = true;
      const dr = d.ri - ri;
      const to = Math.max(0, Math.min(steps - 1, d.col + (col - d.c0)));
      const next = moveStep(d.base, d.col, to, (m) => shiftByRows(m, rows, dr));
      setDraft(next);
      const top = shiftByRows(d.midi, rows, dr);
      if (top !== d.last) { d.last = top; audit(chordMidis(next.cells[to]), next.vels[to] ?? 0.9); }
    } else {
      setDraft(setGate(d.base, d.col, snapGate((x - d.col * colW) / Math.max(1, colW))));
    }
  };
  const onGridUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'move' && !d.moved) { commit(removeNote(d.base, d.col, d.midi)); return; }
    const dr = draftRef.current;
    if (dr) commit(dr);
  };
  // carril de FUERZA: arrastrar ↕ (y a lo ancho para pintar varias)
  const velAt = (e: React.PointerEvent<HTMLDivElement>, cur: MelState) => {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.max(0, Math.min(steps - 1, Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * steps)));
    if (cur.cells[col] === '~') return cur;
    return setVel(cur, col, 1 - (e.clientY - r.top) / Math.max(1, r.height));
  };

  // notas que suenan bajo el cabezal → se iluminan sus teclas
  const lit = new Set<number>();
  if (headCol >= 0) st.cells.forEach((c, i) => { if (c !== '~' && i <= headCol && headCol < i + Math.max(1, st.gates[i] ?? 1)) chordMidis(c).forEach((m) => lit.add(m)); });
  const rootPc = songKey ? songKey.root % 12 : 0;
  const pc = (m: number) => ((m % 12) + 12) % 12;
  const labelEvery = rowH >= 16 || mode !== 'todas';
  const H = rows.length * rowH;

  return (
    <div className="seqs proll nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seqs-ctl proll-ctl">
        <button className={`seqs-play${preview ? ' on' : ''}`} onClick={togglePreview} title="aislar y previsualizar esta sección en bucle (luego ESPACIO reproduce/para)">{preview ? '◉' : '▶'}</button>
        <span className="seqs-tag" title="editas las notas de ESTE source, con su propio timbre">piano roll{parsed.wave || parsed.sName ? ` · ${parsed.wave || parsed.sName}` : ''}</span>
        <span className={`seqs-saved${saved ? ' on' : ''}`} title="cada cambio se guarda en el source y suena al instante">● en vivo</span>
        <div className="seqs-len" title="largo: 1, 2 o 4 compases (al alargar se repite lo que hay)">
          <span>largo</span>
          {[1, 2, 4].map((b) => <button key={b} className={bars === b && Math.abs(cycles - b) < 1e-9 ? 'on' : ''} disabled={per * b > 64} onClick={() => setBars(b)}>{b}</button>)}
          <i>{bars === 1 ? 'compás' : 'compases'}</i>
        </div>
        <div className="seqs-steps" title="pasos por compás (16 = semicorcheas)">
          <button onClick={() => setPer(per - 1)}>−</button>
          <b>{per}<i>pasos/compás</i></b>
          <button onClick={() => setPer(per + 1)}>+</button>
        </div>
        <span className={`proll-key-chip${songKey ? '' : ' off'}`} title={songKey ? 'tonalidad del tema: sus notas se resaltan y los acordes salen en tono' : 'sin tonalidad: elígela arriba (junto al tempo) para ver la escala y escribir acordes en tono'}>
          {songKey ? keyLong(songKey) : 'sin tonalidad'}
        </span>
        <label className="seqs-bank" title="filas: todas, solo las de la escala del tema («plegar») o solo las que tienen notas">
          <span>filas</span>
          <select className="nodrag" value={rowMode} onChange={(e) => setRowMode(e.target.value as RowMode)}>
            <option value="todas">todas</option>
            <option value="escala" disabled={!pcs}>escala</option>
            <option value="usadas">usadas</option>
          </select>
        </label>
        <span className="proll-tools" role="group" aria-label="qué pone un clic">
          <span className="seqs-tools-tag">clic pone</span>
          {CHORD_TOOLS.map((t) => <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={t.title}>{t.id}</button>)}
        </span>
        <button className={`proll-tog${ghostsOn ? ' on' : ''}`} onClick={() => setGhostsOn((g) => !g)} title="ver las notas de las demás pistas en este tramo (para no chocar)">fantasmas</button>
        <button className="proll-tog" onClick={() => setCenterNonce((n) => n + 1)} title="centrar la vista en las notas">⌖ notas</button>
        <span className="proll-zoom" title="alto de las filas">
          <button onClick={() => setRowH(rowH - 2)}>−</button>
          <button onClick={() => setRowH(rowH + 2)}>+</button>
        </span>
        <div className="seqs-slide" title="slide de 808: cada nota entra deslizando su tono (trap/drift-phonk). 0 = sin slide.">
          <MiniSlider label="slide" value={parsed.slide} min={0} max={1} step={0.02} onChange={(v) => commit(st, cycles, v)} />
        </div>
        <button className="gate-clear" onClick={() => commit({ cells: st.cells.map(() => '~'), vels: st.vels.map(() => 1), gates: st.gates.map(() => 1) })} title="borrar todas las notas de esta sección">limpiar</button>
      </div>

      <div className="proll-scroll" ref={scrollRef} style={{ ['--rh' as string]: `${rowH}px` }}>
        <div className="proll-body" style={{ height: H }}>
          <div className="proll-keys">
            {rows.map((m) => {
              const blk = ACCIDENTAL.has(pc(m));
              const inScale = !!pcs && pcs.includes(pc(m));
              const isRoot = !!songKey && pc(m) === rootPc;
              return (
                <button
                  key={m}
                  className={`proll-key${blk && mode === 'todas' ? ' blk' : ''}${inScale ? ' in' : ''}${isRoot ? ' root' : ''}${lit.has(m) ? ' lit' : ''}`}
                  style={{ height: rowH }}
                  onPointerDown={() => audit([m])}
                  title={`${midiToName(m)}${isRoot ? ' · raíz del tema' : inScale ? ' · en la escala' : ''} · clic para oírla`}
                >
                  {(labelEvery || pc(m) === 0 || isRoot) && <span>{midiToName(m)}</span>}
                </button>
              );
            })}
          </div>
          <div
            className="proll-grid"
            ref={gridRef}
            style={{ ['--steps' as string]: steps, ['--nbeats' as string]: Math.max(1, Math.round(steps / beatEvery)), ['--nbars' as string]: bars }}
            onPointerDown={onGridDown}
            onPointerMove={onGridMove}
            onPointerUp={onGridUp}
            onPointerCancel={onGridUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="proll-rows" aria-hidden="true">
              {rows.map((m) => (
                <div key={m} className={`proll-row${ACCIDENTAL.has(pc(m)) && mode === 'todas' ? ' blk' : ''}${pcs && pcs.includes(pc(m)) ? ' in' : ''}${songKey && pc(m) === rootPc ? ' root' : ''}`} style={{ height: rowH }} />
              ))}
            </div>
            <div className="proll-cols" aria-hidden="true" />
            {ghosts.map((g, i) => {
              const ri = rowIdx.get(g.note);
              if (ri == null) return null;
              return (
                <div
                  key={`g${i}`}
                  className="proll-ghost"
                  style={{ left: `${(g.t / cycles) * 100}%`, width: `${Math.max(0.2, (g.d / cycles) * 100)}%`, top: ri * rowH + 2, height: rowH - 4, ['--gc' as string]: colors[g.id] ?? '#8aa' }}
                  data-track={names.get(g.id) ?? g.id}
                />
              );
            })}
            {st.cells.map((c, col) => chordMidis(c).map((m) => {
              const ri = rowIdx.get(m);
              if (ri == null) return null;
              const g = Math.min(Math.max(0.25, st.gates[col] ?? 1), steps - col);
              const v = st.vels[col] ?? 1;
              const chord = chordMidis(c).length > 1;
              return (
                <div
                  key={`${col}-${m}`}
                  className={`proll-note${chord ? ' chord' : ''}${pcs && !pcs.includes(pc(m)) ? ' out' : ''}`}
                  style={{ left: `${(col / steps) * 100}%`, width: `calc(${(g / steps) * 100}% - 1px)`, top: ri * rowH + 1, height: rowH - 2, opacity: 0.5 + 0.5 * Math.min(1, v) }}
                  onPointerDown={(e) => onNoteDown(e, col, m, false)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); commit(removeNote(st, col, m)); }}
                  title={`${midiToName(m)} · paso ${col + 1}${g !== 1 ? ` · dura ${g} pasos` : ''}${chord ? ` · acorde ${chordMidis(c).map(midiToName).join(' ')}` : ''} · arrastra para mover, el borde para alargar; clic o clic derecho la borra`}
                >
                  {rowH >= 12 && <span className="proll-nname">{midiToName(m)}</span>}
                  <i className="proll-handle" onPointerDown={(e) => onNoteDown(e, col, m, true)} />
                </div>
              );
            }))}
            <div className="proll-head" ref={headRef} />
          </div>
        </div>
      </div>

      <div className="proll-velrow">
        <span className="proll-vel-tag" title="fuerza de cada nota: arrastra ↕">fuerza</span>
        <div
          className="proll-vel"
          style={{ ['--steps' as string]: steps, ['--nbeats' as string]: Math.max(1, Math.round(steps / beatEvery)), ['--nbars' as string]: bars }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const n = velAt(e, st); velDrag.current = n; setDraft(n); }}
          onPointerMove={(e) => { if (velDrag.current) { const n = velAt(e, velDrag.current); velDrag.current = n; setDraft(n); } }}
          onPointerUp={() => { const n = velDrag.current; velDrag.current = null; if (n) commit(n); }}
          onPointerCancel={() => { velDrag.current = null; setDraft(null); }}
        >
          {st.cells.map((c, i) => (c === '~' ? null : (
            <span key={i} className="proll-lolli" style={{ left: `${((i + 0.5) / steps) * 100}%`, height: `${Math.max(4, Math.min(1, st.vels[i] ?? 1) * 100)}%` }} title={`paso ${i + 1}: fuerza ${Math.round((st.vels[i] ?? 1) * 100)} %`} />
          )))}
        </div>
      </div>
    </div>
  );
}
