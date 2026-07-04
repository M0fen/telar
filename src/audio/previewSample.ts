import { getAudioContext } from '@strudel/web';
import { ensureAudioReady } from './engine';
import { resolveSampleUrl } from '../lib/sampleResolve';

// PREVIEW INSTANTÁNEO de un sample. En vez de agendar por superdough (que tiene la
// latencia del scheduler + carga perezosa del buffer), decodificamos el AudioBuffer
// UNA vez, lo cacheamos y lo disparamos con un AudioBufferSourceNode directo. Con
// precarga en hover, el clic suena en el acto. Corta el preview anterior → respuesta
// viva y fluida, sin solapes. Es solo para AUDICIONAR (crudo, sin la cadena de FX).

const bufCache = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
const failed = new Set<string>();
let previewGain: GainNode | null = null;
let currentSrc: AudioBufferSourceNode | null = null;

// Decodifica (y cachea) el AudioBuffer de un sample por su nombre. Lo comparten el
// preview y la miniatura de forma de onda (una sola decodificación por sample).
export async function loadSampleBuffer(name: string): Promise<AudioBuffer | null> {
  const hit = bufCache.get(name);
  if (hit) return hit;
  if (failed.has(name)) return null;
  const inFlight = loading.get(name);
  if (inFlight) return inFlight;
  const url = resolveSampleUrl(name);
  if (!url) { failed.add(name); return null; }
  const p = (async () => {
    try {
      const ab = await (await fetch(url)).arrayBuffer();
      const buf = await getAudioContext().decodeAudioData(ab);
      bufCache.set(name, buf);
      return buf;
    } catch {
      failed.add(name);
      return null;
    } finally {
      loading.delete(name);
    }
  })();
  loading.set(name, p);
  return p;
}
const loadBuf = loadSampleBuffer;

// Precarga SILENCIOSA (llamar en hover / al renderizar los visibles) → clic instantáneo.
// decodeAudioData no necesita gesto ni contexto reanudado, así que es seguro en hover.
export function preloadPreview(name: string): void {
  if (!bufCache.has(name) && !loading.has(name) && !failed.has(name)) void loadBuf(name);
}

// Reproduce YA. Si está en caché suena en el acto; si no, carga y suena. Corta el
// preview previo. maxSec acota loops largos (para que el ▸ no quede sonando eterno).
export async function playPreview(name: string, gain = 0.9, maxSec = 4): Promise<void> {
  await ensureAudioReady(); // reanuda el AudioContext dentro del gesto de clic
  const ctx = getAudioContext();
  const buf = await loadBuf(name);
  if (!buf) return;
  if (!previewGain || previewGain.context !== ctx) {
    const g = ctx.createGain();
    g.connect(ctx.destination);
    previewGain = g;
  }
  const out = previewGain!; // garantizado no-nulo tras el bloque anterior
  out.gain.value = gain;
  if (currentSrc) { try { currentSrc.stop(); } catch { /* ya parado */ } currentSrc = null; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(out);
  const dur = Math.min(buf.duration, maxSec);
  src.start(0, 0, dur);
  currentSrc = src;
  src.onended = () => { if (currentSrc === src) currentSrc = null; };
}

// Corta cualquier preview en curso (al cerrar el panel).
export function stopPreview(): void {
  if (currentSrc) { try { currentSrc.stop(); } catch { /* */ } currentSrc = null; }
}
