// WORKER del GRABADOR DE SET (modo DJ, DJ-4): codifica a MP3 320 MIENTRAS se graba, por trozos —
// una hora de set son ~140 MB en MP3 (en PCM serían 1,4 GB en memoria). Recibe los bloques del
// máster (Float32 L/R transferidos), los pasa a 16 bit con dither y los va codificando; al «stop»
// vacía el codificador y devuelve las partes del archivo.
import { Mp3Encoder } from '@breezystack/lamejs';
import { rng32, toInt16 } from '../lib/audioFormats';

type Msg = { init: { sampleRate: number; kbps: number } } | { l: Float32Array; r: Float32Array } | { stop: true };

const post = self.postMessage.bind(self) as (msg: unknown, transfer?: Transferable[]) => void;
let enc: Mp3Encoder | null = null;
let parts: Uint8Array[] = [];
let bytes = 0;
let frames = 0;
const rand = rng32(0x5e7);
const BLOCK = 1152 * 8;

self.onmessage = (e: MessageEvent<Msg>) => {
  const d = e.data;
  try {
    if ('init' in d) {
      enc = new Mp3Encoder(2, d.init.sampleRate, d.init.kbps);
      parts = [];
      bytes = 0;
      frames = 0;
      return;
    }
    if (!enc) return;
    if ('l' in d) {
      const L = toInt16(d.l, rand), R = toInt16(d.r, rand);
      for (let i = 0; i < L.length; i += BLOCK) {
        const out = enc.encodeBuffer(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK));
        if (out.length) { const u = new Uint8Array(out); parts.push(u); bytes += u.length; }
      }
      frames += L.length;
      return;
    }
    if ('stop' in d) {
      const end = enc.flush();
      if (end.length) { const u = new Uint8Array(end); parts.push(u); bytes += u.length; }
      enc = null;
      post({ parts, frames, bytes }, parts.map((p) => p.buffer as ArrayBuffer));
      parts = [];
    }
  } catch (err) {
    post({ error: String(err) });
  }
};
