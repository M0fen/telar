// LANZADOR DE CLIPS (Fase 12.5) — acciones: lanzar en el 1 del próximo compás (una pista, una fila
// entera), parar, volver al arreglo, y GRABAR LA TOMA: lo que lanzas mientras graba queda en el
// arreglo al parar (un paso de deshacer).
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { useLaunchStore, type LaunchEvent } from '../store/useLaunchStore';
import { toast } from '../store/useNotifyStore';
import { audioNow, nextBarAudioTime } from '../audio/engine';
import { timelinePos } from './songClock';
import { buildTake } from './launchTake';
import { newStepId } from './arrangeEdit';

const st = () => useLaunchStore.getState();
let timer: number | undefined;
let pending: Record<string, string | null> = {};

function apply(changes: Record<string, string | null>, bar: number): void {
  const launch = { ...st().launch };
  for (const [id, code] of Object.entries(changes)) {
    if (code == null) delete launch[id];
    else launch[id] = code;
  }
  const log: LaunchEvent[] = st().rec ? [...st().log, ...Object.entries(changes).map(([track, code]) => ({ bar, track, code }))] : st().log;
  useLaunchStore.setState({ launch, queued: {}, log });
  useGraphStore.getState().recompile();
}

// lanza (o para con 'silence', o devuelve al arreglo con null) en el 1 del próximo compás
export function launch(changes: Record<string, string | null>): void {
  const g = useGraphStore.getState();
  pending = { ...pending, ...changes };
  useLaunchStore.setState({ queued: { ...pending } });
  window.clearTimeout(timer);
  if (!g.playing) {
    const ch = pending;
    pending = {};
    apply(ch, 0);
    void g.play();
    return;
  }
  const bar = nextBarAudioTime(0.04);
  // el planificador consulta ~latencia + intervalo antes de que suene: el código nuevo entra ahí
  const delay = bar ? Math.max(0, bar.at - audioNow() - 0.19) : 0;
  const songBar = bar ? Math.round(timelinePos(bar.cycle, useSongStore.getState())) : 0;
  timer = window.setTimeout(() => {
    const ch = pending;
    pending = {};
    apply(ch, songBar);
  }, delay * 1000);
}

export const stopAllClips = () => launch(Object.fromEntries(trackIds().map((id) => [id, 'silence'])));
export function backToArrangement(): void {
  const ids = [...new Set([...Object.keys(st().launch), ...Object.keys(pending)])];
  if (ids.length) launch(Object.fromEntries(ids.map((id) => [id, null])));
}
const trackIds = () => useGraphStore.getState().nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions) && !n.data.djTrack).map((n) => n.id);

// ● GRABAR LA TOMA: desde el próximo compás; al parar, lo lanzado pasa al arreglo
export function toggleTakeRec(): void {
  const g = useGraphStore.getState();
  if (!st().rec) {
    const bar = g.playing ? nextBarAudioTime(0.04) : null;
    const start = bar ? Math.round(timelinePos(bar.cycle, useSongStore.getState())) : 0;
    // lo que ya está lanzado cuenta desde el principio de la toma
    const log: LaunchEvent[] = Object.entries(st().launch).map(([track, code]) => ({ bar: start, track, code }));
    useLaunchStore.setState({ rec: true, recStart: start, log });
    if (!g.playing) void g.play();
    toast.info(`Grabando la toma desde el compás ${start + 1}: lanza clips y filas; al parar «● grabar» queda en el arreglo.`);
    return;
  }
  const bar = g.playing ? nextBarAudioTime(0) : null;
  const end = bar ? Math.round(timelinePos(bar.cycle, useSongStore.getState())) : st().recStart;
  const { recStart, log } = st();
  useLaunchStore.setState({ rec: false });
  const codes: Record<string, string> = {};
  for (const n of g.nodes) if (n.data.kind === 'source' && !Array.isArray(n.data.transitions)) codes[n.id] = n.data.code ?? '';
  const r = buildTake(codes, useSongStore.getState().steps.map((s) => ({ ...s })), log, recStart, Math.max(end, recStart + 1), newStepId);
  if (!r) { toast.info('La toma quedó vacía: no lanzaste nada mientras grababa.'); return; }
  // la canción sigue: ya no hace falta el lanzador para oír la toma
  useLaunchStore.setState({ launch: {}, queued: {}, log: [] });
  g.applyArrangement(r.codes, r.steps);
  toast.ok(`La toma (compases ${recStart + 1}–${end}) está en el arreglo. Ctrl+Z la deshace.`);
}
