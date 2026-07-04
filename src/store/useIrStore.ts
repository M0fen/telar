import { create } from 'zustand';
import type { IrDef } from '../audio/irRegistry';

// Lista REACTIVA de IRs reales cargados por el usuario (para refrescar los
// selectores de espacio en la UI). El registro "de verdad" para el compilador vive
// en irRegistry.ts (Map puro); esto es solo el espejo reactivo para React.
// REGLA zustand v5: los selectores devuelven el CAMPO `userIrs` (ref estable), nunca
// un array nuevo derivado — eso colgaría la app (ver [[zustand-v5-selector-crash]]).
interface IrStoreState {
  userIrs: IrDef[];
  add: (...irs: IrDef[]) => void;
}

export const useIrStore = create<IrStoreState>((set) => ({
  userIrs: [],
  add: (...irs) =>
    set((s) => {
      const have = new Set(s.userIrs.map((i) => i.name));
      const fresh = irs.filter((i) => !have.has(i.name));
      return fresh.length ? { userIrs: [...s.userIrs, ...fresh] } : s;
    }),
}));
