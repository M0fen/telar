import { create } from 'zustand';

// LANZADOR DE CLIPS (Fase 12.5) — lo que está sonando AHORA en cada pista lanzada (no se guarda con
// el proyecto): pista → patrón en bucle ('silence' = parada). Sin entrada, la pista sigue su arreglo.
// La lógica (lanzar en el compás, grabar la toma al arreglo) vive en lib/launcher.ts.
export interface LaunchEvent { bar: number; track: string; code: string | null } // null = volver al arreglo
interface LaunchState {
  launch: Record<string, string>;
  queued: Record<string, string | null>; // lo que entra en el próximo compás
  rec: boolean;
  recStart: number; // compás de canción donde empezó la toma
  log: LaunchEvent[];
}
export const useLaunchStore = create<LaunchState>(() => ({ launch: {}, queued: {}, rec: false, recStart: 0, log: [] }));
