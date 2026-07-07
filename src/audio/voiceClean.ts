// HILO B · B5 (versión DSP) — LIMPIEZA de voz: NOISE GATE (silencia el fondo/hiss entre
// frases) + DE-ESSER espectral (suaviza las "eses"/sibilancia). Offline y puro (Float32Array)
// → testeable en Node. Es la limpieza que agradecen las voces de dancehall/rap/trap.
//
// El de-esser es ESPECTRAL (STFT + FFT): la resta de una banda filtrada no sirve por el
// desfase del filtro. La versión por ML (DeepFilterNet/Demucs, WebGPU) queda como upgrade futuro.

import { fft, ifft } from './fft';

export interface CleanOpts {
  gate?: number; // 0..1 cantidad de noise gate (más = umbral más alto = corta más fondo)
  deEss?: number; // 0..1 cantidad de de-esser (más = atenúa más las eses/sibilancia)
}

// NOISE GATE: silencia cuando la señal cae bajo un umbral relativo al pico. Ataque
// rápido (no come el arranque de las sílabas) y release suave (no cortes bruscos).
function gateChannel(x: Float32Array, fs: number, amount: number): Float32Array {
  if (amount <= 0.001) return x;
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  if (peak <= 0) return x;
  const thresh = peak * (0.015 + amount * 0.12);
  const envC = Math.exp(-1 / (fs * 0.005)); // seguidor de envolvente ~5 ms
  const attG = Math.exp(-1 / (fs * 0.005)); // abre en ~5 ms
  const relG = Math.exp(-1 / (fs * 0.08)); // cierra en ~80 ms
  const out = new Float32Array(x.length);
  let env = 0, gain = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = env * envC + a * (1 - envC);
    const target = env > thresh ? 1 : 0;
    const c = target > gain ? attG : relG;
    gain = target + (gain - target) * c;
    out[i] = x[i] * gain;
  }
  return out;
}

// DE-ESSER espectral (STFT, Hann 75% solape). En cada frame mide la fracción de energía en
// la banda SIBILANTE (~4.5–9.5 kHz, donde viven las "s"/"sh"); si esa banda DOMINA (es una
// ese), atenúa esos bins. Dinámico: no toca vocales ni el cuerpo de la voz, solo las eses.
// amount 0..1 = cuánto suaviza. Reconstruye por overlap-add normalizado (win²).
function deEssChannel(x: Float32Array, fs: number, amount: number): Float32Array {
  if (amount <= 0.001 || x.length < 2048) return x;
  const N = 1024, hop = N >> 2; // 75% de solape
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); // Hann
  const binHz = fs / N;
  const loBin = Math.max(1, Math.floor(4500 / binHz));
  const hiBin = Math.min(N >> 1, Math.ceil(9500 / binHz));
  const maxAtten = 0.2 + amount * 0.65; // atenuación máxima de la banda cuando hay ese fuerte
  const out = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let start = 0; start + N <= x.length; start += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let eSib = 0, eTot = 1e-9;
    for (let k = 1; k < N >> 1; k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      eTot += m;
      if (k >= loBin && k <= hiBin) eSib += m;
    }
    const ratio = eSib / eTot; // fracción sibilante (vocal ~0.05-0.15; ese > 0.3)
    const excess = Math.max(0, ratio - 0.2);
    const g = 1 - Math.min(maxAtten, excess * 3 * amount);
    if (g < 0.999) {
      for (let k = loBin; k <= hiBin; k++) { re[k] *= g; im[k] *= g; re[N - k] *= g; im[N - k] *= g; }
    }
    ifft(re, im);
    for (let i = 0; i < N; i++) { const idx = start + i; out[idx] += re[i] * win[i]; norm[idx] += win[i] * win[i]; }
  }
  // overlap-add normalizado; donde no hubo cobertura (bordes), deja el original.
  for (let i = 0; i < x.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : x[i];
  return out;
}

// Limpia la voz (noise gate + de-esser) sobre cada canal. Devuelve un AudioBuffer nuevo.
export function cleanVoice(buffer: AudioBuffer, opts: CleanOpts = {}): AudioBuffer {
  const gate = Math.max(0, Math.min(1, opts.gate ?? 0));
  const deEss = Math.max(0, Math.min(1, opts.deEss ?? 0));
  const sr = buffer.sampleRate;
  const out = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    let ch = gateChannel(buffer.getChannelData(c), sr, gate);
    if (deEss > 0.001) ch = deEssChannel(ch, sr, deEss);
    out.getChannelData(c).set(ch);
  }
  return out;
}

// Exportada para tests (procesado espectral puro, sin AudioBuffer).
export { deEssChannel as _deEssChannel };
