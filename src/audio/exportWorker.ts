// WORKER de ENTREGA (Fase 4.3): convierte la frecuencia de muestreo y codifica (WAV 24/16 con
// dither, 32 float, o MP3 320) FUERA del hilo principal — con un tema de 7 minutos son segundos
// de cálculo que congelarían la interfaz. Recibe los canales (Float32Array transferidos) y
// devuelve las partes del archivo (también transferidas) para armar un Blob.
import { encodeWav, resample, toInt16, rng32, type ExportFormat } from '../lib/audioFormats';
import { Mp3Encoder } from '@breezystack/lamejs';

interface Job {
  chans: Float32Array[];
  srIn: number;
  srOut: number;
  format: ExportFormat;
}

const post = self.postMessage.bind(self) as (msg: unknown, transfer?: Transferable[]) => void;

self.onmessage = (e: MessageEvent<Job>) => {
  const { chans, srIn, srOut, format } = e.data;
  try {
    post({ progress: 0.05 });
    const ch = srIn !== srOut ? resample(chans, srIn, srOut) : chans;
    post({ progress: format === 'mp3' ? 0.3 : 0.6 });
    let parts: Uint8Array[];
    if (format === 'mp3') {
      const rand = rng32(0x5eed);
      const L = toInt16(ch[0], rand);
      const R = ch.length > 1 ? toInt16(ch[1], rand) : L;
      const enc = new Mp3Encoder(2, srOut, 320);
      parts = [];
      const block = 1152 * 32;
      for (let i = 0; i < L.length; i += block) {
        const out = enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block));
        if (out.length) parts.push(new Uint8Array(out));
        if ((i / block) % 40 === 0) post({ progress: 0.3 + 0.7 * (i / L.length) });
      }
      const end = enc.flush();
      if (end.length) parts.push(new Uint8Array(end));
    } else {
      const bits = format === 'wav16' ? 16 : format === 'wav24' ? 24 : 32;
      parts = encodeWav(ch, srOut, bits, rng32(0x5eed));
    }
    post({ parts, frames: ch[0]?.length ?? 0 }, parts.map((p) => p.buffer as ArrayBuffer));
  } catch (err) {
    post({ error: String(err) });
  }
};
