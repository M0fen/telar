// Cliente del worker de entrega (Fase 4.3): AudioBuffer renderizado → archivo en el formato y
// la frecuencia pedidos. Si el worker no arranca, lo hace en el hilo principal (más lento,
// mismo resultado).
import { encodeWav, resample, rng32, toInt16, type ExportFormat } from './audioFormats';

export interface EncodedFile {
  blob: Blob;
  frames: number;
  sampleRate: number;
  ext: 'wav' | 'mp3';
}

const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg' } as const;

export async function encodeAudio(buf: AudioBuffer, format: ExportFormat, srOut: number, onProgress?: (f: number) => void): Promise<EncodedFile> {
  const ext = format === 'mp3' ? 'mp3' : 'wav';
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).slice());
  const srIn = buf.sampleRate;
  try {
    const res = await new Promise<{ parts: Uint8Array[]; frames: number }>((resolve, reject) => {
      const w = new Worker(new URL('../audio/exportWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ progress?: number; parts?: Uint8Array[]; frames?: number; error?: string }>) => {
        const d = e.data;
        if (typeof d.progress === 'number') onProgress?.(d.progress);
        if (d.error) { w.terminate(); reject(new Error(d.error)); }
        if (d.parts) { w.terminate(); resolve({ parts: d.parts, frames: d.frames ?? 0 }); }
      };
      w.onerror = (ev) => { w.terminate(); reject(new Error(ev.message || 'worker')); };
      w.postMessage({ chans, srIn, srOut, format }, chans.map((c) => c.buffer as ArrayBuffer));
    });
    return { blob: new Blob(res.parts as BlobPart[], { type: MIME[ext] }), frames: res.frames, sampleRate: srOut, ext };
  } catch (e) {
    console.warn('[export] worker de entrega no disponible → hilo principal', e);
    // los canales se transfirieron al worker: se vuelven a leer del buffer
    const again: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) again.push(buf.getChannelData(c));
    const ch = srIn !== srOut ? resample(again, srIn, srOut) : again;
    if (format === 'mp3') {
      const { Mp3Encoder } = await import('@breezystack/lamejs');
      const rand = rng32(0x5eed);
      const L = toInt16(ch[0], rand);
      const R = ch.length > 1 ? toInt16(ch[1], rand) : L;
      const enc = new Mp3Encoder(2, srOut, 320);
      const parts: Uint8Array[] = [];
      for (let i = 0; i < L.length; i += 1152 * 32) {
        const out = enc.encodeBuffer(L.subarray(i, i + 1152 * 32), R.subarray(i, i + 1152 * 32));
        if (out.length) parts.push(new Uint8Array(out));
      }
      const end = enc.flush();
      if (end.length) parts.push(new Uint8Array(end));
      return { blob: new Blob(parts as BlobPart[], { type: MIME.mp3 }), frames: ch[0].length, sampleRate: srOut, ext };
    }
    const bits = format === 'wav16' ? 16 : format === 'wav24' ? 24 : 32;
    return { blob: new Blob(encodeWav(ch, srOut, bits, rng32(0x5eed)) as BlobPart[], { type: MIME.wav }), frames: ch[0].length, sampleRate: srOut, ext };
  }
}
