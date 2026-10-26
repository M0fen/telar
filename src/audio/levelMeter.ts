// MEDIDORES POR PISTA Y MARGEN (Fase 6.2) — un rAF compartido (~30 por segundo) mide cada pista
// en coma flotante: pico y RMS en dBFS, con retención del pico. Mide lo que la pista APORTA a la
// suma: si tiene tira de canal (EQ/compresor) la salida de la tira (post makeup); si no, su tap
// `.analyze` (que ya lleva cada Source). Aparte, la SUMA antes del máster (la salida de
// superdough, antes del bus): su pico desde que empezó a sonar dice si llega saturada al máster.
// Escribe variables CSS y texto en los elementos registrados: nada de re-renderizar por cuadro.
import { getSourceAnalyser, getSourceStripOut, getMasterOutputNode } from './engine';
import { peakRmsDb, dbToMeter, fallDb, fmtDb, PeakWindow } from '../lib/levels';

interface View { el: HTMLElement; txt: HTMLElement | null }
interface Track {
  views: Set<View>;
  peaks: PeakWindow; // pico retenido (máximo de 1,5 s)
  rms: number;
  buf: Float32Array<ArrayBuffer> | null;
  own: AnalyserNode | null; // analyser propio sobre la salida de la tira
  ownTap: AudioNode | null;
  shown: string;
}
const tracks = new Map<string, Track>();
let sumUsers = 0;
let raf = 0;
let last = 0;
let frame = 0;

function dropOwn(t: Track): void {
  if (t.own && t.ownTap) {
    try { t.ownTap.disconnect(t.own); } catch { /* ya desconectado (la tira se rehízo) */ }
  }
  t.own = null;
  t.ownTap = null;
}

function readInto(an: AnalyserNode, t: Track): { peak: number; rms: number } {
  if (!t.buf || t.buf.length !== an.fftSize) t.buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(t.buf);
  return peakRmsDb(t.buf);
}

function measure(id: string, t: Track): { peak: number; rms: number } {
  try {
    const strip = getSourceStripOut(id);
    if (strip !== t.ownTap) {
      dropOwn(t);
      if (strip) {
        t.own = new AnalyserNode(strip.context, { fftSize: 8192, smoothingTimeConstant: 0 });
        strip.connect(t.own);
        t.ownTap = strip;
      }
    }
    if (t.own) {
      const r = readInto(t.own, t);
      if (Number.isFinite(r.peak)) return r;
      // la tira en silencio pero la pista podría sonar por otro bus (sidechain que reenruta)
    }
    const an = getSourceAnalyser(id);
    return an ? readInto(an, t) : { peak: -Infinity, rms: -Infinity };
  } catch {
    return { peak: -Infinity, rms: -Infinity };
  }
}

// --- la suma antes del máster ---
let sumAn: AnalyserNode | null = null;
let sumTapped: AudioNode | null = null;
let sumBuf: Float32Array<ArrayBuffer> = new Float32Array(4096);
const sumWin = new PeakWindow(1000);
let sumLive = -Infinity;
let sumMax = -Infinity;
let sumIgnoreUntil = 0; // tras «dejar margen»: aún suenan voces programadas con el gain de antes

function readSum(now: number): void {
  try {
    const out = getMasterOutputNode();
    if (!out) return;
    if (!sumAn || sumTapped !== out) {
      if (sumTapped && sumAn) { try { sumTapped.disconnect(sumAn); } catch { /* otro contexto */ } }
      // 4096 muestras (~85 ms) > un cuadro de medida: no se escapa ningún pico entre lecturas
      sumAn = new AnalyserNode(out.context, { fftSize: 4096, smoothingTimeConstant: 0 });
      out.connect(sumAn);
      sumTapped = out;
      sumBuf = new Float32Array(sumAn.fftSize);
    }
    sumAn.getFloatTimeDomainData(sumBuf);
    const { peak } = peakRmsDb(sumBuf);
    sumLive = sumWin.push(peak, now);
    if (now >= sumIgnoreUntil && peak > sumMax) sumMax = peak;
  } catch { /* nunca romper */ }
}

function tick(now: number): void {
  raf = requestAnimationFrame(tick);
  const dt = (now - last) / 1000;
  if (dt < 0.033) return;
  last = now;
  frame++;
  for (const [id, t] of tracks) {
    const { peak, rms } = measure(id, t);
    t.rms = fallDb(t.rms, rms, dt);
    const pk = t.peaks.push(peak, now);
    const vr = dbToMeter(t.rms).toFixed(3);
    const vp = dbToMeter(pk).toFixed(3);
    const hot = pk >= -0.1;
    const txt = frame % 4 === 0 ? fmtDb(pk) : null;
    if (txt) t.shown = txt;
    for (const v of t.views) {
      v.el.style.setProperty('--rms', vr);
      v.el.style.setProperty('--pk', vp);
      v.el.classList.toggle('hot', hot);
      if (v.txt && v.txt.textContent !== t.shown) v.txt.textContent = t.shown;
    }
  }
  if (sumUsers > 0) readSum(now);
}
function start(): void { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
function stopIfIdle(): void { if (!tracks.size && sumUsers <= 0 && raf) { cancelAnimationFrame(raf); raf = 0; } }

// un medidor de pista (puede haber varios por pista: nodo del grafo y cabecera del DAW)
export function registerTrackMeter(id: string, el: HTMLElement, txt: HTMLElement | null): () => void {
  let t = tracks.get(id);
  if (!t) {
    t = { views: new Set(), peaks: new PeakWindow(1500), rms: -Infinity, buf: null, own: null, ownTap: null, shown: '−∞' };
    tracks.set(id, t);
  }
  const v: View = { el, txt };
  t.views.add(v);
  start();
  return () => {
    const cur = tracks.get(id);
    if (!cur) return;
    cur.views.delete(v);
    if (!cur.views.size) { dropOwn(cur); tracks.delete(id); }
    stopIfIdle();
  };
}

// la suma antes del máster: quien la muestra se apunta (y se borra al irse)
export function watchSum(): () => void {
  sumUsers++;
  start();
  return () => {
    sumUsers--;
    if (sumUsers <= 0 && sumTapped && sumAn) {
      try { sumTapped.disconnect(sumAn); } catch { /* */ }
      sumAn = null;
      sumTapped = null;
    }
    stopIfIdle();
  };
}
// pico de la suma ahora (máximo del último segundo) y el máximo desde la última puesta a cero
// (dBFS; −∞ sin señal). `ignoreMs`: no contar lo que suene en ese rato (voces ya programadas
// con la mezcla de antes: el planificador va ~0,1–0,2 s por delante, más una ventana de medida).
export const getSumLive = () => sumLive;
export const getSumMax = () => sumMax;
export function resetSumPeak(ignoreMs = 0): void {
  sumMax = -Infinity;
  sumIgnoreUntil = performance.now() + ignoreMs;
}
