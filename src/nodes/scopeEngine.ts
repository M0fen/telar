// Osciloscopio inline (algorave): una línea de onda fina y monocroma dibujada
// ENTRE las líneas del código, donde el usuario escribe `._scope()`. Lee el
// AnalyserNode propio del Source (tap `.analyze("telar-src-<id>")` que inyecta el
// compilador al ver el marcador). rAF compartido por todos los canvases activos.
import { getSourceAnalyser } from '../audio/engine';
import { drawWave, drawFlat } from './drawWave';

const canvases = new Map<string, HTMLCanvasElement>();
// Uint8Array respaldado por ArrayBuffer (lo exige getByteTimeDomainData en TS 5.7+).
const buffers = new Map<string, Uint8Array<ArrayBuffer>>();
let running = false;
let raf = 0;

export function registerScope(nodeId: string, canvas: HTMLCanvasElement): void {
  canvases.set(nodeId, canvas);
  if (!running) {
    running = true;
    raf = requestAnimationFrame(tick);
  }
}
export function unregisterScope(nodeId: string): void {
  canvases.delete(nodeId);
  buffers.delete(nodeId);
  if (canvases.size === 0) {
    running = false;
    cancelAnimationFrame(raf);
  }
}

// Ajusta el buffer del canvas a su tamaño en pantalla (DPR). false si aún 0px.
function fit(canvas: HTMLCanvasElement): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor((canvas.clientWidth || 0) * dpr);
  const h = Math.floor((canvas.clientHeight || 0) * dpr);
  if (w === 0 || h === 0) return false;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return true;
}

function tick() {
  raf = requestAnimationFrame(tick);
  for (const [nodeId, canvas] of canvases) {
    if (!fit(canvas)) continue;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const an = getSourceAnalyser(nodeId);
    if (!an) { drawFlat(ctx, W, H); continue; } // sin señal: línea base tenue
    let data = buffers.get(nodeId);
    if (!data || data.length !== an.fftSize) {
      data = new Uint8Array(an.fftSize);
      buffers.set(nodeId, data);
    }
    an.getByteTimeDomainData(data);
    drawWave(ctx, data, data.length, W, H);
  }
}
