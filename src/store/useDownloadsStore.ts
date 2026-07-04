import { create } from 'zustand';
import { registerSample } from '../audio/engine';

// Pista descargada (espejo del manifiesto del servidor, vite-plugin-downloader).
export interface Track {
  id: string;
  name: string; // sample id válido, ej. yt_abc123
  title: string;
  file: string; // /samples/yt/<id>.wav
  createdAt: number;
}

interface DownloadsState {
  tracks: Track[];
  busy: boolean;
  error: string | null;
  status: string | null;
  refresh: () => Promise<void>;
  download: (url: string) => Promise<Track | null>;
  remove: (id: string) => Promise<void>;
}

export const useDownloadsStore = create<DownloadsState>((set) => ({
  tracks: [],
  busy: false,
  error: null,
  status: null,

  refresh: async () => {
    try {
      const r = await fetch('/api/yt/list');
      const j = await r.json();
      if (j.ok) set({ tracks: j.tracks as Track[] });
    } catch {
      /* servidor sin el plugin (build estático): silencioso */
    }
  },

  download: async (url) => {
    set({ busy: true, error: null, status: 'descargando audio…' });
    try {
      const r = await fetch('/api/yt/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const j = await r.json();
      if (!j.ok) {
        set({ busy: false, error: j.error ?? 'falló la descarga', status: null });
        return null;
      }
      const track = j.track as Track;
      set((s) => ({
        busy: false,
        status: `listo: ${track.title}`,
        tracks: [track, ...s.tracks.filter((t) => t.id !== track.id)],
      }));
      return track;
    } catch (e) {
      set({ busy: false, error: (e as Error).message, status: null });
      return null;
    }
  },

  remove: async (id) => {
    // Optimista: quita de la lista de inmediato y pide al servidor borrar el archivo.
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
    try {
      await fetch('/api/yt/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* si falla la red, el refresh siguiente reconcilia */
    }
  },
}));

// Registra TODAS las pistas descargadas como samples de Strudel. Se llama al dar
// Play para que los nodos `s("yt_…")` guardados sigan sonando tras recargar.
export async function registerDownloadedSamples(): Promise<void> {
  const { tracks } = useDownloadsStore.getState();
  await Promise.all(tracks.map((t) => registerSample(t.name, t.file).catch(() => {})));
}

// Carga la lista al iniciar la app.
useDownloadsStore.getState().refresh();
