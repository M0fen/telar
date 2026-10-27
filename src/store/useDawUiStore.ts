import { create } from 'zustand';
import { GRID_OPTIONS, type GridId } from '../lib/dawGrid';

// Preferencias de la VISTA DAW (Fase 8): son del usuario y de este navegador, no del proyecto
// (no viajan al compartir). Se guardan en localStorage; si no hay almacenamiento, solo esta sesión.
const KEY = 'telar.daw.ui';

interface Saved {
  grid?: GridId;
  follow?: boolean;
}

function read(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function write(patch: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    /* sin almacenamiento: solo esta sesión */
  }
}

const saved = read();

interface DawUiState {
  grid: GridId; // rejilla magnética (8.1)
  setGrid: (g: GridId) => void;
  follow: boolean; // la vista sigue al cabezal mientras suena (8.4)
  setFollow: (on: boolean) => void;
}

export const useDawUiStore = create<DawUiState>((set) => ({
  grid: GRID_OPTIONS.some((o) => o.id === saved.grid) ? (saved.grid as GridId) : 'auto',
  setGrid: (grid) => { set({ grid }); write({ grid }); },
  follow: saved.follow !== false,
  setFollow: (follow) => { set({ follow }); write({ follow }); },
}));
