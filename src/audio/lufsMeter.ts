// Medidor de LUFS (loudness) integrado — M2. Mide la sonoridad percibida del
// máster según ITU-R BS.1770 (aproximado): pre-filtro K-weighting (realce de
// agudos por el modelo de cabeza + paso-alto RLB), luego energía media (mean
// square) → loudness = −0.691 + 10·log10(ms). Devuelve:
//   • momentary (M): ventana de 400 ms
//   • short (S): ventana de 3 s
//   • integrated (I): media con gating (absoluto −70 LUFS + relativo −10 LU)
//   • truePeakDb: pico de muestra en dBFS (aprox, sin sobremuestreo)
// El tap es PASIVO (filtros → analyser, que es un sink): no altera el audio que
// va a los altavoces. Objetivos típicos: −14 LUFS (streaming) · −8/−9 (club/EDM).
import { getAudioContext } from '@strudel/web';
import { getMasterOutputNode } from './engine';

export interface LufsReading {
  momentary: number; // LUFS (−Infinity si silencio)
  short: number;
  integrated: number;
  truePeakDb: number; // dBFS
}

let ctxRef: BaseAudioContext | null = null;
let tapped: AudioNode | null = null;
let analyser: AnalyserNode | null = null;
let buf: Float32Array<ArrayBuffer> = new Float32Array(2048);

// ventanas de bloques {t (s), ms (mean square), peak}
interface Blk { t: number; ms: number; peak: number }
let blocks: Blk[] = [];
// bloques de 400 ms para la medida integrada con gating (se acumulan sin límite,
// pero recortamos a un máximo razonable para no crecer indefinido en sesiones largas).
let intBlocks: number[] = []; // mean square de cada bloque de ~400 ms
let intAccum = 0; // suma de ms del bloque en curso
let intCount = 0; // muestras acumuladas en el bloque en curso
let intBlockStart = 0;

let timer: number | null = null;

const MS_TO_LUFS = (ms: number): number => (ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

function ensureTap(): boolean {
  try {
    const ctx = getAudioContext();
    const out = getMasterOutputNode();
    if (!out) return false;
    if (analyser && ctxRef === ctx && tapped === out) return true;
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    a.smoothingTimeConstant = 0;
    // K-weighting en 2 etapas (BiquadFilter): realce high-shelf + paso-alto.
    const shelf = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 1500, gain: 4 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 38, Q: 0.5 });
    out.connect(shelf);
    shelf.connect(hp);
    hp.connect(a);
    analyser = a;
    ctxRef = ctx;
    tapped = out;
    buf = new Float32Array(a.fftSize);
    return true;
  } catch {
    return false;
  }
}

function tick(): void {
  if (!ensureTap() || !analyser) return;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i];
    sum += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  const ms = sum / buf.length;
  const now = performance.now() / 1000;
  blocks.push({ t: now, ms, peak });
  // conserva solo los últimos 3 s (para S; M usa el último 0.4 s de estos).
  const cut = now - 3.1;
  if (blocks.length > 400) blocks = blocks.filter((b) => b.t >= cut);
  // acumulación de bloques de 400 ms para la integrada (gating).
  if (intBlockStart === 0) intBlockStart = now;
  intAccum += sum;
  intCount += buf.length;
  if (now - intBlockStart >= 0.4) {
    if (intCount > 0) intBlocks.push(intAccum / intCount);
    if (intBlocks.length > 5400) intBlocks = intBlocks.slice(-5400); // ~36 min cap
    intAccum = 0;
    intCount = 0;
    intBlockStart = now;
  }
}

function windowLufs(seconds: number): number {
  if (!blocks.length) return -Infinity;
  const now = blocks[blocks.length - 1].t;
  const from = now - seconds;
  let sum = 0;
  let n = 0;
  for (const b of blocks) if (b.t >= from) { sum += b.ms; n++; }
  return n ? MS_TO_LUFS(sum / n) : -Infinity;
}

// Integrada con gating de dos etapas (absoluto −70 LUFS y relativo −10 LU).
function integratedLufs(): number {
  if (intBlocks.length < 2) return -Infinity;
  const absKept = intBlocks.filter((ms) => MS_TO_LUFS(ms) > -70);
  if (!absKept.length) return -Infinity;
  const meanAbs = absKept.reduce((a, b) => a + b, 0) / absKept.length;
  const relGate = MS_TO_LUFS(meanAbs) - 10;
  const relKept = absKept.filter((ms) => MS_TO_LUFS(ms) > relGate);
  if (!relKept.length) return MS_TO_LUFS(meanAbs);
  return MS_TO_LUFS(relKept.reduce((a, b) => a + b, 0) / relKept.length);
}

export function getLufs(): LufsReading {
  let peak = 0;
  const from = blocks.length ? blocks[blocks.length - 1].t - 3 : 0;
  for (const b of blocks) if (b.t >= from && b.peak > peak) peak = b.peak;
  return {
    momentary: windowLufs(0.4),
    short: windowLufs(3),
    integrated: integratedLufs(),
    truePeakDb: peak > 1e-6 ? 20 * Math.log10(peak) : -Infinity,
  };
}

export function startLufs(): void {
  if (timer != null) return;
  timer = window.setInterval(tick, 100); // ~10 Hz (suficiente y barato)
}

export function stopLufs(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

// Reinicia SOLO la medida integrada (para medir un tramo desde cero).
export function resetLufsIntegrated(): void {
  intBlocks = [];
  intAccum = 0;
  intCount = 0;
  intBlockStart = 0;
}
