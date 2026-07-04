import { create } from 'zustand';

// Línea de tiempo / SONG MODE: arregla una canción como una secuencia de SECCIONES,
// cada una = una escena (1–9, del banco de escenas) que dura N compases. Al reproducir
// la canción, avanza por las secciones disparando su escena en cada frontera de compás
// (el reloj del scheduler manda). Convierte el jam de bucles en una estructura
// (intro→drop→break→…). steps+loop persisten; playing/index son de ejecución.
export interface SongStep {
  id: string;
  scene: number; // 1..9
  bars: number; // compases (ciclos) que dura la sección
}

const KEY = 'telar.song.v1';
interface Persisted { steps: SongStep[]; loop: boolean }
function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Persisted;
  } catch {
    /* ignore */
  }
  return { steps: [], loop: true };
}
function persist(steps: SongStep[], loop: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ steps, loop }));
  } catch {
    /* ignore */
  }
}

const seed = load();
let n = 0;
const newId = () => `st_${Date.now().toString(36)}_${n++}`;

interface SongState {
  steps: SongStep[];
  loop: boolean;
  playing: boolean;
  index: number; // sección activa (runtime)
  addStep: () => void;
  updateStep: (id: string, patch: Partial<SongStep>) => void;
  removeStep: (id: string) => void;
  setLoop: (b: boolean) => void;
  setPlaying: (b: boolean) => void;
  setIndex: (i: number) => void;
}

export const useSongStore = create<SongState>((set, get) => ({
  steps: seed.steps,
  loop: seed.loop,
  playing: false,
  index: 0,
  addStep: () => {
    const last = get().steps[get().steps.length - 1];
    const steps = [...get().steps, { id: newId(), scene: last ? last.scene : 1, bars: 8 }];
    persist(steps, get().loop);
    set({ steps });
  },
  updateStep: (id, patch) => {
    const steps = get().steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    persist(steps, get().loop);
    set({ steps });
  },
  removeStep: (id) => {
    const steps = get().steps.filter((s) => s.id !== id);
    persist(steps, get().loop);
    set({ steps });
  },
  setLoop: (loop) => { persist(get().steps, loop); set({ loop }); },
  setPlaying: (playing) => set({ playing }),
  setIndex: (index) => set({ index }),
}));
