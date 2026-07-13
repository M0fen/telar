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

// La web publicada (build estático en Vercel) NO tiene los endpoints /api/yt/* (son un
// plugin del server de Vite, solo en `npm run dev`). Vercel responde a esas rutas con un
// 404 de TEXTO PLANO ("The page could not be found"), que NO es JSON → `r.json()` lanzaba
// «Unexpected token 'T', "The page c"… is not valid JSON». Leemos el JSON de forma segura
// (solo si el content-type lo es) para dar un mensaje claro en vez del error críptico.
const DEV_ONLY = 'El descargador de YouTube solo funciona en la app local (npm run dev); no está disponible en la web publicada.';
async function readJson(r: Response): Promise<{ ok?: boolean; [k: string]: unknown } | null> {
  if (!(r.headers.get('content-type') || '').includes('application/json')) return null;
  return r.json().catch(() => null);
}

export const useDownloadsStore = create<DownloadsState>((set) => ({
  tracks: [],
  busy: false,
  error: null,
  status: null,

  refresh: async () => {
    try {
      const r = await fetch('/api/yt/list');
      const j = await readJson(r);
      if (j?.ok) set({ tracks: j.tracks as Track[] });
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
      const j = await readJson(r);
      if (!j) {
        // respuesta no-JSON: el endpoint no existe (web publicada) o el server está caído.
        set({ busy: false, error: DEV_ONLY, status: null });
        return null;
      }
      if (!j.ok) {
        set({ busy: false, error: (j.error as string) ?? 'falló la descarga', status: null });
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
