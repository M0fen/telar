import { create } from 'zustand';

// PANELES ACOPLADOS (Fase 8.6): biblioteca a la izquierda, en vivo / máster a la derecha. Ancho,
// abierto/cerrado (por vista: en la DAW arrancan plegados, la línea de tiempo manda) y la pestaña
// de cada uno se recuerdan en este navegador (no viajan con el proyecto).
const KEY = 'telar.docks';
export const DOCK_RAIL = 26; // ancho del panel plegado (una franja con su nombre)
export const DOCK_MIN = 180;
export const DOCK_MAX = 560;
export type RightTab = 'live' | 'master';
export type DockView = 'std' | 'daw';
type Opens = Record<DockView, { l: boolean; r: boolean }>;

interface Saved { l?: number; r?: number; open?: Opens; rTab?: RightTab }
function read(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
const clampW = (w: unknown, def: number) => {
  const n = Number(w);
  return Number.isFinite(n) ? Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(n))) : def;
};

const saved = read();
// pantallas chicas: arrancan plegados (se abren encima del lienzo)
const small = typeof window !== 'undefined' && window.innerWidth < 900;

interface DockState {
  l: number;
  r: number;
  open: Opens;
  rTab: RightTab;
  setWidth: (side: 'l' | 'r', w: number) => void;
  setOpen: (view: DockView, side: 'l' | 'r', open: boolean) => void;
  setRTab: (view: DockView, t: RightTab) => void;
}

const okOpen = (o: unknown): o is { l: boolean; r: boolean } => !!o && typeof (o as { l: unknown }).l === 'boolean' && typeof (o as { r: unknown }).r === 'boolean';

export const useDockStore = create<DockState>((set, get) => {
  const save = () => {
    const { l, r, open, rTab } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ l, r, open, rTab })); } catch { /* solo esta sesión */ }
  };
  return {
    l: clampW(saved.l, 236),
    r: clampW(saved.r, 288),
    open: {
      std: okOpen(saved.open?.std) ? saved.open!.std : { l: !small, r: !small },
      daw: okOpen(saved.open?.daw) ? saved.open!.daw : { l: false, r: false },
    },
    rTab: saved.rTab === 'master' ? 'master' : 'live',
    setWidth: (side, w) => { set(side === 'l' ? { l: clampW(w, get().l) } : { r: clampW(w, get().r) }); save(); },
    setOpen: (view, side, o) => { set({ open: { ...get().open, [view]: { ...get().open[view], [side]: o } } }); save(); },
    setRTab: (view, rTab) => { set({ rTab, open: { ...get().open, [view]: { ...get().open[view], r: true } } }); save(); },
  };
});

// ancho que ocupa cada lado en una vista (para el lienzo y la línea de tiempo)
export const dockWidth = (s: { l: number; r: number; open: Opens }, view: DockView, side: 'l' | 'r') =>
  side === 'l' ? (s.open[view].l ? s.l : DOCK_RAIL) : s.open[view].r ? s.r : DOCK_RAIL;
