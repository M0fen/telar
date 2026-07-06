// HILO B · B1 — Motor de warp/pitch de alta calidad (Rubber Band v4, WASM, GPL-2.0 → OK
// con AGPL). Time-stretch y pitch-shift INDEPENDIENTES y sin varispeed: afinar sin
// cambiar la duración, o estirar sin desafinar. A diferencia del `.stretch()` del motor
// (phase-vocoder crudo, mapeo por tramos), esto usa el algoritmo de Rubber Band y
// PRESERVA FORMANTES (clave para que la voz no suene a ardilla).
//
// Modo OFFLINE (no realtime): procesa un AudioBuffer entero → AudioBuffer nuevo. Es el
// flujo natural de Telar (grabar → corregir → usar como sample). El worklet realtime
// queda para más adelante. Defensivo: ante cualquier fallo, devuelve el buffer original
// (nunca revienta ni silencia).

import createRubberband from '@echogarden/rubberband-wasm';
import wasmUrl from '@echogarden/rubberband-wasm/rubberband.wasm?url';

// --- flags de opciones de Rubber Band (rubberband-c.h) ---
const OPT_PROCESS_OFFLINE = 0x00000000;
const OPT_PROCESS_REALTIME = 0x00000001; // permite cambiar el pitch por bloque (autotune)
const OPT_THREADING_NEVER = 0x00010000; // WASM sin pthreads → single-thread determinista
const OPT_FORMANT_PRESERVED = 0x01000000; // mantiene el timbre vocal al afinar
const OPT_PITCH_HIGH_QUALITY = 0x02000000;
// Motor: Faster (R2, 0x0) es el clásico probado; Finer (R3, 0x20000000) es mejor pero
// más pesado. Arrancamos con R2 (andamiaje fiable); R3 es un upgrade de calidad a probar.
const OPT_ENGINE_FASTER = 0x00000000;

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
}

// Afina y/o estira `buffer` con Rubber Band (offline). Devuelve un AudioBuffer NUEVO.
// Si no hay cambio real (semitones≈0 y timeRatio≈1) o algo falla, devuelve el original.
export async function warpBuffer(buffer: AudioBuffer, opts: WarpOpts = {}): Promise<AudioBuffer> {
  const semitones = opts.semitones ?? 0;
  const timeRatio = opts.timeRatio ?? 1;
  const formant = opts.formant ?? true;
  if (Math.abs(semitones) < 0.001 && Math.abs(timeRatio - 1) < 0.001) return buffer;

  try {
    const M = await getModule();
    const sr = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const nframes = buffer.length;
    if (!nframes || !channels) return buffer;
    const pitchScale = Math.pow(2, semitones / 12);
    let options = OPT_PROCESS_OFFLINE | OPT_ENGINE_FASTER | OPT_PITCH_HIGH_QUALITY | OPT_THREADING_NEVER;
    if (formant) options |= OPT_FORMANT_PRESERVED;

    const rb = M._rubberband_new(sr, channels, options, timeRatio, pitchScale);
    if (!rb) return buffer;

    const F = 4; // bytes por float
    const BLOCK = 8192; // frames por bloque de recuperación

    // punteros de heap a liberar al final
    const alloc: number[] = [];
    const malloc = (bytes: number) => { const p = M._malloc(bytes); alloc.push(p); return p; };

    // entrada: un buffer por canal + array de punteros (float* const*)
    const inChan: number[] = [];
    for (let c = 0; c < channels; c++) inChan.push(malloc(nframes * F));
    const inArr = malloc(channels * F);
    // salida: un buffer de bloque por canal + array de punteros
    const outChan: number[] = [];
    for (let c = 0; c < channels; c++) outChan.push(malloc(BLOCK * F));
    const outArr = malloc(channels * F);

    // escribir datos DESPUÉS de todos los malloc (crecer memoria invalida vistas viejas)
    for (let c = 0; c < channels; c++) {
      M.HEAPF32.set(buffer.getChannelData(c), inChan[c] >> 2);
      M.HEAPU32[(inArr >> 2) + c] = inChan[c];
      M.HEAPU32[(outArr >> 2) + c] = outChan[c];
    }

    // OFFLINE: estudiar toda la entrada, luego procesarla toda (final=1 en ambas).
    M._rubberband_set_expected_input_duration(rb, nframes);
    M._rubberband_study(rb, inArr, nframes, 1);
    M._rubberband_process(rb, inArr, nframes, 1);

    // recuperar la salida en bloques (avail<=0 → no queda nada)
    const chunks: Float32Array[][] = Array.from({ length: channels }, () => []);
    let total = 0;
    let avail = 0;
    while ((avail = M._rubberband_available(rb)) > 0) {
      const want = Math.min(avail, BLOCK);
      const got = M._rubberband_retrieve(rb, outArr, want);
      if (got <= 0) break;
      for (let c = 0; c < channels; c++) {
        const base = outChan[c] >> 2;
        chunks[c].push(new Float32Array(M.HEAPF32.subarray(base, base + got))); // copia fuera del heap
      }
      total += got;
    }

    M._rubberband_delete(rb);
    for (const p of alloc) M._free(p);

    if (total === 0) return buffer;

    // ensamblar el AudioBuffer de salida
    const outBuf = new AudioBuffer({ length: total, numberOfChannels: channels, sampleRate: sr });
    for (let c = 0; c < channels; c++) {
      const data = outBuf.getChannelData(c);
      let off = 0;
      for (const ch of chunks[c]) { data.set(ch, off); off += ch.length; }
    }
    return outBuf;
  } catch (err) {
    console.warn('[rubberband] warp falló, devuelvo el buffer original:', err);
    return buffer;
  }
}

