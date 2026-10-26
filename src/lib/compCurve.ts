// COMPRESOR POR PISTA (Fase 6.1) — la referencia PURA del procesador (testeable en Node). El
// AudioWorklet (`audio/chanComp.ts`) transcribe esto mismo en el hilo de audio.
//
//   · Detector de pico con las dos pistas juntas (máx |L|,|R|) → dB.
//   · Curva con rodilla suave (6 dB): bajo el umbral no toca nada; encima, divide por el ratio.
//   · Suavizado en el dominio de la ganancia (ataque al bajar, release al recuperar).
//   · Sin lookahead: CERO latencia → la pista no se desfasa de las demás (el compresor nativo
//     del navegador retrasa 6 ms y además sube el volumen por su cuenta).
//   · Makeup explícito, en dB.
export interface CompParams {
  thr: number; // umbral en dBFS (−60…0)
  ratio: number; // 1…20
  att: number; // ataque en ms
  rel: number; // release en ms
  makeup: number; // dB
}
export const COMP_KNEE_DB = 6;

// ganancia (dB, ≤ 0) que pide la curva para una entrada de x dB
export function compGainDb(x: number, thr: number, ratio: number, knee = COMP_KNEE_DB): number {
  const r = Math.max(1, ratio);
  const d = x - thr;
  let y: number;
  if (2 * d < -knee) y = x;
  else if (2 * Math.abs(d) <= knee) y = x + ((1 / r - 1) * (d + knee / 2) ** 2) / (2 * knee);
  else y = thr + d / r;
  return y - x;
}

// coeficiente de un filtro de un polo para un tiempo en ms
export const smoothCoef = (ms: number, sr: number) => Math.exp(-1 / (Math.max(0.01, ms) * 0.001 * sr));

// procesa un bloque estéreo (en el sitio); `state.gs` = reducción suavizada (dB) entre bloques.
// Devuelve la reducción máxima del bloque (dB, ≤ 0) para el medidor.
export function compressBlock(L: Float32Array, R: Float32Array, p: CompParams, sr: number, state: { gs: number }): number {
  const aA = smoothCoef(p.att, sr);
  const aR = smoothCoef(p.rel, sr);
  const mk = p.makeup;
  let gs = state.gs;
  let minGr = 0;
  const kneeLow = Math.pow(10, (p.thr - COMP_KNEE_DB / 2) / 20);
  const mkLin = Math.pow(10, mk / 20);
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    let g: number;
    if (a < kneeLow) {
      // bajo la rodilla la curva no pide nada: solo se recupera (release)
      gs = aR * gs;
      g = gs > -1e-5 ? mkLin : Math.pow(10, (gs + mk) / 20);
    } else {
      const x = 20 * Math.log10(a);
      const gc = compGainDb(x, p.thr, p.ratio);
      gs = gc < gs ? aA * gs + (1 - aA) * gc : aR * gs + (1 - aR) * gc;
      g = Math.pow(10, (gs + mk) / 20);
    }
    if (gs < minGr) minGr = gs;
    L[i] *= g;
    R[i] *= g;
  }
  state.gs = gs;
  return minGr;
}

// ajustes de partida por uso (la UI los ofrece como botones)
export const COMP_PRESETS: { id: string; label: string; title: string; p: CompParams }[] = [
  { id: 'suave', label: 'suave', title: 'controla picos sin que se note (2:1, ataque lento)', p: { thr: -18, ratio: 2, att: 30, rel: 200, makeup: 2 } },
  { id: 'pegada', label: 'pegada', title: 'bombo/caja con más punch: deja pasar el golpe y sube el cuerpo (4:1, 10 ms)', p: { thr: -20, ratio: 4, att: 10, rel: 120, makeup: 4 } },
  { id: 'fijo', label: 'nivel fijo', title: 'bajo o voz parejos todo el tema (6:1, ataque rápido)', p: { thr: -24, ratio: 6, att: 3, rel: 150, makeup: 6 } },
  { id: 'aplastar', label: 'aplastar', title: 'compresión fuerte, de efecto (10:1, 1 ms)', p: { thr: -30, ratio: 10, att: 1, rel: 80, makeup: 10 } },
];
