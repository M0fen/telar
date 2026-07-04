import { create } from 'zustand';
import type { ProjectSnapshot } from '../lib/projectStore';

// Galería de proyectos completos guardados en localStorage. Cada entrada es un
// snapshot del mapa entero (nodos, sources, cables, cps, máster, viz). Cargar una
// reemplaza el lienzo. Es distinto del autoguardado (un solo proyecto "en vivo"):
// la galería son respaldos con nombre a los que volver rápido.
export interface GalleryEntry {
  id: string;
  name: string;
  savedAt: number;
  snap: Partial<ProjectSnapshot>;
}

const KEY = 'telar.gallery.v1';
const MAX = 40;

function load(): GalleryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as GalleryEntry[];
  } catch {
    return [];
  }
}
function persist(entries: GalleryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('gallery: no se pudo guardar', e);
  }
}

interface GalleryState {
  entries: GalleryEntry[];
  save: (name: string, snap: Partial<ProjectSnapshot>) => void;
  remove: (id: string) => void;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  entries: load(),
  save: (name, snap) => {
    const entry: GalleryEntry = {
      id: `g_${Date.now()}`,
      name: name.trim() || 'proyecto',
      savedAt: Date.now(),
      snap,
    };
    const entries = [entry, ...get().entries].slice(0, MAX);
    persist(entries);
    set({ entries });
  },
  remove: (id) => {
    const entries = get().entries.filter((e) => e.id !== id);
    persist(entries);
    set({ entries });
  },
}));
