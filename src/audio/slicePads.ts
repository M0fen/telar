// REBANADOR (Fase 5.4) — tocar rebanadas: audición (clic) y PADS del controlador MIDI (M-Wave).
// Un Source «armado» recibe las notas libres del controlador: el pad base (36 = el primero de un
// banco de 16 pads, o el que aprendas) toca la rebanada 1, el siguiente la 2… Suena por superdough
// (pasa por el bus del máster como todo lo demás), sin la cadena de efectos del nodo: es para
// tocar y probar; para que quede en el tema, la rejilla de huecos (o grabar, Fase 7.1).
import { create } from 'zustand';
import { superdough, getAudioContext } from '@strudel/web';
import { ensureAudioReady, isOfflineRendering } from './engine';
import { setNoteSink } from './midiIn';
import { useGraphStore } from '../store/useGraphStore';
import { parseSliceCode, sliceBounds, sliceCount } from '../lib/slicer';

const BASE_KEY = 'telar.slicepads.base';
const loadBase = () => {
  try {
    const v = Number(localStorage.getItem(BASE_KEY));
    return v >= 0 && v <= 127 && localStorage.getItem(BASE_KEY) != null ? v : 36;
  } catch {
    return 36;
  }
};

interface PadsState {
  armed: string | null; // id del Source que tocan los pads
  base: number; // nota del primer pad
  learning: boolean; // el próximo pad que toques será la rebanada 1
  hit: { slice: number; at: number } | null; // última rebanada tocada (para iluminarla)
}
export const useSlicePadsStore = create<PadsState>(() => ({ armed: null, base: loadBase(), learning: false, hit: null }));

const nameOf = (base: string) => /["'`]([A-Za-z0-9_]+)["'`]/.exec(base)?.[1] ?? null;

// toca la rebanada i de un Source (audición o pad); vel 0..1
export async function playSlice(nodeId: string, i: number, vel = 0.9): Promise<void> {
  if (isOfflineRendering()) return;
  const n = useGraphStore.getState().nodes.find((x) => x.id === nodeId);
  const st = parseSliceCode(n?.data.code ?? '');
  const name = st && nameOf(st.base);
  if (!st || !st.cuts || !name || i < 0 || i >= sliceCount(st.cuts)) return;
  const [begin, end] = sliceBounds(st.cuts, i);
  try {
    await ensureAudioReady();
    // fuerza del pad × fader de la pista, como VELOCITY (igual que el patrón: el gain por defecto
    // de superdough queda, así el golpe del pad suena al nivel de la rebanada en el patrón)
    const velocity = Math.max(0.05, Math.min(1, vel)) * Math.min(1.5, Number(n?.data.gain ?? 1));
    // la duración real la pone superdough (lo que dura la rebanada en el buffer)
    await superdough({ s: name, begin, end, velocity }, getAudioContext().currentTime + 0.01, 1, 0.5, 0.5);
    useSlicePadsStore.setState({ hit: { slice: i, at: performance.now() } });
  } catch (e) {
    console.warn('[rebanador] no pude tocar la rebanada', e);
  }
}

function sink(note: number, vel: number, down: boolean): void {
  if (!down) return;
  const s = useSlicePadsStore.getState();
  if (!s.armed) return;
  if (s.learning) {
    try { localStorage.setItem(BASE_KEY, String(note)); } catch { /* sin almacenamiento */ }
    useSlicePadsStore.setState({ base: note, learning: false });
    return;
  }
  void playSlice(s.armed, note - s.base, vel);
}

// arma (o desarma) los pads para un Source; solo uno a la vez
export function armSlicePads(nodeId: string | null): void {
  useSlicePadsStore.setState({ armed: nodeId, learning: false });
  setNoteSink(nodeId ? sink : null);
}
export const learnSlicePads = () => useSlicePadsStore.setState({ learning: true });
