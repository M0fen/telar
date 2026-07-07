// Helpers PUROS del estudio de voz (sin React, sin @strudel/web) — extraídos de
// VoiceStudio.tsx para poder testearlos en Node (patrón de tests Fase 01).

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// B2 — listas para el selector de autotune (deben coincidir con AUTOTUNE_ROOTS/SCALES de
// src/audio/autotune.ts). Locales para NO importar autotune.ts estáticamente (mantiene
// el WASM de Rubber Band en carga perezosa).
export const AT_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const AT_SCALE_NAMES = ['cromática', 'mayor', 'menor', 'menor arm', 'menor pent', 'mayor pent', 'dórica', 'frigia'];

// --- notas <-> midi (notación con bemoles, como el placeholder y Strudel) ------
export const PC_FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
export const ACCIDENTAL = new Set([1, 3, 6, 8, 10]); // teclas negras
const NAME_TO_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function midiToName(m: number): string {
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  return PC_FLAT[pc] + oct;
}

export function noteToMidi(tok: string): number | null {
  const m = /^([a-gA-G])([#sb]?)(-?\d+)?$/.exec(tok.trim());
  if (!m) return null;
  let semi = NAME_TO_SEMI[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === 's') semi += 1;
  else if (m[2] === 'b') semi -= 1;
  const oct = m[3] != null ? parseInt(m[3], 10) : 4;
  return semi + (oct + 1) * 12;
}

// intervalos (semitonos) de cada escala del autotune — raíz C
export const SCALE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};

export function scaleName(scale: string): string {
  const i = scale.indexOf(':');
  return (i >= 0 ? scale.slice(i + 1) : scale).trim();
}

// pitch natural de un sample sin metadatos = midi 36 ("c2") → transpose 0 en
// superdough. El piano roll se ancla ahí para que la voz suene (no octavas arriba).
export const NATURAL_MIDI = 36;

// Convierte un token de la melodía del sampler a NOMBRE de nota para reproducirla: en modo
// escala el token es un GRADO (0,2,4…) → nota de ese grado (raíz en c2, igual que el piano
// roll y el compilador); en cromático el token YA es una nota. '~'/inválido → null (silencio).
export function melodyTokenToNote(token: string, scale: string): string | null {
  const t = (token ?? '').trim();
  if (!t || t === '~') return null;
  if (scale.trim()) {
    const st = SCALE_STEPS[scaleName(scale)] ?? SCALE_STEPS.minor;
    const d = parseInt(t, 10);
    if (!isFinite(d)) return null;
    const len = st.length;
    const semi = st[((d % len) + len) % len] + 12 * Math.floor(d / len);
    return midiToName(NATURAL_MIDI + semi);
  }
  return t;
}

// picos (máximos por bloque) del canal 0 de un buffer, para dibujar la onda. HILO B / B4.
export function peaksOf(buf: AudioBuffer, N = 160): number[] {
  const dch = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(dch.length / N));
  const p: number[] = [];
  for (let i = 0; i < N; i++) {
    let mx = 0;
    for (let j = 0; j < step; j++) { const a = Math.abs(dch[i * step + j] || 0); if (a > mx) mx = a; }
    p.push(mx);
  }
  return p;
}

// extrae la región [b,e] (fracciones 0..1) de un AudioBuffer como buffer nuevo, para
// warpear solo lo recortado (más rápido y coincide con lo que se oye). HILO B / B1.
export function sliceBuffer(buf: AudioBuffer, b: number, e: number): AudioBuffer {
  const n = buf.length;
  const s = Math.max(0, Math.min(n - 1, Math.floor(clamp01(b) * n)));
  const en = Math.max(s + 1, Math.min(n, Math.floor(clamp01(e) * n)));
  const out = new AudioBuffer({ length: en - s, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(s, en));
  return out;
}
