// FREEZE / BOUNCE por rama (3b): rinde la salida de una fuente (con sus FX aguas
// abajo) a un sample local `freeze_*` para aligerar CPU o cachear un sonido pesado.
//
// El motor es EN VIVO (el scheduler no rinde offline fácil), así que capturamos en
// tiempo real: aislamos la fuente (solo temporal), grabamos el bus máster N ciclos y
// registramos el WAV. La grabación tapea `destinationGain` = PRE bus de máster
// (EQ/limiter), por lo que el stem sale limpio, ya con el gain y los FX de la rama.
//
// Alineamos el arranque a un límite de ciclo (con getScheduler().now()) para que el
// bucle "cierre" y grabamos exactamente N ciclos + una cola mínima.
import { getScheduler, registerLocalSample, isStarted } from './engine';
import { startAudioRecording, stopAudioRecording, isAudioRecording } from '../lib/audioRecorder';
import { useGraphStore } from '../store/useGraphStore';
import type { NodeData } from '../graph/types';

export interface FreezeResult { name: string; cycles: number }

const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
let counter = 0;

export async function freezeSource(sourceId: string, cycles: number): Promise<FreezeResult | null> {
  if (!isStarted() || isAudioRecording()) return null;
  const store = useGraphStore.getState();
  const target = store.nodes.find((n) => n.id === sourceId);
  if (!target || target.data.kind !== 'source') return null;

  const cps = store.cps || 0.5;
  const secPerCycle = 1 / cps;
  // hasta 64 ciclos (P2.5): una sección completa de 16 compases (o la canción corta)
  // cabe en un solo freeze — antes el tope de 16 se quedaba corto para stems reales.
  const cyc = Math.max(1, Math.min(64, Math.round(cycles)));

  // 1) guardar el estado de solo y AISLAR la fuente objetivo (recompila 1 vez).
  const prevSolo = new Map<string, boolean>();
  const isoStates: Record<string, Partial<NodeData>> = {};
  for (const n of store.nodes) {
    if (n.data.kind !== 'source') continue;
    prevSolo.set(n.id, !!n.data.solo);
    isoStates[n.id] = { solo: n.id === sourceId };
  }
  store.applyNodeStates(isoStates);

  const restore = () => {
    const rs: Record<string, Partial<NodeData>> = {};
    prevSolo.forEach((v, id) => { rs[id] = { solo: v }; });
    useGraphStore.getState().applyNodeStates(rs);
  };

  try {
    // 2) dejar que el hot-swap del aislamiento asiente, luego alinear a límite de ciclo.
    await wait(240);
    const sched = getScheduler();
    if (sched) {
      const now = sched.now();
      const frac = now - Math.floor(now);
      await wait((1 - frac) * secPerCycle * 1000 + 6);
    }
    // 3) grabar exactamente N ciclos (+ cola corta para colas de reverb/decay).
    if (!(await startAudioRecording())) { restore(); return null; }
    await wait(cyc * secPerCycle * 1000 + 40);
    const blob = await stopAudioRecording();
    restore();
    if (!blob) return null;
    const name = `freeze_${++counter}_${Math.random().toString(36).slice(2, 5)}`;
    await registerLocalSample(name, blob);
    return { name, cycles: cyc };
  } catch {
    try { void stopAudioRecording(); } catch { /* ya parado */ }
    restore();
    return null;
  }
}
