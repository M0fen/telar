// Cliente del WORKER de DSP de voz (autotune real + warp Rubber Band): la UI llama a
// autotuneVoz/warpVoz y el trabajo pesado corre fuera del hilo principal — nada de
// congelar la interfaz con tomas largas. DEFENSIVO: si el worker no arranca, falla o
// tarda demasiado, se cae al procesamiento inline de siempre (mismo resultado, con
// bloqueo momentáneo) — nunca dejar al usuario sin la herramienta.
//
// Este módulo es el ÚNICO que crea el worker; voiceWorker.ts importa solo las
// funciones *Data puras (sin ciclo de bundles).
import { autotuneBuffer as autotuneInline, type AutotuneOpts } from './autotune';
import { warpBuffer as warpInline, warpBufferData, type WarpOpts } from './rubberband';

interface JobResult { id: number; channels?: Float32Array[]; error?: string }

let worker: Worker | null = null;
let workerDead = false; // no reintentar en bucle si el entorno no soporta workers
let seq = 0;
const jobs = new Map<number, (out: Float32Array[] | null) => void>();

function getWorker(): Worker | null {
  if (workerDead) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./voiceWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<JobResult>) => {
        const { id, channels, error } = e.data ?? {};
        const done = jobs.get(id);
        if (done) { jobs.delete(id); done(error ? null : channels ?? null); }
      };
      worker.onerror = () => {
        // worker roto: resuelve todo a null (los llamadores caen al inline) y no reintenta.
        workerDead = true;
        for (const done of jobs.values()) done(null);
        jobs.clear();
        try { worker?.terminate(); } catch { /* */ }
        worker = null;
      };
    } catch {
      workerDead = true;
      worker = null;
    }
  }
  return worker;
}

// ejecuta un trabajo en el worker sobre canales crudos (se TRANSFIEREN: quedan vacíos); null =
// usar el fallback inline.
async function runJobData(op: 'autotune' | 'warp', channels: Float32Array[], sampleRate: number, opts: AutotuneOpts & WarpOpts): Promise<Float32Array[] | null> {
  const w = getWorker();
  if (!w) return null;
  const id = ++seq;
  const out = await new Promise<Float32Array[] | null>((resolve) => {
    const timer = window.setTimeout(() => { jobs.delete(id); resolve(null); }, 120000); // 2 min: tomas largas con R3
    jobs.set(id, (ch) => { clearTimeout(timer); resolve(ch); });
    try {
      w.postMessage({ id, op, channels, sampleRate, opts }, channels.map((c) => c.buffer));
    } catch {
      clearTimeout(timer);
      jobs.delete(id);
      resolve(null);
    }
  });
  return out && out[0]?.length ? out : null;
}

async function runJob(op: 'autotune' | 'warp', buffer: AudioBuffer, opts: AutotuneOpts & WarpOpts): Promise<AudioBuffer | null> {
  // copia transferible de los canales (el AudioBuffer original queda intacto para el fallback)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
  const out = await runJobData(op, channels, buffer.sampleRate, opts);
  if (!out) return null;
  const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: buffer.sampleRate });
  out.forEach((c, i) => buf.getChannelData(i).set(c));
  return buf;
}

// WARP sobre canales crudos (loops al tempo, Fase 5.2): worker y, si no arranca, inline. Los
// canales de entrada no se tocan (al worker va una copia). null = falló (audio defensivo: el
// llamador se queda con lo que tenía).
export async function warpChannels(channels: Float32Array[], sampleRate: number, opts: WarpOpts = {}): Promise<Float32Array[] | null> {
  const out = await runJobData('warp', channels.map((c) => c.slice()), sampleRate, opts);
  if (out) return out;
  return warpBufferData(channels, sampleRate, opts);
}

// AUTOTUNE REAL sin congelar la UI (worker + R3 por defecto; fallback inline).
export async function autotuneVoz(buffer: AudioBuffer, opts: AutotuneOpts = {}): Promise<AudioBuffer> {
  return (await runJob('autotune', buffer, opts)) ?? autotuneInline(buffer, opts);
}

// WARP (semitonos / duración) sin congelar la UI (worker + R3; fallback inline).
export async function warpVoz(buffer: AudioBuffer, opts: WarpOpts = {}): Promise<AudioBuffer> {
  if (Math.abs(opts.semitones ?? 0) < 0.001 && Math.abs((opts.timeRatio ?? 1) - 1) < 0.001) return buffer;
  return (await runJob('warp', buffer, opts)) ?? warpInline(buffer, opts);
}
