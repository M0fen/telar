// HILO B · B2 — AUTOTUNE REAL (corrección de tono de una toma). NO es el re-disparo
// melódico por rejilla: detecta el tono que cantaste en cada instante (YIN), lo cuantiza
// a la escala elegida y RE-SINTETIZA la voz corregida preservando formantes y tiempo
// (vía Rubber Band). El control "retune speed" va de duro/robótico (T-Pain, snap
// instantáneo) a natural (glide suave hacia la nota).

import { detectPitchTrack, hzToMidi } from './pitchDetect';
import { warpVaryingPitch } from './rubberband';

// escalas (intervalos en semitonos desde la raíz). 'cromática' = todos los semitonos.
export const AUTOTUNE_SCALES: Record<string, number[]> = {
  'cromática': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'mayor': [0, 2, 4, 5, 7, 9, 11],
  'menor': [0, 2, 3, 5, 7, 8, 10],
  'menor arm': [0, 2, 3, 5, 7, 8, 11],
  'menor pent': [0, 3, 5, 7, 10],
  'mayor pent': [0, 2, 4, 7, 9],
  'dórica': [0, 2, 3, 5, 7, 9, 10],
  'frigia': [0, 1, 3, 5, 7, 8, 10],
};
export const AUTOTUNE_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface AutotuneOpts {
  scale?: string; // clave de AUTOTUNE_SCALES (por defecto 'cromática')
  root?: number; // 0..11 (C..B)
  retuneSpeed?: number; // 0 = duro/instantáneo (T-Pain) · 1 = natural/lento (~250ms)
  strength?: number; // 0..1 cuánta corrección se mezcla (1 = total)
  formant?: boolean; // preservar formantes (voz natural). Por defecto true.
}

// nota MIDI más cercana permitida por la escala (a partir de un midi continuo).
function snapMidiToScale(midi: number, root: number, intervals: number[]): number {
  const set = intervals.map((i) => (((root + i) % 12) + 12) % 12);
  const c = Math.round(midi);
  let best = c, bestDist = Infinity;
  for (let cand = c - 2; cand <= c + 2; cand++) {
    const pc = ((cand % 12) + 12) % 12;
    if (set.includes(pc)) { const d = Math.abs(cand - midi); if (d < bestDist) { bestDist = d; best = cand; } }
  }
  return best;
}

// Corrige el tono de `buffer` hacia la escala. Devuelve un AudioBuffer nuevo (misma
// duración). Ante cualquier fallo del motor, warpVaryingPitch devuelve el original.
export async function autotuneBuffer(buffer: AudioBuffer, opts: AutotuneOpts = {}): Promise<AudioBuffer> {
  const scale = opts.scale ?? 'cromática';
  const root = opts.root ?? 0;
  const retuneSpeed = Math.max(0, Math.min(1, opts.retuneSpeed ?? 0));
  const strength = Math.max(0, Math.min(1, opts.strength ?? 1));
  const intervals = AUTOTUNE_SCALES[scale] ?? AUTOTUNE_SCALES['cromática'];
  const hop = 256;
  const sr = buffer.sampleRate;
  const track = detectPitchTrack(buffer, { hop });
  if (!track.length) return buffer;

  // suavizado del retune: outMidi persigue a la nota destino a una velocidad ~ retuneSpeed.
  // speed=0 → alpha=1 (snap duro); speed alto → tau grande (glide natural).
  const hopTime = hop / sr;
  const tau = retuneSpeed * 0.25; // 0..250 ms
  const alpha = tau > 0.001 ? 1 - Math.exp(-hopTime / tau) : 1;

  const ratios = new Float32Array(track.length);
  let outMidi: number | null = null;
  for (let i = 0; i < track.length; i++) {
    const f0 = track[i].f0;
    if (f0 <= 0 || track[i].clarity < 0.5) { ratios[i] = 1; outMidi = null; continue; } // sin tono → sin corrección
    const detMidi = hzToMidi(f0);
    const tgtMidi = snapMidiToScale(detMidi, root, intervals);
    if (outMidi == null) outMidi = detMidi; // arranca desde el tono real (evita saltos)
    outMidi = outMidi + (tgtMidi - outMidi) * alpha;
    const finalMidi = detMidi + (outMidi - detMidi) * strength;
    ratios[i] = Math.pow(2, (finalMidi - detMidi) / 12);
  }
  return warpVaryingPitch(buffer, ratios, hop, { formant: opts.formant ?? true });
}
