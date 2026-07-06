// HILO B · B1 — Motor de warp/pitch de alta calidad (Rubber Band v4, WASM, GPL-2.0 → OK
// con AGPL). Time-stretch y pitch-shift INDEPENDIENTES y sin varispeed: afinar sin
// cambiar la duración, o estirar sin desafinar. A diferencia del `.stretch()` del motor
// (phase-vocoder crudo, mapeo por tramos), esto usa el algoritmo de Rubber Band y
// PRESERVA FORMANTES (clave para que la voz no suene a ardilla).
//
// Modo OFFLINE (no realtime): procesa el audio entero → audio nuevo. Defensivo: ante
// cualquier fallo, los wrappers devuelven el buffer original (nunca revienta ni calla).
//
// ESTRUCTURA (worker de voz): las funciones *Data operan sobre Float32Array[] +
// sampleRate — sin AudioBuffer — para poder correr en un WEB WORKER (los workers no
// tienen AudioBuffer, y el DSP síncrono congelaba la UI con tomas largas). Los
// wrappers warpBuffer/warpVaryingPitch (AudioBuffer) son para el hilo principal.

import createRubberband from '@echogarden/rubberband-wasm';
import wasmUrl from '@echogarden/rubberband-wasm/rubberband.wasm?url';

// --- flags de opciones de Rubber Band (rubberband-c.h) ---
const OPT_PROCESS_OFFLINE = 0x00000000;
const OPT_PROCESS_REALTIME = 0x00000001; // permite cambiar el pitch por bloque (autotune)
const OPT_THREADING_NEVER = 0x00010000; // WASM sin pthreads → single-thread determinista
const OPT_FORMANT_PRESERVED = 0x01000000; // mantiene el timbre vocal al afinar
const OPT_PITCH_HIGH_QUALITY = 0x02000000;
// Motor: Faster (R2, 0x0) es el clásico; Finer (R3) suena más limpio (menos artefactos)
// a costa de CPU — como el DSP ahora corre en worker, R3 es el DEFAULT de los procesos
// destructivos. Si _rubberband_new fallara con R3, se reintenta con R2 (defensivo).
const OPT_ENGINE_FASTER = 0x00000000;
const OPT_ENGINE_FINER = 0x20000000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getModule(): Promise<any> {
  if (!modPromise) modPromise = createRubberband({ locateFile: () => wasmUrl });
  return modPromise;
}

// precarga el WASM (opcional): llamar al abrir el estudio de voz para que el 1er warp
// no espere la descarga/compilación del módulo.
export function preloadRubberband(): void {
  void getModule().catch(() => {});
}

export interface WarpOpts {
  semitones?: number; // afinado en semitonos (pitch), independiente del tiempo
  timeRatio?: number; // duración de salida / entrada (1 = igual; 2 = el doble de largo)
  formant?: boolean; // preservar formantes (voz natural). Por defecto true.
  fine?: boolean; // motor R3/Finer (más limpio, más CPU). Por defecto true.
}

// crea la instancia probando R3 (Finer) y cayendo a R2 si el motor la rechaza.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function newRb(M: any, sr: number, channels: number, base: number, fine: boolean, timeRatio: number, pitchScale: number): number {
  if (fine) {
    const rb = M._rubberband_new(sr, channels, base | OPT_ENGINE_FINER, timeRatio, pitchScale);
    if (rb) return rb;
  }
  return M._rubberband_new(sr, channels, base | OPT_ENGINE_FASTER, timeRatio, pitchScale);
}

