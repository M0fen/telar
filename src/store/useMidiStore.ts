import { create } from 'zustand';

// Mapa de control MIDI para el modo EN VIVO. Guarda qué pad/perilla física está
// asignado a cada "slot" de la UI (un efecto, su cantidad, o una escena), más la
// detección de perillas RELATIVAS (endless encoders que mandan 1/127/63/65…). Se
// persiste en localStorage, igual que el MIDI del En vivo de la Sala de Dirección
// (de donde se portó este patrón). No toca audio: solo el ruteo de control.

const KEY_MAP = 'telar.midimap.v1';
const KEY_REL = 'telar.midirel.v1';

function load(k: string): Record<string, string> {
  try {
    return (JSON.parse(localStorage.getItem(k) || '{}') as Record<string, string>) || {};
  } catch {
    return {};
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* almacenamiento lleno / privado: el mapa vive solo en memoria esta sesión */
  }
}

interface MidiStore {
  on: boolean; // MIDI IN activo (permiso dado y escuchando)
  learn: boolean; // modo "aprender": el próximo mensaje físico se asigna al slot elegido
  pick: string | null; // slot que espera asignación
  inputs: string[]; // nombres de los controladores conectados
  err: string;
  last: string; // última señal recibida del controlador (monitor en vivo)
  lastAt: number; // timestamp de la última señal (para el parpadeo)
  map: Record<string, string>; // firma del control físico → id del slot
  rel: Record<string, string>; // firma → tipo de encoder relativo ('2c' | '64')
  setStatus: (p: Partial<Pick<MidiStore, 'on' | 'learn' | 'pick' | 'inputs' | 'err'>>) => void;
  note: (s: string) => void; // registra actividad del controlador (monitor)
  assign: (sig: string, slot: string) => void; // aprende: liga una firma a un slot
  setRel: (sig: string, enc: string) => void;
  clearSlot: (slot: string) => void;
}

export const useMidiStore = create<MidiStore>((set, get) => ({
  on: false,
  learn: false,
  pick: null,
  inputs: [],
  err: '',
  last: '',
  lastAt: 0,
  map: load(KEY_MAP),
  rel: load(KEY_REL),
  setStatus: (p) => set(p),
  note: (s) => set({ last: s, lastAt: Date.now() }),
  assign: (sig, slot) => {
    const map = { ...get().map };
    // un slot = una sola firma: quita cualquier asignación previa a ESE slot
    for (const k of Object.keys(map)) if (map[k] === slot) delete map[k];
    map[sig] = slot;
    save(KEY_MAP, map);
    set({ map, pick: null });
  },
  setRel: (sig, enc) => {
    const rel = { ...get().rel, [sig]: enc };
    save(KEY_REL, rel);
    set({ rel });
  },
  clearSlot: (slot) => {
    const map = { ...get().map };
    for (const k of Object.keys(map)) if (map[k] === slot) delete map[k];
    save(KEY_MAP, map);
    set({ map });
  },
}));

// Firma física (pad/perilla) asignada a un slot, para pintar su etiqueta en la UI.
export function midiKeyFor(slot: string): string {
  const map = useMidiStore.getState().map;
  return Object.keys(map).find((k) => map[k] === slot) || '';
}

// Texto legible de una firma ('n9:36' → 'nota 36', 'c0:21' → 'CC 21').
export function midiKeyLabel(k: string): string {
  if (!k) return '';
  return (k[0] === 'n' ? 'nota ' : 'CC ') + k.split(':')[1];
}
