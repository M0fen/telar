// HILO B · B2a — Detección de tono (pitch tracking) monofónico con el algoritmo YIN
// (de Cheveigné & Kawahara, 2002). Recorre el audio frame a frame y estima la
// frecuencia fundamental (f0) de la voz en cada instante. Base del autotune REAL:
// primero saber qué tono cantaste en cada momento, para luego corregirlo.
//
// Puro (sin Web Audio ni WASM) → testeable en Node. Monofónico (una voz a la vez),
// que es justo el caso de una toma vocal.

export interface PitchFrame {
  time: number; // segundos (centro del frame)
  f0: number; // Hz; 0 = sin tono claro (silencio/consonante/no sonoro)
  clarity: number; // 0..1 confianza (1 - d'min); útil para umbral de voz
}

export interface PitchOpts {
  minHz?: number; // f0 mínima buscada (por defecto 70 ≈ voz grave)
  maxHz?: number; // f0 máxima (por defecto 1000)
  hop?: number; // salto entre frames en muestras (por defecto 256)
  threshold?: number; // umbral YIN de d' (por defecto 0.15)
}

// Difración YIN acumulada + normalizada para un frame, y elección del tau (periodo).
// Devuelve tau interpolado (subm muestra) y la claridad, o null si no hay tono.
function yinFrame(x: Float32Array, off: number, W: number, tauMin: number, tauMax: number, threshold: number): { tau: number; clarity: number } | null {
  // 1) función de diferencia d(tau) = Σ_j (x[j] - x[j+tau])^2
  const d = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = x[off + j] - x[off + j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // 2) diferencia media acumulada normalizada d'(tau)
  const dp = new Float32Array(tauMax + 1);
  dp[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    dp[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  // 3) umbral absoluto: primer tau (>=tauMin) bajo el umbral que sea mínimo local
  let tauEst = -1;
  for (let tau = Math.max(tauMin, 1); tau <= tauMax; tau++) {
    if (dp[tau] < threshold) {
      while (tau + 1 <= tauMax && dp[tau + 1] < dp[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  // si ninguno cruza el umbral, tomamos el mínimo global (menos fiable)
  if (tauEst < 0) {
    let best = tauMin, bestVal = dp[tauMin];
    for (let tau = tauMin + 1; tau <= tauMax; tau++) if (dp[tau] < bestVal) { bestVal = dp[tau]; best = tau; }
    tauEst = best;
    if (bestVal > 0.5) return null; // demasiado incierto → sin tono
  }
  // 4) interpolación parabólica alrededor de tauEst para afinar el periodo
  let tau = tauEst;
  if (tau > tauMin && tau < tauMax) {
    const s0 = dp[tau - 1], s1 = dp[tau], s2 = dp[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) tau = tau + (s2 - s0) / denom;
  }
  return { tau, clarity: Math.max(0, Math.min(1, 1 - dp[tauEst])) };
}

// Estima f0 en cada frame del buffer (canal 0). Devuelve una traza temporal.
export function detectPitchTrack(buffer: AudioBuffer, opts: PitchOpts = {}): PitchFrame[] {
  const minHz = opts.minHz ?? 70;
  const maxHz = opts.maxHz ?? 1000;
  const hop = opts.hop ?? 256;
  const threshold = opts.threshold ?? 0.15;
  const sr = buffer.sampleRate;
  const x = buffer.getChannelData(0);
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.floor(sr / minHz);
  const W = tauMax; // ventana de integración
  const frameLen = W + tauMax; // muestras necesarias por frame
  const out: PitchFrame[] = [];
  for (let off = 0; off + frameLen < x.length; off += hop) {
    const res = yinFrame(x, off, W, tauMin, tauMax, threshold);
    const time = (off + frameLen / 2) / sr;
    if (res && res.tau > 0) out.push({ time, f0: sr / res.tau, clarity: res.clarity });
    else out.push({ time, f0: 0, clarity: 0 });
  }
  return out;
}

// utilidades de conversión nota↔frecuencia (A4 = 440 Hz, midi 69).
export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
