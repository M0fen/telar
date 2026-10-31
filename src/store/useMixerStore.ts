import { create } from 'zustand';
import { useDetailStore } from './useDetailStore';

// MEZCLADOR (Fase 11): panel de abajo (donde va el editor en grande; uno u otro). Tiras de las pistas,
// retornos y máster; a la derecha el INSPECTOR de la pista elegida: EQ visual, compresor, cadena y
// macros, el análisis del máster o el escenario espacial. Lo abierto y la pestaña se recuerdan.
export type MixTab = 'eq' | 'comp' | 'chain' | 'master' | 'stage';
const KEY = 'telar.mixer';
const read = (): { tab?: MixTab } => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };

interface MixerState {
  open: boolean;
  sel: string | null; // pista del inspector
  tab: MixTab;
  compare: string | null; // otra pista encima del espectro (EQ visual: choques)
  setOpen: (on: boolean) => void;
  toggle: () => void;
  select: (id: string | null, tab?: MixTab) => void;
  setTab: (t: MixTab) => void;
  setCompare: (id: string | null) => void;
}
export const useMixerStore = create<MixerState>((set, get) => ({
  open: false,
  sel: null,
  tab: read().tab ?? 'eq',
  compare: null,
  setOpen: (open) => { if (open) useDetailStore.getState().close(); set({ open }); },
  toggle: () => get().setOpen(!get().open),
  select: (sel, tab) => { set({ sel, ...(tab ? { tab } : {}) }); if (tab) try { localStorage.setItem(KEY, JSON.stringify({ tab })); } catch { /* */ } },
  setTab: (tab) => { set({ tab }); try { localStorage.setItem(KEY, JSON.stringify({ tab })); } catch { /* */ } },
  setCompare: (compare) => set({ compare }),
}));
// abrir el editor en grande cierra el mezclador (comparten el sitio)
useDetailStore.subscribe((s, p) => { if (s.nodeId && s.nodeId !== p.nodeId && useMixerStore.getState().open) useMixerStore.setState({ open: false }); });
