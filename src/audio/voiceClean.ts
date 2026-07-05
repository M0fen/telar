// HILO B · B5 (versión DSP, paso 1) — NOISE GATE de voz: silencia el ruido de fondo /
// hiss entre frases sin tocar la voz. Offline y puro (solo Float32Array) → testeable en
// Node. Es la limpieza básica que agradecen las voces de dancehall/rap.
//
// NOTA: el DE-ESSER (suavizar eses) se hará aparte con procesado espectral (FFT): la
// resta de una banda filtrada no funciona por el desfase del filtro. La versión por ML
// (DeepFilterNet/Demucs, WebGPU) queda como upgrade futuro.

export interface CleanOpts {
  gate?: number; // 0..1 cantidad de noise gate (más = umbral más alto = corta más fondo)
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

// Limpia la voz (por ahora: noise gate) sobre cada canal. Devuelve un AudioBuffer nuevo.
export function cleanVoice(buffer: AudioBuffer, opts: CleanOpts = {}): AudioBuffer {
  const gate = Math.max(0, Math.min(1, opts.gate ?? 0));
  const sr = buffer.sampleRate;
  const out = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(gateChannel(buffer.getChannelData(c), sr, gate));
  }
  return out;
}