// Afina y/o estira los canales (offline). Devuelve canales NUEVOS o null si falla.
export async function warpBufferData(channels: Float32Array[], sr: number, opts: WarpOpts = {}): Promise<Float32Array[] | null> {
  const semitones = opts.semitones ?? 0;
  const timeRatio = opts.timeRatio ?? 1;
  const formant = opts.formant ?? true;
  try {
    const M = await getModule();
    const nCh = channels.length;
    const nframes = channels[0]?.length ?? 0;
    if (!nframes || !nCh) return null;
    const pitchScale = Math.pow(2, semitones / 12);
    let options = OPT_PROCESS_OFFLINE | OPT_PITCH_HIGH_QUALITY | OPT_THREADING_NEVER;
    if (formant) options |= OPT_FORMANT_PRESERVED;

    const rb = newRb(M, sr, nCh, options, opts.fine ?? true, timeRatio, pitchScale);
    if (!rb) return null;

    const F = 4; // bytes por float
    const BLOCK = 8192; // frames por bloque de recuperación

    // punteros de heap a liberar al final
    const alloc: number[] = [];
    const malloc = (bytes: number) => { const p = M._malloc(bytes); alloc.push(p); return p; };

    // entrada: un buffer por canal + array de punteros (float* const*)
    const inChan: number[] = [];
    for (let c = 0; c < nCh; c++) inChan.push(malloc(nframes * F));
    const inArr = malloc(nCh * F);
    // salida: un buffer de bloque por canal + array de punteros
    const outChan: number[] = [];
    for (let c = 0; c < nCh; c++) outChan.push(malloc(BLOCK * F));
    const outArr = malloc(nCh * F);

    // escribir datos DESPUÉS de todos los malloc (crecer memoria invalida vistas viejas)
    for (let c = 0; c < nCh; c++) {
      M.HEAPF32.set(channels[c], inChan[c] >> 2);
      M.HEAPU32[(inArr >> 2) + c] = inChan[c];
      M.HEAPU32[(outArr >> 2) + c] = outChan[c];
    }

    // OFFLINE: estudiar toda la entrada, luego procesarla toda (final=1 en ambas).
    M._rubberband_set_expected_input_duration(rb, nframes);
    M._rubberband_study(rb, inArr, nframes, 1);
    M._rubberband_process(rb, inArr, nframes, 1);

    // recuperar la salida en bloques (avail<=0 → no queda nada)
    const chunks: Float32Array[][] = Array.from({ length: nCh }, () => []);
    let total = 0;
    let avail = 0;
    while ((avail = M._rubberband_available(rb)) > 0) {
      const want = Math.min(avail, BLOCK);
      const got = M._rubberband_retrieve(rb, outArr, want);
      if (got <= 0) break;
      for (let c = 0; c < nCh; c++) {
        const base = outChan[c] >> 2;
        chunks[c].push(new Float32Array(M.HEAPF32.subarray(base, base + got))); // copia fuera del heap
      }
      total += got;
    }

    M._rubberband_delete(rb);
    for (const p of alloc) M._free(p);
    if (total === 0) return null;

    return chunks.map((ch) => {
      const data = new Float32Array(total);
      let off = 0;
      for (const c of ch) { data.set(c, off); off += c.length; }
      return data;
    });
  } catch (err) {
    console.warn('[rubberband] warp (data) falló:', err);
    return null;
  }
}

// Wrapper AudioBuffer (hilo principal). Si no hay cambio real (semitones≈0 y
// timeRatio≈1) o algo falla, devuelve el buffer ORIGINAL (audio defensivo).
export async function warpBuffer(buffer: AudioBuffer, opts: WarpOpts = {}): Promise<AudioBuffer> {
  const semitones = opts.semitones ?? 0;
  const timeRatio = opts.timeRatio ?? 1;
  if (Math.abs(semitones) < 0.001 && Math.abs(timeRatio - 1) < 0.001) return buffer;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const out = await warpBufferData(channels, buffer.sampleRate, opts);
  if (!out || !out[0]?.length) return buffer;
  const outBuf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: buffer.sampleRate });
  out.forEach((c, i) => outBuf.getChannelData(i).set(c));
  return outBuf;
}

