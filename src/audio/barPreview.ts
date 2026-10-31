// AUDICIÓN EN EL COMPÁS (10.4): un sonido que entra en el 1 del próximo compás (si suena el tema) y
// dura `cycles` compases; parado, suena ya. Se corta al pedir otra.
import { superdough, getAudioContext } from '@strudel/web';
import { ensureAudioReady, ensureEngine, nextBarAudioTime } from './engine';
import { useGraphStore } from '../store/useGraphStore';

export async function previewAtNextBar(name: string, cycles: number): Promise<boolean> {
  try {
    await ensureEngine();
    await ensureAudioReady();
    const ctx = getAudioContext();
    const cps = useGraphStore.getState().cps || 0.5;
    const bar = useGraphStore.getState().playing ? nextBarAudioTime(0.05) : null;
    const at = bar?.at ?? ctx.currentTime + 0.03;
    await superdough({ s: name, gain: 0.9, orbit: 1 }, at, Math.max(0.1, cycles / cps), cps, 0);
    return true;
  } catch {
    return false;
  }
}
