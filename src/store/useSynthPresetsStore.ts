import { create } from 'zustand';
import type { SynthParams } from '../graph/types';

// Presets de synth PROPIOS del usuario (los "sonidos guardados"): persisten en
// localStorage y se aplican como cualquier preset. Independiente de los presets de
// fábrica (synthPresets.ts). El Synth Studio guarda el timbre actual con un nombre y
// lo puede volver a emitir (tocar) desde el teclado.
export interface UserSynthPreset {
  id: string;
  name: string;
  params: SynthParams;
  note?: string; // nota/tonalidad base guardada con el sonido
}

const KEY = 'telar.synthpresets.v1';

function load(): UserSynthPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UserSynthPreset[]) : [];
  } catch {
    return [];
  }
}
function persist(list: UserSynthPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* almacenamiento no disponible */
  }
}

interface State {
  presets: UserSynthPreset[];
  save: (name: string, params: SynthParams, note?: string) => void;
  remove: (id: string) => void;
}

export const useSynthPresetsStore = create<State>((set, get) => ({
  presets: load(),
  // guardar: reemplaza si ya existe un preset con el mismo nombre (no duplica).
  save: (name, params, note) => {
    const clean = (name || 'sonido').trim().slice(0, 28);
    const list = [
      ...get().presets.filter((p) => p.name !== clean),
      { id: 'sp_' + Date.now().toString(36), name: clean, params: { ...params }, note },
    ];
    persist(list);
    set({ presets: list });
  },
  remove: (id) => {
    const list = get().presets.filter((p) => p.id !== id);
    persist(list);
    set({ presets: list });
  },
}));
