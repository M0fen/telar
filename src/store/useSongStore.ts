import { create } from 'zustand';
import { savedProject, startupSong, readLegacy, LEGACY_SONG_KEY, type ProjectSong } from '../lib/projectStore';

// Línea de tiempo / SONG MODE: arregla una canción como una secuencia de SECCIONES,
// cada una = una escena (1–9, del banco de escenas) que dura N compases. Al reproducir
// la canción, avanza por las secciones disparando su escena en cada frontera de compás
// (el reloj del scheduler manda). Convierte el jam de bucles en una estructura
// (intro→drop→break→…). steps+loop son PARTE DEL PROYECTO (los guarda el autoguardado
// y viajan al exportar/compartir: ver projectStore); playing/index son de ejecución.
export interface SongRegion {
  start: number; // compás de inicio (desde 0)
  bars: number; // compases (≥ 1)
}

export interface SongStep {
  id: string;
  scene: number; // 1..9
  bars: number; // compases (ciclos) que dura la sección
  name?: string; // nombre propio de la sección (marcador del DAW); sin él se usa el de la escena
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
  // LOOP DE REGIÓN (Fase 2.4, de ejecución): compases marcados en la regla del DAW y si el
  // bucle está activo. Con el bucle activo el compilador repite esa región (.ribbon).
  region: SongRegion | null;
  regionOn: boolean;
  setRegion: (r: SongRegion | null) => void;
  setRegionOn: (on: boolean) => void;
  addStep: () => void;
  updateStep: (id: string, patch: Partial<SongStep>) => void;
  removeStep: (id: string) => void;
  setLoop: (b: boolean) => void;
  setPlaying: (b: boolean) => void;
  setIndex: (i: number) => void;
  // Cambia las secciones SIN detener la canción (edición desde el DAW y su deshacer).
  setSteps: (steps: SongStep[]) => void;
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
  region: null,
  regionOn: false,
  setRegion: (r) => set(r && r.bars >= 1 ? { region: { start: Math.max(0, Math.floor(r.start)), bars: Math.max(1, Math.floor(r.bars)) } } : { region: null, regionOn: false }),
  setRegionOn: (on) => set({ regionOn: on && !!get().region }),
  addStep: () => {
    const last = get().steps[get().steps.length - 1];
    set({ steps: [...get().steps, { id: newId(), scene: last ? last.scene : 1, bars: 8 }] });
  },
  updateStep: (id, patch) => set({ steps: get().steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
  removeStep: (id) => set({ steps: get().steps.filter((s) => s.id !== id) }),
  setLoop: (loop) => set({ loop }),
  setPlaying: (playing) => set({ playing }),
  setIndex: (index) => set({ index }),
  setSteps: (steps) => set({ steps, index: Math.min(get().index, Math.max(0, steps.length - 1)) }),
  replace: (song) => set({ steps: song.steps, loop: song.loop, playing: false, index: 0, from: 0, region: null, regionOn: false }),
}));
