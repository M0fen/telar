import { create } from 'zustand';
import { savedProject, startupSong, readLegacy, LEGACY_SONG_KEY, type ProjectSong } from '../lib/projectStore';

// Línea de tiempo / SONG MODE: arregla una canción como una secuencia de SECCIONES,
// cada una = una escena (1–9, del banco de escenas) que dura N compases. Al reproducir
// la canción, avanza por las secciones disparando su escena en cada frontera de compás
// (el reloj del scheduler manda). Convierte el jam de bucles en una estructura
// (intro→drop→break→…). steps+loop son PARTE DEL PROYECTO (los guarda el autoguardado
// y viajan al exportar/compartir: ver projectStore); playing/index son de ejecución.
export interface SongStep {
  id: string;
  scene: number; // 1..9
  bars: number; // compases (ciclos) que dura la sección
}

const seed = startupSong(savedProject(), readLegacy(LEGACY_SONG_KEY));
let n = 0;
const newId = () => `st_${Date.now().toString(36)}_${n++}`;

interface SongState {
  steps: SongStep[];
  loop: boolean;
  playing: boolean;
  index: number; // sección activa (runtime)
  // compás de arranque (desde 0) tras «tocar desde aquí» en la vista DAW (Fase 1.4). Es de
  // EJECUCIÓN (no se guarda): el compilador adelanta todo `from` compases y la canción y la
  // línea de reproducción cuentan desde ahí. ■ lo devuelve a 0.
  from: number;
  setFrom: (bar: number) => void;
  addStep: () => void;
  updateStep: (id: string, patch: Partial<SongStep>) => void;
  removeStep: (id: string) => void;
  setLoop: (b: boolean) => void;
  setPlaying: (b: boolean) => void;
  setIndex: (i: number) => void;
  // Reemplaza la canción entera (cargar proyecto / deshacer una carga). Detiene el modo
  // canción: sus secciones ya no son las que sonaban.
  replace: (song: ProjectSong) => void;
}

export const useSongStore = create<SongState>((set, get) => ({
  steps: seed.steps,
  loop: seed.loop,
  playing: false,
  index: 0,
  from: 0,
  setFrom: (bar) => set({ from: Number.isFinite(bar) && bar > 0 ? Math.floor(bar) : 0 }),
  addStep: () => {
    const last = get().steps[get().steps.length - 1];
    set({ steps: [...get().steps, { id: newId(), scene: last ? last.scene : 1, bars: 8 }] });
  },
  updateStep: (id, patch) => set({ steps: get().steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
  removeStep: (id) => set({ steps: get().steps.filter((s) => s.id !== id) }),
  setLoop: (loop) => set({ loop }),
  setPlaying: (playing) => set({ playing }),
  setIndex: (index) => set({ index }),
  replace: (song) => set({ steps: song.steps, loop: song.loop, playing: false, index: 0, from: 0 }),
}));
