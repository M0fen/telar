import { create } from 'zustand';

// Packs de samples CARGADOS por el usuario (además del prebake fijo). Se guardan las
// referencias (`github:user/repo` o URL) en localStorage y se recargan al arrancar,
// para que los sonidos añadidos sigan disponibles entre sesiones.
const KEY = 'telar.packs.v1';
function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function persist(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

interface State {
  packs: string[];
  add: (ref: string) => void;
  remove: (ref: string) => void;
}

export const useSamplePacksStore = create<State>((set, get) => ({
  packs: load(),
  add: (ref) => {
    const r = ref.trim();
    if (!r || get().packs.includes(r)) return;
    const list = [...get().packs, r];
    persist(list);
    set({ packs: list });
  },
  remove: (ref) => {
    const list = get().packs.filter((p) => p !== ref);
    persist(list);
    set({ packs: list });
  },
}));
