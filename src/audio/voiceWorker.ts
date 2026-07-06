// WORKER de DSP de voz: corre el autotune real (YIN + Rubber Band) y el warp FUERA del
// hilo principal — una toma de 30 s congelaba la UI segundos enteros. Recibe los
// canales crudos (Float32Array transferidos), procesa con las funciones *Data puras
// (aquí no existe AudioBuffer) y devuelve los canales nuevos, también transferidos.
// El cliente (voiceDsp.ts) reconstruye el AudioBuffer en el hilo principal.
import { autotuneData, type AutotuneOpts } from './autotune';
import { warpBufferData, type WarpOpts } from './rubberband';

interface JobMsg {
  id: number;
  op: 'autotune' | 'warp';
  channels: Float32Array[];
  sampleRate: number;
  opts: AutotuneOpts & WarpOpts;
}

// postMessage con transferibles (el tipo de Window no expone esta firma en un worker)
const post = self.postMessage.bind(self) as (msg: unknown, transfer?: Transferable[]) => void;

self.onmessage = async (e: MessageEvent<JobMsg>) => {
  const { id, op, channels, sampleRate, opts } = e.data;
  try {
    const out = op === 'autotune'
      ? await autotuneData(channels, sampleRate, opts)
      : await warpBufferData(channels, sampleRate, opts);
    if (!out || !out[0]?.length) { post({ id, error: 'el proceso no produjo salida' }); return; }
    post({ id, channels: out }, out.map((c) => c.buffer as ArrayBuffer));
  } catch (err) {
    post({ id, error: String(err) });
  }
};
