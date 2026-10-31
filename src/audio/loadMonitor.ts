// CARGA DEL AUDIO (Fase 12.4). Lo que corta el audio en Telar es el hilo principal ocupado: el
// planificador agenda las notas ~0,1 s antes y, si el hilo se traba más que eso, llegan tarde o no
// llegan. Se mide el RETRASO del hilo (un temporizador cada 50 ms: cuánto llega tarde) y, si el
// navegador lo ofrece, la carga real del hilo de audio (AudioContext.renderCapacity). Un aviso
// cuando se acerca al límite.
import { getAudioCtx } from './engine';

export interface LoadReading { load: number; lagMs: number; audio: number | null; underruns: number; risky: boolean }
let lagMax = 0, lagAvg = 0, last = performance.now();
let audioLoad: number | null = null, underruns = 0;
let started = false;
const LIMIT_MS = 100; // la anticipación del planificador

export function startLoadMonitor(): void {
  if (started) return;
  started = true;
  window.setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - last - 50);
    last = now;
    lagMax = Math.max(lag, lagMax * 0.96);
    lagAvg = lagAvg * 0.9 + lag * 0.1;
  }, 50);
  // carga real del hilo de audio (Chrome con AudioRenderCapacity)
  const tryCapacity = () => {
    try {
      const ctx = getAudioCtx() as AudioContext & { renderCapacity?: EventTarget & { start: (o: { updateInterval: number }) => void } };
      const rc = ctx?.renderCapacity;
      if (!rc) return false;
      rc.addEventListener('update', (e: Event) => {
        const ev = e as Event & { averageLoad?: number; peakLoad?: number; underrunRatio?: number };
        audioLoad = Math.max(ev.averageLoad ?? 0, (ev.peakLoad ?? 0) * 0.8);
        if ((ev.underrunRatio ?? 0) > 0) underruns++;
      });
      rc.start({ updateInterval: 1 });
      return true;
    } catch {
      return false;
    }
  };
  let tries = 0;
  const t = window.setInterval(() => { if (tryCapacity() || ++tries > 20) window.clearInterval(t); }, 3000);
}

export function readLoad(): LoadReading {
  const main = Math.min(1, lagMax / LIMIT_MS);
  const load = Math.max(main, audioLoad ?? 0);
  return { load, lagMs: Math.round(lagMax), audio: audioLoad, underruns, risky: lagMax > LIMIT_MS * 0.6 || (audioLoad ?? 0) > 0.85 };
}
