// Medidores de nivel (VU) compartidos por un único rAF (Fase A). Cada medidor se
// registra con un id y un elemento "relleno"; el motor lee el AnalyserNode que
// corresponda (master o el de un Source), calcula el RMS de la onda y escala el
// relleno. Reutiliza los analysers que ya existen: getMasterAnalyser (tap del
// destinationGain) y getSourceAnalyser (tap .analyze por instrumento).
import { getMasterAnalyser, getSourceAnalyser } from '../audio/engine';
import { isBranchMeteringOn, isCentroidWanted, getBranchMetric, setBranchMetric, spectralCentroid } from '../audio/branchMeter';

const MASTER = 'master';

const fills = new Map<string, HTMLElement>();
// "hilo activo": punto que se enciende con el nivel real del source (concepto telar).
// Comparte el mismo cálculo de nivel que el VU (un rAF, sin coste extra por analyser).
const dots = new Map<string, HTMLElement>();
const buffers = new Map<string, Uint8Array<ArrayBuffer>>();
const freqBuffers = new Map<string, Uint8Array<ArrayBuffer>>(); // V-infra: datos de frecuencia (centroide)
const levels = new Map<string, number>(); // nivel suavizado por id
let running = false;
let raf = 0;

function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
function stopIfIdle() { if (fills.size === 0 && dots.size === 0) { running = false; cancelAnimationFrame(raf); } }

export function registerMeter(id: string, fill: HTMLElement): void { fills.set(id, fill); start(); }
export function unregisterMeter(id: string): void {
  fills.delete(id);
  if (!dots.has(id)) { buffers.delete(id); freqBuffers.delete(id); levels.delete(id); }
  stopIfIdle();
}
export function registerActivity(id: string, dot: HTMLElement): void { dots.set(id, dot); start(); }
export function unregisterActivity(id: string): void {
  dots.delete(id);
  if (!fills.has(id)) { buffers.delete(id); freqBuffers.delete(id); levels.delete(id); }
  stopIfIdle();
}

function tick() {
  raf = requestAnimationFrame(tick);
  const ids = new Set<string>([...fills.keys(), ...dots.keys()]);
  for (const id of ids) {
    const an = id === MASTER ? getMasterAnalyser() : getSourceAnalyser(id);
    let level = 0;
    if (an) {
      let buf = buffers.get(id);
      if (!buf || buf.length !== an.fftSize) {
        buf = new Uint8Array(an.fftSize);
        buffers.set(id, buf);
      }
      an.getByteTimeDomainData(buf);
      let sum = 0, cnt = 0;
      // submuestreo (stride 4): el RMS es prácticamente idéntico con 1/4 de las
      // muestras y cuesta 4× menos por frame (perf con muchos canales).
      for (let i = 0; i < buf.length; i += 4) {
        const v = (buf[i] - 128) / 128; // -1..1
        sum += v * v;
        cnt++;
      }
      const rms = Math.sqrt(sum / cnt);
      level = Math.min(1, rms * 2.4); // escala perceptual aproximada
    }
    // ataque rápido, caída lenta (como un VU real): sube al instante, baja suave.
    const prev = levels.get(id) ?? 0;
    const next = level > prev ? level : prev * 0.84 + level * 0.16;
    levels.set(id, next);
    // escribimos una variable CSS; el CSS decide qué hacer (VU: escala; hilo: brillo).
    const v = next.toFixed(3);
    fills.get(id)?.style.setProperty('--lvl', v);
    dots.get(id)?.style.setProperty('--lvl', v);

    // V-infra — medición por rama. El NIVEL (next) ya está calculado (gratis). El
    // CENTROIDE (FFT + barrido de bins) es el costo real y SOLO se calcula cuando alguien
    // lo pide (V3 abierto, isCentroidWanted); si no, se conserva el último conocido. Así,
    // con branchMetering on pero V3 cerrado (el default en prod), no hay costo de frecuencia.
    // MASTER no es rama. Reusa el mismo analyser (0 analysers extra).
    if (an && id !== MASTER && isBranchMeteringOn()) {
      const prev = getBranchMetric(id);
      let c01 = prev?.centroid01 ?? 0.5;
      let hz = prev?.centroidHz ?? 0;
      if (isCentroidWanted()) {
        const bins = an.frequencyBinCount;
        let fbuf = freqBuffers.get(id);
        if (!fbuf || fbuf.length !== bins) { fbuf = new Uint8Array(bins); freqBuffers.set(id, fbuf); }
        an.getByteFrequencyData(fbuf);
        const sc = spectralCentroid(fbuf, an.context.sampleRate);
        c01 = sc.norm; hz = sc.hz;
      }
      setBranchMetric(id, { level: next, centroid01: c01, centroidHz: hz });
    }
  }
}
