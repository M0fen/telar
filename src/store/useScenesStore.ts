import { create } from 'zustand';
import type { ChannelComp, ChannelEq, NodeData } from '../graph/types';
import { withoutMomentary, type MasterFx } from '../graph/compile';
import { useGraphStore, saveProjectSoon } from './useGraphStore';
import { savedProject, startupScenes, readLegacy, LEGACY_SCENES_KEY } from '../lib/projectStore';

// Escenas / bancos de patrones disparables (Fase A — performance en vivo). Una
// escena NO recarga el grafo (eso es la galería): captura el ESTADO de mezcla de
// cada nodo —mute, solo, gain, filtro, pan, EQ y compresor de canal y params de fx/transform—
// MÁS el estado del MÁSTER (P2.1: un "drop" puede abrir el filtro del máster o
// cambiar su groove), y al dispararla lo reaplica de golpe. Teclas 1–9.
// Son PARTE DEL PROYECTO (estado por nodeId de este grafo): las guarda el autoguardado y
// viajan al exportar/compartir; cargar otro proyecto trae las suyas o ninguna.

// Parche de estado por nodo que guarda una escena.
export interface SceneState {
  mute?: boolean;
  solo?: boolean;
  gain?: number;
  chFilter?: number;
  chPan?: number;
  eq?: ChannelEq;
  comp?: ChannelComp; // compresor del canal (Fase 6.1)
  params?: Record<string, number | string>;
}

export interface Scene {
  slot: number; // 1..9
  name: string;
  state: Record<string, SceneState>; // por nodeId
  master?: Partial<MasterFx>; // máster al capturar, SIN pads momentáneos (escenas viejas no lo traen → no se toca)
  savedAt: number;
}


// Toma del grafo actual el estado "tocable" de cada nodo (lo que una escena recuerda).
function snapshotState(): Record<string, SceneState> {
  const out: Record<string, SceneState> = {};
  for (const n of useGraphStore.getState().nodes) {
    const d = n.data as NodeData;
    // mute/solo SIEMPRE (como booleanos) para que disparar la escena restaure el
    // estado completo de la mezcla, no solo encienda. gain/filtro/params si existen.
    const s: SceneState = { mute: !!d.mute, solo: !!d.solo };
    if (typeof d.gain === 'number') s.gain = d.gain;
    if (typeof d.chFilter === 'number') s.chFilter = d.chFilter;
    if (typeof d.chPan === 'number') s.chPan = d.chPan;
    if (d.eq) s.eq = { ...d.eq };
    if (d.comp) s.comp = { ...d.comp };
    if (d.params && Object.keys(d.params).length) s.params = { ...d.params };
    out[n.id] = s;
  }
  return out;
}

interface ScenesStore {
  scenes: Record<number, Scene>;
  active: number | null; // última escena disparada (resaltada)
  capture: (slot: number, name?: string) => void;
  trigger: (slot: number) => void;
  clear: (slot: number) => void;
  rename: (slot: number, name: string) => void;
  // Reemplaza el banco entero (cargar proyecto / deshacer una carga).
  replace: (scenes: Record<number, Scene>) => void;
}

export const useScenesStore = create<ScenesStore>((set, get) => ({
  scenes: startupScenes(savedProject(), readLegacy(LEGACY_SCENES_KEY)),
  active: null,

  capture: (slot, name) => {
    const prev = get().scenes[slot];
    const scene: Scene = {
      slot,
      name: name ?? prev?.name ?? `escena ${slot}`,
      state: snapshotState(),
      master: withoutMomentary(useGraphStore.getState().master), // el máster forma parte de la escena (sin pads sostenidos)
      savedAt: Date.now(),
    };
    set({ scenes: { ...get().scenes, [slot]: scene }, active: slot });
  },

  trigger: (slot) => {
    const scene = get().scenes[slot];
    if (!scene) return;
    // SceneState es estructuralmente un Partial<NodeData> (mute/solo/gain/chFilter/
    // chPan/eq/params); el cast salva la firma de índice de NodeData.
    useGraphStore.getState().applyNodeStates(scene.state as Record<string, Partial<NodeData>>);
    // máster de la escena (si lo capturó): filtro/groove/bus del "drop" saltan también.
    // (sin roll/gate/rev/½ tiempo: escenas viejas pueden traerlos y no deben pegarse ni cortar un pad apretado)
    if (scene.master) useGraphStore.getState().setMaster(withoutMomentary(scene.master));
    set({ active: slot });
  },

  clear: (slot) => {
    const scenes = { ...get().scenes };
    delete scenes[slot];
    set({ scenes, active: get().active === slot ? null : get().active });
  },

  rename: (slot, name) => {
    const cur = get().scenes[slot];
    if (!cur) return;
    set({ scenes: { ...get().scenes, [slot]: { ...cur, name } } });
  },

  replace: (scenes) => set({ scenes, active: null }),
}));

// Autoguardado: las escenas viajan dentro del proyecto. Se suscribe AQUÍ (no en
// useGraphStore) porque los dos módulos se importan entre sí: desde aquí el store ya
// existe al suscribirse sea cual sea el orden de carga. `active` no se guarda.
useScenesStore.subscribe((s, p) => {
  if (s.scenes !== p.scenes) saveProjectSoon();
});
