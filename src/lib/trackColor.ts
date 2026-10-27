// COLOR POR PISTA (Fase 8.5) — lógica PURA (testeable en Node).
//
// Cada pista (Source) tiene un color: el que elegiste (data.color) o uno automático según lo que
// suena — bombo naranja, caja/clap coral, hats amarillo, percusión ámbar, bajos violeta, sintes
// azul, voces rosa, loops cian, efectos verde. Dos pistas del mismo tipo alternan dos tonos (el
// bombo y el rumble no quedan iguales). El mismo color se usa en el DAW, el grafo, el mezclador y
// los editores, así una pista se reconoce en cualquier vista.
import { categorize, type SampleCat } from './sampleCategory';

export type TrackKind = 'kick' | 'snare' | 'hat' | 'perc' | 'bass' | 'synth' | 'vocal' | 'loop' | 'fx' | 'other';

// paleta para elegir a mano (se leen sobre fondo oscuro)
export const TRACK_COLORS = [
  '#f08a3d', '#e0533a', '#ef6f8f', '#f06aa8', '#d68cf0', '#b48cf0', '#8c8cf0', '#5aa8f0',
  '#4cd6e8', '#3dd6a0', '#9ad46a', '#d4d45a', '#e8d35a', '#d9a35a', '#a6b0ba',
];

const KIND_COLORS: Record<TrackKind, [string, string]> = {
  kick: ['#f08a3d', '#e0533a'],
  snare: ['#ef6f8f', '#f06aa8'],
  hat: ['#e8d35a', '#d4d45a'],
  perc: ['#d9a35a', '#d4d45a'],
  bass: ['#b48cf0', '#8c8cf0'],
  synth: ['#5aa8f0', '#4cd6e8'],
  vocal: ['#f06aa8', '#d68cf0'],
  loop: ['#4cd6e8', '#3dd6a0'],
  fx: ['#9ad46a', '#3dd6a0'],
  other: ['#a6b0ba', '#a6b0ba'],
};

export const KIND_LABEL: Record<TrackKind, string> = {
  kick: 'bombo', snare: 'caja / clap', hat: 'hats', perc: 'percusión', bass: 'bajo', synth: 'sinte',
  vocal: 'voz', loop: 'loop', fx: 'efectos', other: 'otro',
};

const FROM_CAT: Record<SampleCat, TrackKind> = {
  kick: 'kick', snare: 'snare', hat: 'hat', cymbal: 'hat', perc: 'perc', bass: 'bass', inst: 'synth',
  synth: 'synth', vocal: 'vocal', loop: 'loop', fx: 'fx', other: 'other',
};

const WAVES = /^(sine|sin|sawtooth|saw|square|sqr|triangle|tri|supersaw|pulse|z_\w+|fm\w*|gm_\w+|wt_\w+)$/;
const EXTRA_BASS = /\b(rumble|sub|low|bajo|bass)\b/i;

export const isHexColor = (x: unknown): x is string => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);

// el primer sonido del código: s("bd …"), .s("sawtooth"), sound("…")
function mainSound(code: string): string {
  const m = /(?:^|[^\w])(?:s|sound)\(\s*["'`]([^"'`]*)["'`]/.exec(code);
  if (!m) return '';
  const tok = m[1].replace(/[[\]<>{}()]/g, ' ').split(/\s+/).find((t) => t && t !== '~' && t !== '-');
  return (tok ?? '').replace(/[*!@?].*$/, '').replace(/:.*$/, '');
}
// notas graves (octava 0–2) en note("…") → es un bajo
function lowNotes(code: string): boolean {
  const m = /note\(\s*["'`]([^"'`]*)["'`]/.exec(code);
  if (!m) return false;
  const oct = [...m[1].matchAll(/[a-g][#bs]?(-?\d)/gi)].map((x) => Number(x[1]));
  return oct.length > 0 && oct.filter((o) => o <= 2).length >= oct.length / 2;
}

// QUÉ ES una pista: por su nombre; si no dice, por lo que suena en su código
export function trackKind(name: string | undefined, code: string | undefined): TrackKind {
  const nm = (name ?? '').trim();
  const c = code ?? '';
  if (nm) {
    if (EXTRA_BASS.test(nm)) return 'bass';
    const k = FROM_CAT[categorize(nm)];
    if (k !== 'other') return k;
  }
  const snd = mainSound(c);
  if (/^wl_/.test(snd)) return 'loop'; // loop de Splice estirado al tempo (5.2)
  if (snd && WAVES.test(snd)) return lowNotes(c) ? 'bass' : 'synth';
  if (snd) {
    const k = FROM_CAT[categorize(snd)];
    if (k !== 'other') return k;
  }
  if (/\b(note|n)\(/.test(c)) return lowNotes(c) ? 'bass' : 'synth';
  return 'other';
}

// COLORES DE TODAS LAS PISTAS (en orden): el propio si lo tiene; si no, el de su tipo (alternando
// dos tonos entre pistas del mismo tipo); las «otras» recorren la paleta.
export function trackColors(tracks: { id: string; name?: string; code?: string; color?: unknown }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const seen: Partial<Record<TrackKind, number>> = {};
  let other = 0;
  for (const t of tracks) {
    if (isHexColor(t.color)) { out[t.id] = t.color.toLowerCase(); continue; }
    const k = trackKind(t.name, t.code);
    if (k === 'other') { out[t.id] = TRACK_COLORS[(7 + other++ * 4) % TRACK_COLORS.length]; continue; }
    const n = seen[k] ?? 0;
    seen[k] = n + 1;
    out[t.id] = KIND_COLORS[k][n % 2];
  }
  return out;
}
