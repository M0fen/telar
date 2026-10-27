import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { superdough, getAudioContext } from '@strudel/web';
import { useGraphStore } from '../store/useGraphStore';
import { ensureAudioReady, isOfflineRendering } from '../audio/engine';
import { loadSampleBuffer } from '../audio/previewSample';
import { warpOriginalBuffer, useWarpStore } from '../audio/warpLoops';
import { songBpmOf, type WarpInfo } from '../lib/loopWarp';
import { retuneWarp, setWarpKeyOpts, warpExistingSource } from '../lib/warpActions';
import { bareSampleName } from '../lib/sampleFit';
import { toast } from '../store/useNotifyStore';
import { addCut, buildClip, moveCut, parseClip, removeCut, snapFrac, tempoFromMarker, type ClipState } from '../lib/clipCode';
import { buildSliceCode, detectOnsets, evenSlices, normalizeCuts, parseSliceCode, sliceBounds, sliceCount, transientSlices, type SliceState } from '../lib/slicer';
import { heardPatternTime, type ArmPos } from './patternClock';

// EDITOR DE LOOPS Y SAMPLES (Fase 9.5), en el panel de detalle. La onda grande del sample (de un loop
// al tempo, la del original con su rejilla de tiempos) y, sobre ella:
//   · asas de INICIO y FIN del tramo que suena (pegadas a los tiempos; Alt = libre). En un loop el
//     tramo es su propia vuelta: 2 compases de un loop de 4 suenan en bucle cada 2 compases;
//   · FUNDIDOS de entrada y salida (las esquinas de arriba del tramo);
//   · REBANADAS (5.4) que se arrastran, se agregan con doble clic y se quitan con clic derecho; con un
//     hueco elegido, clic en una rebanada la pone ahí;
//   · MARCADORES DE TEMPO: en un loop, arrastrar el número de un compás de la regla hasta donde de
//     verdad empieza corrige su tempo original (y se vuelve a estirar al del tema);
//   · AL REVÉS y TONO del clip (un loop al tempo: con Rubber Band, sin cambiar el tempo; un sample
//     suelto: por varispeed).
// Todo se escribe en el código de la sección (clipCode.ts): cada sección puede tener su versión.

type Drag =
  | { kind: 'b' | 'e'; st: ClipState }
  | { kind: 'fi' | 'fo'; st: ClipState }
  | { kind: 'cut'; i: number; sl: SliceState }
  | { kind: 'bar'; bar: number; x: number };

