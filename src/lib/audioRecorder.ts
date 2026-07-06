import { getAudioCtx, getMasterOutputNode } from '../audio/engine';

// Grabador de SOLO audio en máxima calidad: captura el bus master (destinationGain)
// como PCM y lo exporta a WAV 32-bit float (IEEE) SIN compresión, al sample-rate del
// AudioContext (normalmente 48 kHz). Es lossless del audio que produce el motor.
//
// P1.6 (auditoría dancehall): la captura corre en un AUDIOWORKLET (hilo de audio),
// no en el main thread — el ScriptProcessorNode anterior se saltaba bloques bajo
// carga de UI (recompiles, paneles) y el WAV FINAL podía llevar cracks que los
// altavoces nunca reprodujeron. El worklet acumula bloques de 128 y los manda al
// main thread en lotes de 4096 frames; al parar, vacía el resto y confirma ('done')
// → no se pierde la cola. Fallback defensivo: si el worklet no puede cargarse,
// se usa el ScriptProcessor clásico (nunca dejar sin grabador).

const WORKLET_NAME = 'telar-recorder';
// Fuente del processor, inline (Blob URL): evita depender de ?url/rutas en prod.
const WORKLET_SRC = `
class TelarRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.cap = 4096;
    this.bl = new Float32Array(this.cap);
    this.br = new Float32Array(this.cap);
    this.fill = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.on = false;
        this.flush();
        this.port.postMessage('done');
      }
    };
  }
  flush() {
    if (!this.fill) return;
    const l = this.bl.slice(0, this.fill);
    const r = this.br.slice(0, this.fill);
    this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    this.fill = 0;
  }
  process(inputs) {
    if (!this.on) return false; // parado: el processor termina
    const inp = inputs[0];
    if (inp && inp.length && inp[0] && inp[0].length) {
      const L = inp[0];
      const R = inp[1] && inp[1].length ? inp[1] : inp[0];
      const n = L.length;
      if (this.fill + n > this.cap) this.flush();
      this.bl.set(L, this.fill);
      this.br.set(R, this.fill);
      this.fill += n;
      if (this.fill >= this.cap) this.flush();
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', TelarRecorder);
`;

let moduleReady: Promise<boolean> | null = null;
function ensureWorkletModule(ctx: AudioContext): Promise<boolean> {
  if (!moduleReady) {
    moduleReady = (async () => {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        return true;
      } catch (e) {
        console.warn('[recorder] AudioWorklet no disponible, caigo al ScriptProcessor:', e);
        return false;
      }
    })();
  }
  return moduleReady;
}

let worklet: AudioWorkletNode | null = null;
let proc: ScriptProcessorNode | null = null; // fallback legado
let sink: GainNode | null = null;
let src: AudioNode | null = null;
let left: Float32Array[] = [];
let right: Float32Array[] = [];
let recording = false;
let rate = 48000;

export function isAudioRecording(): boolean {
  return recording;
}

export async function startAudioRecording(): Promise<boolean> {
  if (recording) return false;
  const out = getMasterOutputNode();
  if (!out) return false; // aún no hay salida (no se ha iniciado el audio)
  const ctx = getAudioCtx();
  rate = ctx.sampleRate;
  left = [];
  right = [];
  // sink a 0: mantiene el nodo de captura "bombeando" sin duplicar el audio audible.
  sink = ctx.createGain();
  sink.gain.value = 0;
  try {
    if (await ensureWorkletModule(ctx)) {
      worklet = new AudioWorkletNode(ctx, WORKLET_NAME, {
        numberOfInputs: 1, numberOfOutputs: 1,
        channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      worklet.port.onmessage = (e) => {
        const d = e.data as { l?: Float32Array; r?: Float32Array };
        if (d && d.l && d.r) { left.push(d.l); right.push(d.r); }
      };
      out.connect(worklet);
      worklet.connect(sink);
    } else {
      // FALLBACK: ScriptProcessor clásico (main thread) — mejor eso que no grabar.
      proc = ctx.createScriptProcessor(4096, 2, 2);
      proc.onaudioprocess = (e) => {
        left.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        right.push(new Float32Array(e.inputBuffer.getChannelData(1)));
      };
      out.connect(proc);
      proc.connect(sink);
    }
  } catch (e) {
    console.warn('[recorder] no se pudo iniciar la captura:', e);
    try { sink.disconnect(); } catch { /* */ }
    sink = null; worklet = null; proc = null;
    return false;
  }
  sink.connect(ctx.destination);
  src = out;
  recording = true;
  return true;
}

export async function stopAudioRecording(): Promise<Blob | null> {
  if (!recording) return null;
  recording = false;
  // WORKLET: pedir el vaciado del lote parcial y esperar el 'done' (los mensajes del
  // port llegan en orden → primero el resto, luego la confirmación). Timeout defensivo.
  if (worklet) {
    await new Promise<void>((resolve) => {
      const w = worklet!;
      const timer = window.setTimeout(() => resolve(), 500);
      const prev = w.port.onmessage;
      w.port.onmessage = (e) => {
        if (e.data === 'done') { clearTimeout(timer); resolve(); }
        else prev?.call(w.port, e);
      };
      try { w.port.postMessage('stop'); } catch { clearTimeout(timer); resolve(); }
    });
  }
  try { src?.disconnect(worklet ?? proc!); } catch { /* nodo en transición */ }
  try { worklet?.disconnect(); } catch { /* idem */ }
  try { proc?.disconnect(); } catch { /* idem */ }
  try { sink?.disconnect(); } catch { /* idem */ }
  if (proc) proc.onaudioprocess = null;
  const blob = encodeWav(left, right, rate);
  worklet = null;
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
