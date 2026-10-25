import { create } from 'zustand';

// PEDIDO DE FOCO entre vistas (Modo DAW, Fase 2.3): «editar en la vista estándar» desde un
// bloque del DAW pide abrir ESE nodo en ESA sección. La vista estándar centra el nodo y su
// secuenciador (StepSeq) salta a la sección `arm`. `nonce` distingue pedidos repetidos.
export interface FocusRequest {
  nodeId: string;
  arm: number; // índice del brazo del arrange (-1 = sin sección)
  nonce: number;
}

interface UiFocusState {
  req: FocusRequest | null;
  request: (nodeId: string, arm: number) => void;
  clear: () => void;
}

let n = 0;
export const useUiFocusStore = create<UiFocusState>((set) => ({
  req: null,
  request: (nodeId, arm) => set({ req: { nodeId, arm, nonce: ++n } }),
  clear: () => set({ req: null }),
}));