// B2c — resíntesis con PITCH VARIABLE en el tiempo (autotune real): procesa en modo
// TIEMPO REAL bloque a bloque, fijando el pitch de cada bloque desde `ratioAtSample`
// (ratio de corrección muestreado cada `ratioHop` muestras, interpolado). Duración
// intacta (timeRatio=1), formantes preservados. Devuelve un AudioBuffer nuevo alineado
// (se descarta la latencia de arranque). Ante fallo, devuelve el original.
export async function warpVaryingPitch(buffer: AudioBuffer, ratioAtSample: Float32Array, ratioHop: number, opts: { formant?: boolean } = {}): Promise<AudioBuffer> {
  const formant = opts.formant ?? true;
  try {
    const M = await getModule();
    const sr = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const nframes = buffer.length;
    if (!nframes || !channels || !ratioAtSample.length) return buffer;
    let options = OPT_PROCESS_REALTIME | OPT_ENGINE_FASTER | OPT_PITCH_HIGH_QUALITY | OPT_THREADING_NEVER;
    if (formant) options |= OPT_FORMANT_PRESERVED;
    const rb = M._rubberband_new(sr, channels, options, 1.0, 1.0);
    if (!rb) return buffer;

    const F = 4, BLOCK = 1024;
    const alloc: number[] = [];
    const malloc = (bytes: number) => { const p = M._malloc(bytes); alloc.push(p); return p; };
    const inChan: number[] = []; for (let c = 0; c < channels; c++) inChan.push(malloc(BLOCK * F));
    const inArr = malloc(channels * F);
    const outChan: number[] = []; for (let c = 0; c < channels; c++) outChan.push(malloc(BLOCK * F));
    const outArr = malloc(channels * F);
    for (let c = 0; c < channels; c++) { M.HEAPU32[(inArr >> 2) + c] = inChan[c]; M.HEAPU32[(outArr >> 2) + c] = outChan[c]; }
    const src: Float32Array[] = []; for (let c = 0; c < channels; c++) src.push(buffer.getChannelData(c));

    const ratioAt = (i: number) => {
      const k = i / ratioHop, k0 = Math.floor(k), frac = k - k0;
      const a = ratioAtSample[Math.min(ratioAtSample.length - 1, k0)] || 1;
      const b = ratioAtSample[Math.min(ratioAtSample.length - 1, k0 + 1)] || a;
      return a + (b - a) * frac;
    };

    const latency = Math.max(0, M._rubberband_get_latency(rb) | 0);
    const chunks: Float32Array[][] = Array.from({ length: channels }, () => []);
    let total = 0;
    const drain = () => {
      let avail = 0;
      while ((avail = M._rubberband_available(rb)) > 0) {
        const want = Math.min(avail, BLOCK);
        const got = M._rubberband_retrieve(rb, outArr, want);
        if (got <= 0) break;
        for (let c = 0; c < channels; c++) { const base = outChan[c] >> 2; chunks[c].push(new Float32Array(M.HEAPF32.subarray(base, base + got))); }
        total += got;
      }
    };
    // procesa toda la entrada (SIN marcar final: el modo RT retrasa la salida `latency`)
    let pos = 0;
    while (pos < nframes) {
      const n = Math.min(BLOCK, nframes - pos);
      M._rubberband_set_pitch_scale(rb, ratioAt(pos));
      for (let c = 0; c < channels; c++) M.HEAPF32.set(src[c].subarray(pos, pos + n), inChan[c] >> 2);
      M._rubberband_process(rb, inArr, n, 0);
      drain();
      pos += n;
    }
    // FLUSH: alimenta `latency` muestras de silencio (con final) para expulsar la cola
    // retrasada → la salida conserva la duración completa (antes se perdían los ~23ms
    // finales, que cortaban el final de la última palabra).
    if (latency > 0) {
      for (let c = 0; c < channels; c++) M.HEAPF32.fill(0, inChan[c] >> 2, (inChan[c] >> 2) + BLOCK);
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
    if (total === 0) return buffer;

    // aplanar por canal y recortar la latencia de arranque para alinear con la entrada
    const start = Math.min(latency, Math.max(0, total - 1));
    const outLen = Math.min(nframes, total - start);
    const outBuf = new AudioBuffer({ length: nframes, numberOfChannels: channels, sampleRate: sr });
    for (let c = 0; c < channels; c++) {
      const flat = new Float32Array(total); let o = 0;
      for (const ch of chunks[c]) { flat.set(ch, o); o += ch.length; }
      outBuf.getChannelData(c).set(flat.subarray(start, start + outLen));
    }
    return outBuf;
  } catch (err) {
    console.warn('[rubberband] autotune (pitch variable) falló, devuelvo el original:', err);
    return buffer;
  }
}
