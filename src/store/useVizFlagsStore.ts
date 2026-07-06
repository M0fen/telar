import { create } from 'zustand';

// Feature-flags de los VISUALES nuevos (herramienta de dev). Un booleano por feature,
// extensible. Sirve para PRENDER/APAGAR cada uno por separado y medir su costo en FPS de
// forma aislada (con el HUD del DevPanel). Cuando una feature está en off, su código hace
// un no-op REAL (rAF/escrituras/analysers se saltan) — no basta ocultarla. Persistido.
export type VizFlagKey = 'nodePulse' | 'edgeFlow' | 'energyMap' | 'spatialMix' | 'branchMetering';
export type VizFlags = Record<VizFlagKey, boolean>;

export const VIZ_FLAG_LABELS: Record<VizFlagKey, string> = {
  nodePulse: 'pulso de nodo',
  edgeFlow: 'flujo por cable',
  energyMap: 'mapa de energía',
  spatialMix: 'mezcla espacial',
  branchMetering: 'medición por rama',
};

const KEY = 'telar.vizflags.v1';
// por defecto TODO encendido → comportamiento idéntico al de producción (donde no hay
// panel para cambiarlos).
const DEFAULTS: VizFlags = { nodePulse: true, edgeFlow: true, energyMap: true, spatialMix: true, branchMetering: true };

function load(): VizFlags {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<VizFlags>) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}
function persist(flags: VizFlags) {
  try { localStorage.setItem(KEY, JSON.stringify(flags)); } catch { /* ignore */ }
}

interface VizFlagsState {
  flags: VizFlags;
  setFlag: (k: VizFlagKey, v: boolean) => void;
  toggle: (k: VizFlagKey) => void;
}

export const useVizFlagsStore = create<VizFlagsState>((set, get) => ({
  flags: load(),
  setFlag: (k, v) => { const flags = { ...get().flags, [k]: v }; persist(flags); set({ flags }); },
  toggle: (k) => { const flags = { ...get().flags, [k]: !get().flags[k] }; persist(flags); set({ flags }); },
}));