const fmtSec = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${Math.round(s * 100) / 100} s`);
const nameOf = (base: string) => /["'`]([A-Za-z0-9_]+)["'`]/.exec(base)?.[1] ?? '';

export function SampleEditor({ id, code, wrap, previewCode, headOff, armPos }: { id: string; code: string; wrap?: (c: string) => string; previewCode?: string; headOff?: boolean; armPos?: ArmPos }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const cps = useGraphStore((s) => s.cps) || 0.5;
  const bpc = useGraphStore((s) => s.beatsPerCycle) || 4;
  const warp = useGraphStore((s) => s.nodes.find((n) => n.id === id)?.data.warp) as WarpInfo | undefined;
  const nodeTrim = useGraphStore((s) => { const d = s.nodes.find((n) => n.id === id)?.data; return (d?.begin ?? 0) > 0.001 || (d?.end ?? 1) < 0.999; });
  const parsed = useMemo(() => parseClip(code), [code]);
  const slices = useMemo(() => (parsed?.slice ? parseSliceCode(`s("${parsed.name}")${parsed.slice}${Math.abs(parsed.cycles - 1) > 1e-9 ? `.slow(${parsed.cycles})` : ''}`) : null), [parsed]);
  const isWarp = !!warp && !!parsed && parsed.name === warp.name;
  const isLoop = isWarp && !warp!.shot && warp!.beats > 0;
  const busy = useWarpStore((s) => (warp ? !!s.busy[warp.name] : false));
  const songBpm = songBpmOf(cps, bpc);

  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  useEffect(() => {
    let alive = true;
    setBuf(null);
    setLoadErr(false);
    if (!parsed) return;
    const p = isWarp ? warpOriginalBuffer(warp!) : loadSampleBuffer(parsed.name);
    void p.then((b) => { if (alive) { setBuf(b); setLoadErr(!b); } }, () => { if (alive) setLoadErr(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.name, warp?.orig]);

  const [draft, setDraftState] = useState<ClipState | null>(null);
  const [sliceDraft, setSliceDraft] = useState<SliceState | null>(null);
  const [barDrag, setBarDrag] = useState<{ bar: number; x: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [sel, setSel] = useState<number | null>(null); // hueco elegido (rebanadas)
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedT = useRef<number | undefined>(undefined);
  const pulseSaved = () => { setSaved(true); clearTimeout(savedT.current); savedT.current = window.setTimeout(() => setSaved(false), 700); };
  const waveRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [slotHead, setSlotHead] = useState(-1);

  const st = draft ?? parsed;
  const sl = sliceDraft ?? slices;
  // segundos del ORIGINAL que se ven (un loop: su vuelta musical; un sample: entero)
  const loopSecOrig = isLoop ? (warp!.beats * 60) / warp!.srcBpm : 0;
  const waveSec = buf ? (isLoop ? Math.min(buf.duration, loopSecOrig) : buf.duration) : 0;
  // segundos que dura al SONAR (un loop: estirado al tempo del tema; un sample: a su velocidad)
  const speedAbs = Math.pow(2, (st?.semis ?? 0) / 12);
  const playedSec = isLoop ? (warp!.beats * 60) / songBpm : buf ? buf.duration / speedAbs : 0;
  const beats = isLoop ? warp!.beats : 0;

  // ancho del lienzo
  useLayoutEffect(() => {
    const el = waveRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(100, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(100, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // ONDA (mín./máx. por columna, mezcla de canales) + rejilla de tiempos y compases
  useLayoutEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const H = cv.clientHeight || 150;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(cv);
    const color = css.getPropertyValue('--tc').trim() || '#3df0d0';
    // rejilla
    if (beats > 0) {
      for (let k = 0; k <= beats; k++) {
        const x = Math.round((k / beats) * w) + 0.5;
        g.fillStyle = k % bpc === 0 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.12)';
        g.fillRect(x, 0, 1, H);
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, Math.round(H / 2), w, 1);
    if (!buf || !(waveSec > 0)) return;
    const n = Math.min(buf.length, Math.round(waveSec * buf.sampleRate));
    const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    const per = n / w;
    let peak = 1e-4;
    const mins = new Float32Array(w);
    const maxs = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x * per);
      const b = Math.max(a + 1, Math.floor((x + 1) * per));
      let lo = 0, hi = 0;
      const stride = Math.max(1, Math.floor((b - a) / 400)); // muestreo en ondas muy largas
      for (let i = a; i < b; i += stride) {
        let v = 0;
        for (const c of chans) v += c[i] ?? 0;
        v /= chans.length;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      mins[x] = lo;
      maxs[x] = hi;
      peak = Math.max(peak, -lo, hi);
    }
    const k = (H / 2 - 4) / peak;
    g.fillStyle = color;
    g.globalAlpha = 0.85;
    for (let x = 0; x < w; x++) {
      const y1 = H / 2 - maxs[x] * k;
      const y2 = H / 2 - mins[x] * k;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    g.globalAlpha = 1;
  }, [buf, w, waveSec, beats, bpc]);

  // CABEZAL dentro del clip (lo que se oye) y hueco que suena (rebanadas)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = headRef.current;
      const p = parsed;
      let x = -1;
      let slot = -1;
      const s = headOff && !preview ? NaN : heardPatternTime(armPos, preview);
      if (p && Number.isFinite(s) && s >= 0) {
        const pos = (((s / p.cycles) % 1) + 1) % 1; // vuelta del clip
        if (slices && slices.slots.length) {
          if (!slices.weights) slot = Math.floor(pos * slices.slots.length);
          else {
            const tot = slices.weights.reduce((a, b) => a + b, 0);
            let acc = 0;
            for (let i = 0; i < slices.weights.length; i++) { acc += slices.weights[i] / tot; if (pos < acc) { slot = i; break; } }
          }
        } else {
          const ev = p.cycles / cps;
          const reg = (p.end - p.begin) * playedSec;
          const t = pos * ev;
          if (reg > 0 && t <= reg) {
            const f = t / reg;
            x = p.rev ? p.end - f * (p.end - p.begin) : p.begin + f * (p.end - p.begin);
          }
        }
      }
      if (el) { el.style.display = x < 0 ? 'none' : 'block'; if (x >= 0) el.style.left = `${x * 100}%`; }
      setSlotHead(slot);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [parsed, slices, cps, playedSec, headOff, preview, armPos?.start, armPos?.bars, armPos?.total]);

  useEffect(() => {
    if (preview && previewCode) useGraphStore.getState().updateNodeData(id, { seqPreviewCode: previewCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCode]);
  useEffect(() => () => { if (preview) useGraphStore.getState().updateNodeData(id, { solo: false, seqPreviewCode: undefined }); }, [id, preview]);

  if (!parsed || !st) return <p className="seqs-none nodrag">este source no es un sample solo <code>s("nombre")</code></p>;

  const emit = (c: string) => { update(id, { code: wrap ? wrap(c) : c }); pulseSaved(); };
  const ctxOf = (x: ClipState) => ({ regionSec: (x.end - x.begin) * (isLoop ? playedSec : buf ? buf.duration / Math.pow(2, (x.semis ?? 0) / 12) : 0), eventSec: x.cycles / cps });
  const commit = (x: ClipState) => { setDraftState(null); emit(buildClip(x, ctxOf(x))); };
  // un loop: el tramo es su vuelta (tiempos del tramo / tiempos por compás)
  const withRegion = (x: ClipState, b: number, e: number): ClipState => ({ ...x, begin: b, end: e, cycles: isLoop ? Math.max(1 / bpc, Math.round(((e - b) * beats) / bpc * 10000) / 10000) : x.cycles });
  const commitSlices = (n: SliceState) => {
    setSliceDraft(null);
    const raw = buildSliceCode(n);
    const sliceCall = /\.slice\(.*?\)(?=(?:\.slow\([^)]*\))?$)/.exec(raw)?.[0] ?? null;
    commit({ ...st, slice: sliceCall, begin: 0, end: 1, cycles: n.cycles });
  };

  const fracAt = (clientX: number) => {
    const r = waveRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
  };
  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = d;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const f = fracAt(e.clientX);
    if (d.kind === 'b' || d.kind === 'e') {
      const sn = snapFrac(f, beats, e.altKey);
      const min = beats > 0 ? 1 / beats : 0.01;
      const b = d.kind === 'b' ? Math.min(sn, d.st.end - min) : d.st.begin;
      const en = d.kind === 'e' ? Math.max(sn, d.st.begin + min) : d.st.end;
      setDraftState(withRegion(d.st, Math.max(0, b), Math.min(1, en)));
    } else if (d.kind === 'fi' || d.kind === 'fo') {
      const reg = (d.st.end - d.st.begin) * waveSec;
      // al revés, lo que suena primero es el final del tramo: la entrada está a la derecha
      const fromStart = (d.kind === 'fi') !== d.st.rev;
      const secs = Math.max(0, Math.min(reg / 2, (fromStart ? f - d.st.begin : d.st.end - f) * waveSec));
      // el fundido se mide en lo que SUENA (un loop estirado dura otra cosa que el original)
      const k = waveSec > 0 ? playedSec / waveSec : 1;
      const v = Math.round(secs * k * 1000) / 1000;
      setDraftState(d.kind === 'fi' ? { ...d.st, fadeIn: v } : { ...d.st, fadeOut: v });
    } else if (d.kind === 'cut') {
      const cuts = Array.isArray(d.sl.cuts) ? d.sl.cuts : Array.from({ length: (d.sl.cuts ?? 1) + 1 }, (_, i) => i / (d.sl.cuts as number));
      const moved = moveCut(cuts, d.i, e.altKey ? f : snapFrac(f, beats > 0 ? beats * 4 : 256));
      const ts = transientSlices(d.sl.base, moved, d.sl.cycles);
      // los huecos siguen tocando lo mismo; solo cambia cuánto dura cada uno
      setSliceDraft({ ...ts, slots: d.sl.slots.length === ts.slots.length ? d.sl.slots : ts.slots });
    } else if (d.kind === 'bar') {
      setBarDrag({ bar: d.bar, x: f });
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'cut') { if (sliceDraft) commitSlices(sliceDraft); return; }
    if (d.kind === 'bar') {
      const b = barDrag;
      setBarDrag(null);
      if (!b || !isLoop) return;
      const t = tempoFromMarker(b.bar - 1, b.x * waveSec, buf?.duration ?? waveSec, bpc);
      if (!t) { toast.warn('Ese punto no da un tempo razonable (40–300 bpm).'); return; }
      void retuneWarp(id, t.bpm).then((ok) => { if (ok) toast.ok(`Tempo original corregido: ${t.bpm} bpm (${t.beats / bpc} compases).`); });
      return;
    }
    if (draft) commit(draft);
  };

  // AUDICIÓN de un tramo (con lo que lleva el clip: al revés, tono, fundidos)
  const audition = async (b: number, e: number) => {
    if (isOfflineRendering()) return;
    try {
      await ensureAudioReady();
      const sp = (st.rev ? -1 : 1) * (isLoop ? 1 : Math.pow(2, (st.semis || 0) / 12));
      const [bb, ee] = st.rev ? [1 - e, 1 - b] : [b, e];
      await superdough({ s: parsed.name, begin: bb, end: ee, speed: sp, attack: st.fadeIn || undefined }, getAudioContext().currentTime + 0.02, Math.max(0.05, (e - b) * playedSec), 0.5, 0.5);
    } catch (err) {
      console.warn('[editor de loops] no pude tocar el tramo', err);
    }
  };
  const togglePreview = () => {
    const s = useGraphStore.getState();
    const nx = !preview;
    setPreview(nx);
    s.updateNodeData(id, { solo: nx, seqPreviewCode: nx && previewCode ? previewCode : undefined });
    if (nx && !s.playing) void s.play();
  };
  // rebanar
  const cutsOf = (s: SliceState | null): number[] => (!s || s.cuts == null ? [] : Array.isArray(s.cuts) ? s.cuts : Array.from({ length: s.cuts + 1 }, (_, i) => i / (s.cuts as number)));
  const sliceInto = async (kind: 8 | 16 | 32 | 'tr') => {
    const base = `s("${parsed.name}")`;
    if (kind !== 'tr') { commitSlices(evenSlices(base, kind, st.cycles)); setSel(null); return; }
    if (!buf) return;
    const n = Math.min(buf.length, Math.round(waveSec * buf.sampleRate));
    const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).subarray(0, n));
    const on = detectOnsets(chans, buf.sampleRate, { maxCount: 32 });
    const cuts = normalizeCuts(on.map((x) => x / n));
    if (cuts.length < 3) { toast.warn('No encontré golpes claros en este sample: prueba con 8, 16 o 32 iguales.'); return; }
    commitSlices(transientSlices(base, cuts, st.cycles));
    setSel(null);
  };
  const removeSlices = () => { setSel(null); commit({ ...st, slice: null }); };
  const setSlot = (i: number, v: number | null) => {
    if (!sl) return;
    const slots = sl.slots.slice();
    slots[i] = v;
    commitSlices({ ...sl, slots });
  };

  const cuts = cutsOf(sl);
  const nSlices = sl ? sliceCount(sl.cuts) : 0;
  const k = waveSec > 0 ? playedSec / waveSec : 1;
  const fiF = waveSec > 0 ? st.fadeIn / k / waveSec : 0;
  const foF = waveSec > 0 ? st.fadeOut / k / waveSec : 0;
  const full = st.begin <= 0.0005 && st.end >= 0.9995;
  const bi = Math.round(st.begin * beats);
  const ei = Math.round(st.end * beats);
  const regionLabel = full
    ? (isLoop ? 'el loop entero' : 'el sample entero')
    : isLoop
      ? (bi % bpc === 0 && ei % bpc === 0
        ? (ei - bi === bpc ? `compás ${bi / bpc + 1} de ${beats / bpc}` : `compases ${bi / bpc + 1}–${ei / bpc} de ${beats / bpc}`)
        : (ei - bi === 1 ? `tiempo ${bi + 1} de ${beats}` : `tiempos ${bi + 1}–${ei} de ${beats}`))
      : `${fmtSec(st.begin * waveSec)} – ${fmtSec(st.end * waveSec)}`;
  // fundidos: al revés la entrada es el final del tramo del original
  const fiX = st.rev ? st.end - fiF : st.begin + fiF;
  const foX = st.rev ? st.begin + foF : st.end - foF;
  const leftF = st.rev ? foF : fiF;
  const rightF = st.rev ? fiF : foF;
  const bars = beats > 0 ? Math.floor(beats / bpc) : 0;

  return (
    <div className="seqs sedit nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seqs-ctl proll-ctl">
        <button className={`seqs-play${preview ? ' on' : ''}`} onClick={togglePreview} title="aislar y previsualizar esta sección en bucle (luego ESPACIO reproduce/para)">{preview ? '◉' : '▶'}</button>
        <span className="seqs-tag" title={warp?.file ?? parsed.name}>onda · {warp?.file ?? parsed.name}</span>
        <span className={`seqs-saved${saved ? ' on' : ''}`} title="cada cambio se guarda en el código de la sección y suena al instante">● en vivo</span>
        {isLoop && (
          <span className="sedit-warp" title="tempo original del loop y su largo; ÷2 / ×2 si suena al doble o a la mitad. Para afinarlo, arrastra el número de un compás de la regla hasta donde empieza de verdad.">
            <b>{busy ? 'estirando…' : `${warp!.srcBpm} bpm`}</b> · {warp!.beats % bpc === 0 ? `${warp!.beats / bpc} compases` : `${warp!.beats} tiempos`}
            <button onClick={() => void retuneWarp(id, warp!.srcBpm / 2)} title="la mitad">÷2</button>
            <button onClick={() => void retuneWarp(id, warp!.srcBpm * 2)} title="el doble">×2</button>
          </span>
        )}
        {!isWarp && bareSampleName(code.trim()) && (
          <button className="proll-tog" onClick={() => void warpExistingSource(id)} title="estirar este loop al tempo del tema (Rubber Band, sin cambiar el tono): queda en la rejilla y con su rejilla de tiempos aquí">al tempo del tema</button>
        )}
        <span className="sedit-sep" />
        <span className="sedit-info" title="lo que suena del sample (asas de abajo; pegadas a los tiempos, Alt = libre)">{regionLabel}</span>
        {(st.begin > 0 || st.end < 1) && <button className="proll-tog" onClick={() => commit(withRegion(st, 0, 1))} title="volver al sample entero">todo</button>}
        <button className={`proll-tog${st.rev ? ' on' : ''}`} onClick={() => commit({ ...st, rev: !st.rev })} title="al revés (en esta sección)">⇆ al revés</button>
        <span className="proll-zoom sedit-pitch" title={isWarp ? 'tono del clip en semitonos, sin cambiar el tempo (Rubber Band; se suma a la tonalidad del tema)' : 'tono en semitonos por velocidad (como un sampler: también cambia el tempo)'}>
          <span className="seqs-tools-tag">tono</span>
          <button onClick={() => (isWarp ? void setWarpKeyOpts(id, { st: (warp!.st ?? 0) - 1 }) : commit({ ...st, semis: Math.round((st.semis || 0) - 1) }))}>−</button>
          <b>{isWarp ? ((warp!.st ?? 0) > 0 ? `+${warp!.st}` : warp!.st ?? 0) : st.semis > 0 ? `+${st.semis}` : st.semis}</b>
          <button onClick={() => (isWarp ? void setWarpKeyOpts(id, { st: (warp!.st ?? 0) + 1 }) : commit({ ...st, semis: Math.round((st.semis || 0) + 1) }))}>+</button>
        </span>
        <span className="sedit-info" title="fundidos: arrastra las esquinas de arriba del tramo">entra {fmtSec(st.fadeIn)} · sale {fmtSec(st.fadeOut)}</span>
        {(st.fadeIn > 0 || st.fadeOut > 0) && <button className="proll-tog" onClick={() => commit({ ...st, fadeIn: 0, fadeOut: 0 })} title="sin fundidos">sin fundidos</button>}
        <span className="proll-tools sedit-slices" role="group" aria-label="rebanadas">
          <span className="seqs-tools-tag">rebanar</span>
          {([8, 16, 32] as const).map((n) => <button key={n} className={sl?.cuts === n ? 'on' : ''} onClick={() => void sliceInto(n)} title={`${n} rebanadas iguales`}>{n}</button>)}
          <button className={Array.isArray(sl?.cuts) ? 'on' : ''} onClick={() => void sliceInto('tr')} title="cortar en los golpes (transientes)">golpes</button>
          {sl && <button onClick={removeSlices} title="quitar las rebanadas">quitar</button>}
        </span>
      </div>
      {nodeTrim && (
        <p className="seqs-seedline">este Source tiene un <b>recorte del nodo</b> (✂) que manda sobre el tramo de aquí <button className="seqs-unmute" onClick={() => update(id, { begin: 0, end: 1 })}>quitarlo</button></p>
      )}

      <div className="sedit-ruler" style={{ marginLeft: 0 }}>
        {bars > 0 && Array.from({ length: bars }, (_, i) => {
          const bar = i + 1;
          const x = barDrag && barDrag.bar === bar ? barDrag.x : (i * bpc) / beats;
          return (
            <span
              key={bar}
              className={`sedit-bar${barDrag?.bar === bar ? ' drag' : ''}${bar > 1 ? ' movable' : ''}`}
              style={{ left: `${x * 100}%` }}
              onPointerDown={bar > 1 ? (e) => startDrag(e, { kind: 'bar', bar, x }) : undefined}
              onPointerMove={onMove}
              onPointerUp={onUp}
              title={bar > 1 ? `compás ${bar}: arrástralo hasta donde empieza de verdad en la onda para corregir el tempo original` : 'compás 1'}
            >
              {bar}
            </span>
          );
        })}
        {!bars && waveSec > 0 && <span className="sedit-dur">{fmtSec(waveSec)}{st.semis ? ` · suena ${fmtSec(playedSec)}` : ''}</span>}
      </div>
      <div
        className="sedit-wave"
        ref={waveRef}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => { if (sl) { const c = addCut(cuts, fracAt(e.clientX)); if (c.length !== cuts.length) commitSlices({ ...transientSlices(sl.base, c, sl.cycles) }); } }}
        onPointerDown={(e) => {
          if (e.button !== 0 || !sl || !nSlices) return;
          const f = fracAt(e.clientX);
          const kk = cuts.findIndex((c, i) => i < cuts.length - 1 && f >= c && f < cuts[i + 1]);
          if (kk < 0) return;
          if (sel != null) { setSlot(sel, kk); setSel(sel + 1 < sl.slots.length ? sel + 1 : null); }
          const [b, en] = sliceBounds(sl.cuts!, kk);
          void audition(b, en);
        }}
      >
        <canvas ref={cvRef} className="sedit-cv" />
        {!buf && <span className="sedit-msg">{loadErr ? 'no encuentro el audio de este sample (dale ▶ una vez para que cargue)' : 'cargando la onda…'}</span>}
        {/* tramo que suena */}
        {!sl && <div className="sedit-mask" style={{ left: 0, width: `${st.begin * 100}%` }} />}
        {!sl && <div className="sedit-mask" style={{ left: `${st.end * 100}%`, right: 0 }} />}
        {!sl && (
          <svg className="sedit-fades" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={`${st.begin * 1000},100 ${(st.begin + leftF) * 1000},0 ${(st.end - rightF) * 1000},0 ${st.end * 1000},100`} />
          </svg>
        )}
        {!sl && (
          <>
            <div className="sedit-handle b" style={{ left: `${st.begin * 100}%` }} onPointerDown={(e) => startDrag(e, { kind: 'b', st })} onPointerMove={onMove} onPointerUp={onUp} title="inicio de lo que suena (pegado a los tiempos; Alt = libre)" />
            <div className="sedit-handle e" style={{ left: `${st.end * 100}%` }} onPointerDown={(e) => startDrag(e, { kind: 'e', st })} onPointerMove={onMove} onPointerUp={onUp} title="fin de lo que suena" />
            <div className={`sedit-fade fi ${st.rev ? 'r' : 'l'}`} style={{ left: `${fiX * 100}%` }} onPointerDown={(e) => startDrag(e, { kind: 'fi', st })} onPointerMove={onMove} onPointerUp={onUp} title={`fundido de entrada: ${fmtSec(st.fadeIn)} (arrastra)`} />
            <div className={`sedit-fade fo ${st.rev ? 'l' : 'r'}`} style={{ left: `${foX * 100}%` }} onPointerDown={(e) => startDrag(e, { kind: 'fo', st })} onPointerMove={onMove} onPointerUp={onUp} title={`fundido de salida: ${fmtSec(st.fadeOut)} (arrastra)`} />
          </>
        )}
        {/* rebanadas */}
        {sl && cuts.map((c, i) => (i === 0 || i === cuts.length - 1 ? null : (
          <div
            key={i}
            className="sedit-cut"
            style={{ left: `${c * 100}%` }}
            onPointerDown={(e) => startDrag(e, { kind: 'cut', i, sl })}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); commitSlices(transientSlices(sl.base, removeCut(cuts, i), sl.cycles)); }}
            title="corte: arrástralo (Alt = libre) · clic derecho lo quita · doble clic en la onda agrega uno"
          />
        )))}
        {sl && cuts.slice(0, -1).map((c, i) => <span key={`n${i}`} className="sedit-slicen" style={{ left: `${c * 100}%` }}>{i + 1}</span>)}
        <div className="sedit-head" ref={headRef} />
      </div>
      {sl && (
        <div className="slc-slots sedit-slots">
          {sl.slots.map((v, i) => (
            <button
              key={i}
              className={`slc-slot${v == null ? ' rest' : v !== (sl.weights ? i : i % nSlices) ? ' moved' : ''}${i === sel ? ' sel' : ''}${i === slotHead ? ' play' : ''}`}
              style={{ flexGrow: sl.weights ? sl.weights[i] : 1 }}
              onClick={() => { setSel(i === sel ? null : i); if (v != null) { const [b, e] = sliceBounds(sl.cuts!, v); void audition(b, e); } }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSlot(i, v == null ? (sl.weights ? i : i % nSlices) : null); }}
              title={`hueco ${i + 1}: ${v == null ? 'silencio' : `rebanada ${v + 1}`} · clic = elegirlo (luego clic en una rebanada de la onda) · clic derecho = silencio/volver`}
            >
              {v == null ? '·' : v + 1}
            </button>
          ))}
        </div>
      )}
      {sel != null && <p className="seqs-seedline">hueco {sel + 1} elegido: haz clic en una rebanada de la onda para ponerla ahí.</p>}
    </div>
  );
}

export const clipSampleName = (base: string) => nameOf(base);
