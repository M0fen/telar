import { getAudioCtx, getMasterOutputNode } from '../audio/engine';

// Grabador de SOLO audio en máxima calidad: captura el bus master (destinationGain)
// como PCM y lo exporta a WAV 32-bit float (IEEE) SIN compresión, al sample-rate del
// AudioContext (normalmente 48 kHz). Es lossless del audio que produce el motor — la
// mejor calidad posible (a diferencia del .webm/opus del record de video, que es con
// pérdida).
//
// Usamos un ScriptProcessorNode: deprecado pero soportado en todos los navegadores
// actuales y suficiente para capturar. Lo conectamos a un GainNode a 0 → destino,
// para que "bombee" sin duplicar el audio que se oye.

let proc: ScriptProcessorNode | null = null;
let sink: GainNode | null = null;
let src: AudioNode | null = null;
let left: Float32Array[] = [];
let right: Float32Array[] = [];
let recording = false;
let rate = 48000;

export function isAudioRecording(): boolean {
  return recording;
}

export function startAudioRecording(): boolean {
  if (recording) return false;
  const out = getMasterOutputNode();
  if (!out) return false; // aún no hay salida (no se ha iniciado el audio)
  const ctx = getAudioCtx();
  rate = ctx.sampleRate;
  left = [];
  right = [];
  proc = ctx.createScriptProcessor(4096, 2, 2);
  proc.onaudioprocess = (e) => {
    // copia (los buffers se reutilizan entre callbacks)
    left.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    right.push(new Float32Array(e.inputBuffer.getChannelData(1)));
  };
  sink = ctx.createGain();
  sink.gain.value = 0; // no añade nada audible; solo mantiene el procesador activo
  out.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);
  src = out;
  recording = true;
  return true;
}

export function stopAudioRecording(): Blob | null {
  if (!recording) return null;
  recording = false;
  try {
    src?.disconnect(proc!);
  } catch {
    /* nodo en transición */
  }
  try {
    proc?.disconnect();
  } catch {
    /* idem */
  }
  try {
    sink?.disconnect();
  } catch {
    /* idem */
  }
  if (proc) proc.onaudioprocess = null;
  const blob = encodeWav(left, right, rate);
  proc = null;
  sink = null;
  src = null;
  left = [];
  right = [];
  return blob;
}

function flatten(chunks: Float32Array[], len: number): Float32Array {
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// WAV estéreo, PCM IEEE float 32-bit (format code 3) = sin pérdida del bus master.
function encodeWav(l: Float32Array[], r: Float32Array[], sampleRate: number): Blob {
  const len = l.reduce((a, c) => a + c.length, 0);
  const L = flatten(l, len);
  const R = flatten(r, len);
  const channels = 2;
  const bytesPerSample = 4;
  const blockAlign = channels * bytesPerSample;
  const dataLen = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // 3 = IEEE float
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bytesPerSample * 8, true);
  ws(36, 'data');
  v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    v.setFloat32(off, L[i], true);
    off += 4;
    v.setFloat32(off, R[i], true);
    off += 4;
  }
  return new Blob([buf], { type: 'audio/wav' });
}
