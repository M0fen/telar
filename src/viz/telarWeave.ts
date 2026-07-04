// Modo "telar": el grafo se ve como un TEJIDO. La urdimbre (warp) son los hilos
// verticales fijos = la estructura; la trama (weft) son hilos HORIZONTALES, uno por
// SOURCE, que vibran con el audio de ese instrumento. Donde urdimbre y trama se
// cruzan hay un nudo que se enciende con el nivel real y destella en cada golpe.
// En silencio el tejido descansa (ondas mínimas). Canvas2D, coste O(hilos·puntos),
// con hilos = nº de sources (pequeño). Paleta fría cian→azul, minimalista.
import { getSourceAnalyser } from '../audio/engine';

const TAU = Math.PI * 2;

interface Weft {
  disp: number; // nivel mostrado (ataque rápido, caída suave)
  slow: number; // media lenta (para detectar golpes)
  flash: number; // destello reciente (nudo brillante en el golpe)
  phase: number; // fase propia de la onda viajera (desfase entre hilos)
  hue: number;
  tbuf?: Uint8Array<ArrayBuffer>;
  tuned: boolean;
}

let wefts: Weft[] = [];
let sig = '';
let lastT = 0;

export function resetTelarWeave(): void {
  wefts = [];
  sig = '';
  lastT = 0;
}

function rebuild(ids: string[]) {
  const n = Math.max(1, ids.length);
  const prev = wefts;
  wefts = ids.map((_, i) => {
    const old = prev[i];
    return (
      old ?? {
        disp: 0,
        slow: 0,
        flash: 0,
        phase: (i / n) * TAU,
        hue: 0,
        tuned: false,
      }
    );
  });
  // recolorea: cian → azul, del hilo de arriba al de abajo
  wefts.forEach((w, i) => (w.hue = 168 + (i / n) * 44));
}

const hsla = (h: number, s: number, l: number, a: number) =>
  `hsla(${h.toFixed(0)},${s}%,${l}%,${a.toFixed(3)})`;

export function renderTelarWeave(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  ids: string[]
): void {
  const dt = Math.min(0.05, Math.max(0.001, t - lastT));
  lastT = t;
  const fr = Math.min(2, Math.max(0.4, dt * 60));

  if (ids.join(',') !== sig) {
    sig = ids.join(',');
    rebuild(ids);
  }

  // estela tenue (persistencia sutil, como hilo que deja rastro al tejerse)
  ctx.fillStyle = 'rgba(6,9,13,0.30)';
  ctx.fillRect(0, 0, W, H);

  const U = Math.min(W, H);
  const nThreads = Math.max(1, wefts.length);
  const marginY = H * 0.12;
  const usableH = H - marginY * 2;
  const spacing = usableH / nThreads;
  const marginX = W * 0.05;
  const usableW = W - marginX * 2;

  // --- audio: nivel + golpe por source (una lectura por hilo de trama) ---
  let energy = 0;
  for (let i = 0; i < wefts.length; i++) {
    const w = wefts[i];
    const an = getSourceAnalyser(ids[i]);
    let level = 0;
    if (an) {
      if (!w.tuned) {
        try {
          an.smoothingTimeConstant = 0.6;
        } catch {
          /* fijo en algunos navegadores */
        }
        w.tuned = true;
      }
      const fft = an.fftSize;
      if (!w.tbuf || w.tbuf.length !== fft) w.tbuf = new Uint8Array(fft);
      an.getByteTimeDomainData(w.tbuf);
      let sq = 0;
      for (let k = 0; k < fft; k++) {
        const v = (w.tbuf[k] - 128) / 128;
        sq += v * v;
      }
      level = Math.min(1, Math.sqrt(sq / fft) * 2.7);
    }
    w.disp = level > w.disp ? level : w.disp * 0.9 + level * 0.1;
    const onset = level - w.slow;
    w.slow = w.slow * 0.85 + level * 0.15;
    if (onset > 0.05 && level > 0.08) w.flash = Math.min(1, w.flash + onset * 2.0);
    w.flash *= Math.pow(0.9, fr);
    // la trama avanza: hilos con más nivel viajan un poco más rápido
    w.phase += (0.5 + w.disp * 1.6) * dt;
    energy += w.disp;
  }
  energy /= nThreads;

  // --- URDIMBRE (warp): hilos verticales fijos, tenues = la estructura ---
  const warpN = Math.max(6, Math.round(usableW / (U * 0.05)));
  const warpXs: number[] = [];
  for (let c = 0; c <= warpN; c++) warpXs.push(marginX + (usableW * c) / warpN);
  ctx.lineWidth = 1;
  for (const x of warpXs) {
    ctx.strokeStyle = hsla(190, 30, 46, 0.05 + energy * 0.04);
    ctx.beginPath();
    ctx.moveTo(x, marginY * 0.7);
    ctx.lineTo(x, H - marginY * 0.7);
    ctx.stroke();
  }

  // --- TRAMA (weft): un hilo horizontal por source, vibra con su audio ---
  const SAMPLES = 72;
  for (let i = 0; i < wefts.length; i++) {
    const w = wefts[i];
    const baseY = marginY + spacing * (i + 0.5);
    const e = Math.min(1, w.disp + w.flash * 0.35);
    // amplitud: reposo mínimo (el tejido nunca está del todo plano) + nivel real
    const amp = spacing * (0.05 + e * 0.42);
    const k1 = 2.2 + (i % 3) * 0.6; // frecuencia espacial (varía por hilo)
    const k2 = 5.3 + (i % 2) * 1.1;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const yAt = (n: number) => {
      const x01 = n / SAMPLES;
      return (
        baseY +
        Math.sin(x01 * TAU * k1 + w.phase) * amp +
        Math.sin(x01 * TAU * k2 - w.phase * 1.3) * amp * 0.35
      );
    };

    // halo del hilo (glow), luego núcleo nítido
    ctx.strokeStyle = hsla(w.hue, 70, 60, 0.06 + e * 0.16);
    ctx.lineWidth = Math.max(2, U * 0.006) + e * U * 0.006;
    ctx.beginPath();
    for (let n = 0; n <= SAMPLES; n++) {
      const x = marginX + (usableW * n) / SAMPLES;
      const y = yAt(n);
      n === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = hsla(w.hue, 82, 72, 0.28 + e * 0.6);
    ctx.lineWidth = Math.max(1, U * 0.0022);
    ctx.beginPath();
    for (let n = 0; n <= SAMPLES; n++) {
      const x = marginX + (usableW * n) / SAMPLES;
      const y = yAt(n);
      n === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // --- NUDOS: cruces urdimbre×trama, brillan con el nivel, destellan al golpe ---
    const kr = (U * 0.004) * (0.6 + e * 1.1);
    for (const x of warpXs) {
      const x01 = (x - marginX) / usableW;
      const y =
        baseY +
        Math.sin(x01 * TAU * k1 + w.phase) * amp +
        Math.sin(x01 * TAU * k2 - w.phase * 1.3) * amp * 0.35;
      const knot = 0.1 + e * 0.5 + w.flash * 0.4;
      ctx.fillStyle = hsla(w.hue, 88, 78, knot);
      ctx.beginPath();
      ctx.arc(x, y, kr, 0, TAU);
      ctx.fill();
    }
  }
}
