import { create } from 'zustand';
import type { ChannelEq, NodeData } from '../graph/types';
import type { MasterFx } from '../graph/compile';
import { useGraphStore } from './useGraphStore';

// Escenas / bancos de patrones disparables (Fase A — performance en vivo). Una
// escena NO recarga el grafo (eso es la galería): captura el ESTADO de mezcla de
// cada nodo —mute, solo, gain, filtro, pan, EQ de canal y params de fx/transform—
// MÁS el estado del MÁSTER (P2.1: un "drop" puede abrir el filtro del máster o
// cambiar su groove), y al dispararla lo reaplica de golpe. Teclas 1–9.
// Persistido en localStorage por proyecto vivo.

// Parche de estado por nodo que guarda una escena.
export interface SceneState {
  mute?: boolean;
  solo?: boolean;
  gain?: number;
  chFilter?: number;
  chPan?: number;
  eq?: ChannelEq;
  params?: Record<string, number | string>;
}

export interface Scene {
  slot: number; // 1..9
  name: string;
  state: Record<string, SceneState>; // por nodeId
  master?: MasterFx; // estado del máster al capturar (escenas viejas no lo traen → no se toca)
  savedAt: number;
}

const KEY = 'telar.scenes.v1';

function load(): Record<number, Scene> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<number, Scene>;
  } catch {
    return {};
  }
}
function persist(scenes: Record<number, Scene>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(scenes));
  } catch (e) {
    console.warn('scenes: no se pudo guardar', e);
  }
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
}

export const useScenesStore = create<ScenesStore>((set, get) => ({
  scenes: load(),
  active: null,

  capture: (slot, name) => {
    const prev = get().scenes[slot];
    const scene: Scene = {
      slot,
      name: name ?? prev?.name ?? `escena ${slot}`,
      state: snapshotState(),
      master: { ...useGraphStore.getState().master }, // el máster forma parte de la escena
      savedAt: Date.now(),
    };
    const scenes = { ...get().scenes, [slot]: scene };
    persist(scenes);
    set({ scenes, active: slot });
  },

  trigger: (slot) => {
    const scene = get().scenes[slot];
    if (!scene) return;
    // SceneState es estructuralmente un Partial<NodeData> (mute/solo/gain/chFilter/
    // chPan/eq/params); el cast salva la firma de índice de NodeData.
    useGraphStore.getState().applyNodeStates(scene.state as Record<string, Partial<NodeData>>);
    // máster de la escena (si lo capturó): filtro/groove/bus del "drop" saltan también.
    if (scene.master) useGraphStore.getState().setMaster(scene.master);
    set({ active: slot });
  },

  clear: (slot) => {
    const scenes = { ...get().scenes };
    delete scenes[slot];
    persist(scenes);
    set({ scenes, active: get().active === slot ? null : get().active });
  },

  rename: (slot, name) => {
    const cur = get().scenes[slot];
    if (!cur) return;
    const scenes = { ...get().scenes, [slot]: { ...cur, name } };
    persist(scenes);
    set({ scenes });
  },
}));
