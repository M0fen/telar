import { create } from 'zustand';
import { setClickLevel } from '../audio/metronomeSound';

// METRÓNOMO (Fase 8.3): preferencias del usuario en este navegador (no viajan con el proyecto).
//   on      clic en cada pulso mientras suena
//   countIn compases de cuenta antes de grabar el jam o los pads con el transporte parado (0, 1, 2)
//   level   volumen del clic (0..1)
const KEY = 'telar.metro';

interface Saved { on?: boolean; countIn?: number; level?: number }
function read(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function write(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* solo esta sesión */ }
}

const saved = read();

interface MetroState {
  on: boolean;
  countIn: number;
  level: number;
  setOn: (on: boolean) => void;
  setCountIn: (n: number) => void;
  setLevel: (v: number) => void;
}

// el motor recompila al cambiar el clic (lo registra quien tenga el grafo: useGraphStore)
let onChange: () => void = () => {};
export function onMetroChange(fn: () => void): void {
  onChange = fn;
}

export const useMetroStore = create<MetroState>((set, get) => ({
  on: !!saved.on,
  countIn: saved.countIn === 0 || saved.countIn === 2 ? saved.countIn : 1,
  level: typeof saved.level === 'number' ? Math.max(0, Math.min(1, saved.level)) : 0.5,
  setOn: (on) => {
    set({ on });
    write({ on, countIn: get().countIn, level: get().level });
    onChange();
  },
  setCountIn: (n) => {
    const countIn = n === 0 || n === 2 ? n : 1;
    set({ countIn });
    write({ on: get().on, countIn, level: get().level });
  },
  setLevel: (v) => {
    const level = Math.max(0, Math.min(1, Number(v) || 0));
    set({ level });
    setClickLevel(level);
    write({ on: get().on, countIn: get().countIn, level });
  },
}));

setClickLevel(useMetroStore.getState().level);
