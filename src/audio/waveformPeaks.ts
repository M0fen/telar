import { loadSampleBuffer } from './previewSample';
import { resolveSampleUrl } from '../lib/sampleResolve';

// Miniaturas de forma de onda para las tarjetas de la biblioteca. Decodifica el sample
// UNA vez (compartido con el preview), calcula picos reducidos y los cachea. Para no
// bloquear el navegador con cientos de tarjetas, las peticiones pasan por una COLA con
// concurrencia limitada; y el componente solo pide la onda cuando la tarjeta entra en
// pantalla (IntersectionObserver). Falla en silencio (sin onda) si no se puede decodificar.

export interface WaveInfo { peaks: Float32Array; duration: number }

const cache = new Map<string, WaveInfo>();
const MAX_WAVES = 3000; // picos ya calculados (unos pocos cientos de bytes cada uno)
const failed = new Set<string>();
const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (job) job();
  }
}

function computePeaks(buf: AudioBuffer, buckets: number): Float32Array {
  const data = buf.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / buckets));
  const peaks = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(start + block, data.length);
    for (let j = start; j < end; j++) {
      const v = data[j] < 0 ? -data[j] : data[j];
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  // normaliza al pico global para que las ondas suaves también se vean
  let gmax = 1e-4;
  for (let i = 0; i < buckets; i++) if (peaks[i] > gmax) gmax = peaks[i];
  const g = 1 / gmax;
  for (let i = 0; i < buckets; i++) peaks[i] = Math.min(1, peaks[i] * g);
  return peaks;
}

// Por la URL del sample (como el preview): el mismo nombre puede cambiar de audio (un loop al tempo
// con otro BPM) y uno que aún no está registrado no queda marcado como fallido.
export function getWaveInfo(name: string, buckets = 56): Promise<WaveInfo | null> {
  const url = resolveSampleUrl(name);
  if (!url) return Promise.resolve(null);
  const key = `${url}@${buckets}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (failed.has(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const run = () => {
      active++;
      loadSampleBuffer(name, { keep: false }) // de la miniatura solo se guardan los picos
        .then((buf) => {
          if (!buf) { if (resolveSampleUrl(name) === url) failed.add(url); resolve(null); return; }
          const info: WaveInfo = { peaks: computePeaks(buf, buckets), duration: buf.duration };
          cache.set(key, info);
          if (cache.size > MAX_WAVES) cache.delete(cache.keys().next().value as string);
          resolve(info);
        })
        .catch(() => { failed.add(url); resolve(null); })
        .finally(() => { active--; pump(); });
    };
    queue.push(run);
    pump();
  });
}

// Dibuja los picos en un canvas (barras espejadas alrededor del centro). color = acento.
export function drawWave(canvas: HTMLCanvasElement, peaks: Float32Array, color: string): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 120;
  const h = canvas.clientHeight || 26;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const n = peaks.length;
  const bw = w / n;
  const mid = h / 2;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const ph = Math.max(1, peaks[i] * (h - 2));
    ctx.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.6), ph);
  }
}
