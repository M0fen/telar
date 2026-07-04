import { create } from 'zustand';

// Favoritos + recientes de la biblioteca de sonidos (tu paleta a mano). Se persisten en
// localStorage. REGLA zustand v5: los selectores devuelven los campos `favs`/`recents`
// (refs estables), nunca arrays nuevos derivados.
const KEY = 'telar.soundfav.v1';
const MAX_RECENT = 24;

interface Persisted { favs: string[]; recents: string[] }
function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
    return { favs: Array.isArray(p.favs) ? p.favs : [], recents: Array.isArray(p.recents) ? p.recents : [] };
  } catch {
    return { favs: [], recents: [] };
  }
}
function persist(p: Persisted): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* */ }
}

interface State {
  favs: string[];
  recents: string[];
  toggleFav: (name: string) => void;
  addRecent: (name: string) => void;
}

export const useSoundFavStore = create<State>((set, get) => {
  const init = load();
  return {
    favs: init.favs,
    recents: init.recents,
    toggleFav: (name) => {
      const has = get().favs.includes(name);
      const favs = has ? get().favs.filter((n) => n !== name) : [name, ...get().favs];
      persist({ favs, recents: get().recents });
      set({ favs });
    },
    addRecent: (name) => {
      const recents = [name, ...get().recents.filter((n) => n !== name)].slice(0, MAX_RECENT);
      persist({ favs: get().favs, recents });
      set({ recents });
    },
  };
});