// B2c — resíntesis con PITCH VARIABLE en el tiempo (autotune real): procesa en modo
// TIEMPO REAL bloque a bloque, fijando el pitch de cada bloque desde `ratioAtSample`
// (ratio de corrección muestreado cada `ratioHop` muestras, interpolado). Duración
// intacta, formantes preservados, latencia alineada. Devuelve canales nuevos o null.
export async function warpVaryingPitchData(
  channels: Float32Array[],
  sr: number,
  ratioAtSample: Float32Array,
  ratioHop: number,
  opts: { formant?: boolean; fine?: boolean } = {},
): Promise<Float32Array[] | null> {
  const formant = opts.formant ?? true;
  try {
    const M = await getModule();
    const nCh = channels.length;
    const nframes = channels[0]?.length ?? 0;
    if (!nframes || !nCh || !ratioAtSample.length) return null;
    let options = OPT_PROCESS_REALTIME | OPT_PITCH_HIGH_QUALITY | OPT_THREADING_NEVER;
    if (formant) options |= OPT_FORMANT_PRESERVED;
    const rb = newRb(M, sr, nCh, options, opts.fine ?? true, 1.0, 1.0);
    if (!rb) return null;

    const F = 4, BLOCK = 1024;
    const alloc: number[] = [];
    const malloc = (bytes: number) => { const p = M._malloc(bytes); alloc.push(p); return p; };
    const inChan: number[] = []; for (let c = 0; c < nCh; c++) inChan.push(malloc(BLOCK * F));
    const inArr = malloc(nCh * F);
    const outChan: number[] = []; for (let c = 0; c < nCh; c++) outChan.push(malloc(BLOCK * F));
    const outArr = malloc(nCh * F);
    for (let c = 0; c < nCh; c++) { M.HEAPU32[(inArr >> 2) + c] = inChan[c]; M.HEAPU32[(outArr >> 2) + c] = outChan[c]; }

    const ratioAt = (i: number) => {
      const k = i / ratioHop, k0 = Math.floor(k), frac = k - k0;
      const a = ratioAtSample[Math.min(ratioAtSample.length - 1, k0)] || 1;
      const b = ratioAtSample[Math.min(ratioAtSample.length - 1, k0 + 1)] || a;
      return a + (b - a) * frac;
    };

    const latency = Math.max(0, M._rubberband_get_latency(rb) | 0);
    const chunks: Float32Array[][] = Array.from({ length: nCh }, () => []);
    let total = 0;
    const drain = () => {
      let avail = 0;
      while ((avail = M._rubberband_available(rb)) > 0) {
        const want = Math.min(avail, BLOCK);
        const got = M._rubberband_retrieve(rb, outArr, want);
        if (got <= 0) break;
        for (let c = 0; c < nCh; c++) { const base = outChan[c] >> 2; chunks[c].push(new Float32Array(M.HEAPF32.subarray(base, base + got))); }
        total += got;
      }
    };
    // procesa toda la entrada (SIN marcar final: el modo RT retrasa la salida `latency`)
    let pos = 0;
    while (pos < nframes) {
      const n = Math.min(BLOCK, nframes - pos);
      M._rubberband_set_pitch_scale(rb, ratioAt(pos));
      for (let c = 0; c < nCh; c++) M.HEAPF32.set(channels[c].subarray(pos, pos + n), inChan[c] >> 2);
      M._rubberband_process(rb, inArr, n, 0);
      drain();
      pos += n;
    }
    // FLUSH: alimenta `latency` muestras de silencio (con final) para expulsar la cola
    // retrasada → la salida conserva la duración completa (sin esto se perdían los
    // ~23 ms finales, que cortaban el final de la última palabra).
    if (latency > 0) {
      for (let c = 0; c < nCh; c++) M.HEAPF32.fill(0, inChan[c] >> 2, (inChan[c] >> 2) + BLOCK);
      let toFlush = latency + BLOCK;
      while (toFlush > 0) {
        const n = Math.min(BLOCK, toFlush);
        M._rubberband_process(rb, inArr, n, toFlush - n <= 0 ? 1 : 0);
        drain();
        toFlush -= n;
      }
    }
    M._rubberband_delete(rb);
    for (const p of alloc) M._free(p);
    if (total === 0) return null;

    // aplanar por canal y recortar la latencia de arranque para alinear con la entrada
    const start = Math.min(latency, Math.max(0, total - 1));
    const outLen = Math.min(nframes, total - start);
    return chunks.map((ch) => {
      const flat = new Float32Array(total); let o = 0;
      for (const c of ch) { flat.set(c, o); o += c.length; }
      const data = new Float32Array(nframes);
      data.set(flat.subarray(start, start + outLen));
      return data;
    });
  } catch (err) {
    console.warn('[rubberband] autotune (pitch variable, data) falló:', err);
    return null;
  }
}

// Wrapper AudioBuffer (hilo principal). Ante fallo, devuelve el original.
export async function warpVaryingPitch(buffer: AudioBuffer, ratioAtSample: Float32Array, ratioHop: number, opts: { formant?: boolean; fine?: boolean } = {}): Promise<AudioBuffer> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const out = await warpVaryingPitchData(channels, buffer.sampleRate, ratioAtSample, ratioHop, opts);
  if (!out || !out[0]?.length) return buffer;
  const outBuf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: buffer.sampleRate });
  out.forEach((c, i) => outBuf.getChannelData(i).set(c));
  return outBuf;
}
