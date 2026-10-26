import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useMidiStore } from '../store/useMidiStore';
import { getScheduler } from '../audio/engine';
import { playSlice, armSlicePads, learnSlicePads, useSlicePadsStore } from '../audio/slicePads';
import { warpOriginalBuffer } from '../audio/warpLoops';
import { loadSampleBuffer } from '../audio/previewSample';
import { toast } from '../store/useNotifyStore';
import type { WarpInfo } from '../lib/loopWarp';
import {
  parseSliceCode,
  buildSliceCode,
  evenSlices,
  transientSlices,
  normalizeCuts,
  detectOnsets,
  sliceCount,
  shuffleSlots,
  reverseSlots,
  type SliceState,
} from '../lib/slicer';

// REBANADOR (Fase 5.4): el loop en 8 / 16 / 32 rebanadas o en sus transientes. Arriba, los HUECOS
// de la vuelta (qué rebanada suena en cada uno); abajo, las REBANADAS (clic = escuchar; con un
// hueco elegido, clic = ponerla ahí y pasar al siguiente). Clic derecho en un hueco = silencio.
// «pads» arma este Source para el controlador MIDI: el primer pad toca la rebanada 1.

const nameOf = (base: string) => /["'`]([A-Za-z0-9_]+)["'`]/.exec(base)?.[1] ?? '';

async function transientCuts(name: string, warp?: WarpInfo): Promise<number[] | null> {
  const buf = warp ? await warpOriginalBuffer(warp) : await loadSampleBuffer(name);
  if (!buf) return null;
  // la vuelta musical del original (un loop de Splice puede traer cola); un sample suelto: entero
  const loop = warp && !warp.shot && warp.srcBpm > 0 ? (warp.beats * 60 * buf.sampleRate) / warp.srcBpm : buf.length;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const on = detectOnsets(chans, buf.sampleRate, { maxCount: 32 });
  return normalizeCuts(on.map((f) => f / loop));
}

export function SliceStrip({ id, code, warp }: { id: string; code: string; warp?: WarpInfo }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const st = useMemo(() => parseSliceCode(code), [code]);
  const [sel, setSel] = useState<number | null>(null);
  const [head, setHead] = useState(-1);
  const [busy, setBusy] = useState(false);
  const armed = useSlicePadsStore((s) => s.armed === id);
  const learning = useSlicePadsStore((s) => s.learning);
  const base = useSlicePadsStore((s) => s.base);
  const hit = useSlicePadsStore((s) => (s.armed === id ? s.hit : null));
  const midiOn = useMidiStore((s) => s.on);
  const stRef = useRef(st);
  stRef.current = st;

  // cabezal: qué hueco suena ahora (posición en la vuelta)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = stRef.current;
      const now = getScheduler()?.now?.();
      if (s && s.cuts != null && typeof now === 'number' && s.slots.length) {
        const pos = (((now % s.cycles) + s.cycles) % s.cycles) / s.cycles;
        let k = -1;
        if (!s.weights) k = Math.floor(pos * s.slots.length);
        else {
          const tot = s.weights.reduce((a, b) => a + b, 0);
          let acc = 0;
          for (let i = 0; i < s.weights.length; i++) { acc += s.weights[i] / tot; if (pos < acc) { k = i; break; } }
        }
        setHead(k);
      } else setHead(-1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  // al desmontar (cerrar el rebanador / borrar el nodo) los pads se sueltan
  useEffect(() => () => { if (useSlicePadsStore.getState().armed === id) armSlicePads(null); }, [id]);

  if (!st) return <div className="slc nodrag"><p className="gate-hint">El rebanador funciona con un sample solo: <code>s("nombre")</code> (y su <code>.slow</code>). En un arreglo, rebánalo antes de partirlo en secciones.</p></div>;

  const commit = (next: SliceState) => update(id, { code: buildSliceCode(next) });
  const n = sliceCount(st.cuts);
  const cut = async (kind: 8 | 16 | 32 | 'tr') => {
    if (kind !== 'tr') { commit(evenSlices(st.base, kind, st.cycles)); setSel(null); return; }
    setBusy(true);
    try {
      const cuts = await transientCuts(nameOf(st.base), warp);
      if (!cuts || cuts.length < 3) { toast.warn('No encontré transientes claros en este sample: prueba con 8, 16 o 32 iguales.'); return; }
      commit(transientSlices(st.base, cuts, st.cycles));
      setSel(null);
      toast.ok(`${cuts.length - 1} rebanadas en los golpes del loop. En orden suena igual que el original.`);
    } finally {
      setBusy(false);
    }
  };
  const setSlot = (i: number, v: number | null) => {
    const slots = st.slots.slice();
    slots[i] = v;
    commit({ ...st, slots });
  };
  const pickSlice = (k: number) => {
    void playSlice(id, k);
    if (sel == null) return;
    setSlot(sel, k);
    setSel(sel + 1 < st.slots.length ? sel + 1 : null);
  };

  return (
    // clic derecho dentro del rebanador = silencio de un hueco, nunca el mute del nodo
    <div className="slc nodrag" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <div className="gate-ctl">
        <span className="gate-tag">rebanar</span>
        <div className="slc-cuts">
          {([8, 16, 32] as const).map((k) => (
            <button key={k} className={st.cuts === k ? 'on' : ''} onClick={() => void cut(k)} title={`${k} rebanadas iguales`}>{k}</button>
          ))}
          <button className={Array.isArray(st.cuts) ? 'on' : ''} disabled={busy} onClick={() => void cut('tr')} title="cortar en los golpes (transientes): cada rebanada es un golpe del loop">
            {busy ? '…' : 'golpes'}
          </button>
        </div>
        {st.cuts != null && (
          <button className="gate-clear" onClick={() => { armSlicePads(null); commit({ ...st, cuts: null, slots: [], weights: null }); }} title="quitar las rebanadas: el loop entero otra vez">quitar</button>
        )}
      </div>
      {st.cuts == null ? (
        <p className="gate-hint">Parte el loop para <b>reordenarlo</b>: elige cuántas rebanadas (o «golpes» para cortar en cada golpe).</p>
      ) : (
        <>
          <div className="slc-slots">
            {st.slots.map((v, i) => (
              <button
                key={i}
                className={`slc-slot${v == null ? ' rest' : v !== (st.weights ? i : i % n) ? ' moved' : ''}${i === sel ? ' sel' : ''}${i === head ? ' play' : ''}`}
                style={{ flexGrow: st.weights ? st.weights[i] : 1 }}
                onClick={() => { setSel(i === sel ? null : i); if (v != null) void playSlice(id, v); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSlot(i, v == null ? (st.weights ? i : i % n) : null); }}
                title={`hueco ${i + 1}: ${v == null ? 'silencio' : `rebanada ${v + 1}`} · clic = elegirlo (y escuchar) · clic derecho = silencio/volver`}
              >
                {v == null ? '·' : v + 1}
              </button>
            ))}
          </div>
          <div className="slc-pads">
            {Array.from({ length: n }, (_, k) => (
              <button
                key={k}
                className={`slc-pad${hit && hit.slice === k && performance.now() - hit.at < 250 ? ' hit' : ''}`}
                onClick={() => pickSlice(k)}
                title={sel != null ? `poner la rebanada ${k + 1} en el hueco ${sel + 1}` : `escuchar la rebanada ${k + 1}`}
              >
                {k + 1}
              </button>
            ))}
          </div>
          <div className="gate-ctl">
            <button className="slc-op" onClick={() => commit({ ...st, slots: st.weights ? st.slots.map((_, i) => i) : st.slots.map((_, i) => i % n) })} title="cada rebanada en su sitio (el loop original)">normal</button>
            <button className="slc-op" onClick={() => commit({ ...st, slots: reverseSlots(st.slots) })} title="los huecos al revés">al revés</button>
            <button className="slc-op" onClick={() => commit({ ...st, slots: shuffleSlots(st.slots) })} title="reordenar al azar (deshaz con Ctrl+Z)">al azar</button>
            <button
              className={`slc-op slc-midi${armed ? ' on' : ''}`}
              onClick={() => armSlicePads(armed ? null : id)}
              title={midiOn ? 'tocar las rebanadas con los pads del controlador (el primer pad = rebanada 1)' : 'activa el MIDI en «MIDI en vivo» para tocar con los pads'}
            >
              pads
            </button>
          </div>
          {armed && (
            <p className="gate-hint">
              {!midiOn ? 'Activa el MIDI en «MIDI en vivo» para que lleguen los pads. ' : ''}
              {learning ? <b>toca el pad que será la rebanada 1…</b> : <>pad nota {base} = rebanada 1 · <button className="slc-link" onClick={learnSlicePads}>aprender el primer pad</button></>}
            </p>
          )}
          {sel != null && <p className="gate-hint">hueco {sel + 1} elegido: toca una rebanada de abajo para ponerla ahí.</p>}
        </>
      )}
    </div>
  );
}
