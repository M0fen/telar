import { create } from 'zustand';
import { patternStore, type SavedPattern } from '../lib/patternStore';

// Biblioteca reactiva de patrones guardados (envuelve patternStore).
interface LibraryState {
  patterns: SavedPattern[];
  save: (name: string, code: string) => void;
  remove: (id: string) => void;
  refresh: () => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  patterns: patternStore.list(),
  save: (name, code) => {
    patternStore.save({ name, code });
    set({ patterns: patternStore.list() });
  },
  remove: (id) => {
    patternStore.remove(id);
    set({ patterns: patternStore.list() });
  },
  refresh: () => set({ patterns: patternStore.list() }),
}));
