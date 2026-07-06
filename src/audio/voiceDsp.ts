// Cliente del WORKER de DSP de voz (autotune real + warp Rubber Band): la UI llama a
// autotuneVoz/warpVoz y el trabajo pesado corre fuera del hilo principal — nada de
// congelar la interfaz con tomas largas. DEFENSIVO: si el worker no arranca, falla o
// tarda demasiado, se cae al procesamiento inline de siempre (mismo resultado, con
// bloqueo momentáneo) — nunca dejar al usuario sin la herramienta.
//
// Este módulo es el ÚNICO que crea el worker; voiceWorker.ts importa solo las
// funciones *Data puras (sin ciclo de bundles).
import { autotuneBuffer as autotuneInline, type AutotuneOpts } from './autotune';
import { warpBuffer as warpInline, type WarpOpts } from './rubberband';

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

// ejecuta un trabajo en el worker; null = usar el fallback inline.
async function runJob(op: 'autotune' | 'warp', buffer: AudioBuffer, opts: AutotuneOpts & WarpOpts): Promise<AudioBuffer | null> {
  const w = getWorker();
  if (!w) return null;
  // copia transferible de los canales (el AudioBuffer original queda intacto para el fallback)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
  const id = ++seq;
  const out = await new Promise<Float32Array[] | null>((resolve) => {
    const timer = window.setTimeout(() => { jobs.delete(id); resolve(null); }, 120000); // 2 min: tomas largas con R3
    jobs.set(id, (ch) => { clearTimeout(timer); resolve(ch); });
    try {
      w.postMessage({ id, op, channels, sampleRate: buffer.sampleRate, opts }, channels.map((c) => c.buffer));
    } catch {
      clearTimeout(timer);
      jobs.delete(id);
      resolve(null);
    }
  });
  if (!out || !out[0]?.length) return null;
  const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: buffer.sampleRate });
  out.forEach((c, i) => buf.getChannelData(i).set(c));
  return buf;
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
