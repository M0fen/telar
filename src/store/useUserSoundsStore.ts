import { create } from 'zustand';

// Sonidos del USUARIO disponibles como s("nombre"): samples importados/guardados
// (packs + archivos sueltos). Es una vista reactiva para que el SECUENCIADOR y demás
// selectores ofrezcan tus sonidos sin escribir código. Se llena desde userPacks
// (registerFile/registerPack) y se hidrata de los packs guardados al arrancar.

interface State {
  sounds: string[];
  add: (...names: string[]) => void;
  clear: () => void;
}

export const useUserSoundsStore = create<State>((set, get) => ({
  sounds: [],
  add: (...names) => {
    const clean = names
      .map((n) => String(n || '').trim())
      .filter(Boolean);
    if (!clean.length) return;
    const cur = get().sounds;
    const next = [...cur];
    for (const n of clean) if (!next.includes(n)) next.push(n);
    if (next.length !== cur.length) set({ sounds: next });
  },
  clear: () => set({ sounds: [] }),
}));
