import { getAudioCtx } from '../audio/engine';

// Análisis de estructura "más o menos": divide el audio en compases (según el BPM),
// mide la ENERGÍA (RMS) de cada uno → curva de intensidad + puntos de cambio
// (drops/breaks). No etiqueta secciones (eso es MIR pesado); da el mapa de energía,
// que basta para ver la forma de la canción y encaja con arrange.
export interface StructureResult {
  bars: number[]; // intensidad 0..1 por compás
  boundaries: number[]; // índices de compás donde la energía salta (cambio de sección)
  bpm: number | null;
  barSec: number; // duración de cada compás (s)
}

export async function analyzeStructure(url: string, bpm?: number | null): Promise<StructureResult | null> {
  try {
    const ab = await (await fetch(url)).arrayBuffer();
    const buf = await getAudioCtx().decodeAudioData(ab);
    const sr = buf.sampleRate;
    const ch = buf.getChannelData(0);
    const beatsPerBar = 4;
    let barSec = bpm && bpm > 0 ? (60 / bpm) * beatsPerBar : 2;
    let barLen = Math.max(1, Math.floor(barSec * sr));
    // demasiados compases (pista larga) → agrandamos el compás para ~≤300 barras
    let nBars = Math.floor(ch.length / barLen);
    while (nBars > 300) {
      barLen *= 2;
      barSec *= 2;
      nBars = Math.floor(ch.length / barLen);
    }
    if (nBars < 1) return null;
    const rms: number[] = [];
    for (let b = 0; b < nBars; b++) {
      const start = b * barLen;
      const end = Math.min(ch.length, start + barLen);
      let sum = 0;
      let n = 0;
      for (let i = start; i < end; i += 8) { const v = ch[i]; sum += v * v; n++; }
      rms.push(Math.sqrt(sum / Math.max(1, n)));
    }
    const mx = Math.max(...rms, 1e-6);
    const raw = rms.map((v) => v / mx);
    // suavizado (media móvil ±1) para la curva de energía → menos dientes de sierra
    const bars = raw.map((_, i) => {
      const a = raw[i - 1] ?? raw[i], b = raw[i], c = raw[i + 1] ?? raw[i];
      return (a + b + c) / 3;
    });
    // puntos de cambio: en vez de un umbral fijo (ruidoso), usamos uno ADAPTATIVO
    // sobre la novelty (|Δ energía|): media + 1·desviación, con piso 0.14; y exigimos
    // una separación mínima de 2 compases para no marcar rachas contiguas.
    const nov = bars.map((v, i) => (i === 0 ? 0 : Math.abs(v - bars[i - 1])));
    const mean = nov.reduce((s, x) => s + x, 0) / Math.max(1, nov.length);
    const std = Math.sqrt(nov.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, nov.length));
    const thresh = Math.max(0.14, mean + std);
    const boundaries: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      if (nov[i] > thresh && (boundaries.length === 0 || i - boundaries[boundaries.length - 1] >= 2)) {
        boundaries.push(i);
      }
    }
    return { bars, boundaries, bpm: bpm ?? null, barSec };
  } catch {
    return null;
  }
}
