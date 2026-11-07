import { isOfflineRendering } from './engine';
import { getAudioContext } from '@strudel/web';
import { ensureAudioReady } from './engine';
import { resolveSampleUrl } from '../lib/sampleResolve';

// PREVIEW INSTANTÁNEO de un sample. En vez de agendar por superdough (que tiene la
// latencia del scheduler + carga perezosa del buffer), decodificamos el AudioBuffer
// UNA vez, lo cacheamos y lo disparamos con un AudioBufferSourceNode directo. Con
// precarga en hover, el clic suena en el acto. Corta el preview anterior → respuesta
// viva y fluida, sin solapes. Es solo para AUDICIONAR (crudo, sin la cadena de FX).

// Todo va por la URL del sample, no por su nombre: un loop al tempo (wl_…) cambia de audio con el
// BPM sin cambiar de nombre, y un nombre que AÚN no está registrado (el banco cargando, el loop
// estirándose) no es un fallo: se vuelve a pedir cuando aparezca.
// La caché de audio decodificado tiene TOPE (antes guardaba cada sonido escuchado para
// siempre: ~3,5 MB por cada 10 s de audio estéreo; en sesiones largas tumbaba la pestaña).
// Se suelta lo menos usado últimamente (el orden del Map es el de uso).
const bufCache = new Map<string, AudioBuffer>();
const MAX_BYTES = 96 * 1024 * 1024; // ~4,5 min de audio estéreo a 44,1 kHz
let cachedBytes = 0;
const sizeOf = (b: AudioBuffer): number => b.length * b.numberOfChannels * 4;
function cacheGet(url: string): AudioBuffer | undefined {
  const b = bufCache.get(url);
  if (b) { bufCache.delete(url); bufCache.set(url, b); } // pasa a ser el más reciente
  return b;
}
function cachePut(url: string, b: AudioBuffer): void {
  const old = bufCache.get(url);
  if (old) { cachedBytes -= sizeOf(old); bufCache.delete(url); }
  bufCache.set(url, b);
  cachedBytes += sizeOf(b);
  while (cachedBytes > MAX_BYTES && bufCache.size > 1) {
    const [k, v] = bufCache.entries().next().value as [string, AudioBuffer];
    bufCache.delete(k);
    cachedBytes -= sizeOf(v);
  }
}
export const previewCacheBytes = (): number => cachedBytes; // (pruebas y medidor)
const loading = new Map<string, Promise<AudioBuffer | null>>();
const failed = new Set<string>();
let previewGain: GainNode | null = null;
let currentSrc: AudioBufferSourceNode | null = null;

// Decodifica (y cachea) el AudioBuffer de un sample por su nombre. Lo comparten el preview,
// los editores y la miniatura de forma de onda. `keep: false` (miniaturas): usa la caché si ya
// está, pero no la llena — de una miniatura solo se guardan los picos.
export async function loadSampleBuffer(name: string, opts: { keep?: boolean } = {}): Promise<AudioBuffer | null> {
  const url = resolveSampleUrl(name);
  if (!url) return null;
  const hit = cacheGet(url);
  if (hit) return hit;
  const inFlightKeep = loading.get(url);
  if (opts.keep === false && !inFlightKeep) {
    if (failed.has(url)) return null;
    try {
      const ab = await (await fetch(url)).arrayBuffer();
      return await getAudioContext().decodeAudioData(ab);
    } catch {
      failed.add(url);
      return null;
    }
  }
  if (failed.has(url)) return null;
  const inFlight = loading.get(url);
  if (inFlight) return inFlight;
  const p = (async () => {
    try {
      const ab = await (await fetch(url)).arrayBuffer();
      const buf = await getAudioContext().decodeAudioData(ab);
      cachePut(url, buf);
      return buf;
    } catch {
      failed.add(url);
      return null;
    } finally {
      loading.delete(url);
    }
  })();
  loading.set(url, p);
  return p;
}
const loadBuf = loadSampleBuffer;

// Precarga SILENCIOSA (llamar en hover / al renderizar los visibles) → clic instantáneo.
// decodeAudioData no necesita gesto ni contexto reanudado, así que es seguro en hover.
export function preloadPreview(name: string): void {
  const url = resolveSampleUrl(name);
  if (url && !bufCache.has(url) && !loading.has(url) && !failed.has(url)) void loadBuf(name);
}

// Reproduce YA. Si está en caché suena en el acto; si no, carga y suena. Corta el
// preview previo. maxSec acota loops largos (para que el ▸ no quede sonando eterno).
export async function playPreview(name: string, gain = 0.9, maxSec = 4): Promise<void> {
  if (isOfflineRendering()) return; // exportando: el audio en vivo espera
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
