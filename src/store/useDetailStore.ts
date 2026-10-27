import { create } from 'zustand';

// PANEL DE DETALLE (Fase 9.2): abajo, entre los paneles laterales. Edita en grande la pista elegida
// (doble clic en un bloque del DAW, E, o «abajo» en el nodo) en la sección `arm`. Su alto se
// recuerda en este navegador.
const KEY = 'telar.detail.h';
export const DETAIL_MIN = 180;
const readH = () => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= DETAIL_MIN && v <= 900 ? v : 380;
  } catch {
    return 380;
  }
};

interface DetailState {
  nodeId: string | null;
  arm: number; // sección del arrange que se edita (-1 = la que elija el editor)
  nonce: number; // distingue pedidos repetidos (volver a la misma sección)
  h: number;
  open: (nodeId: string, arm?: number) => void;
  close: () => void;
  setH: (h: number) => void;
}

let n = 0;
export const useDetailStore = create<DetailState>((set) => ({
  nodeId: null,
  arm: -1,
  nonce: 0,
  h: readH(),
  open: (nodeId, arm = -1) => set({ nodeId, arm, nonce: ++n }),
  close: () => set({ nodeId: null }),
  setH: (h) => {
    const v = Math.max(DETAIL_MIN, Math.min(Math.round(window.innerHeight * 0.75), Math.round(h)));
    set({ h: v });
    try { localStorage.setItem(KEY, String(v)); } catch { /* solo esta sesión */ }
  },
}));
