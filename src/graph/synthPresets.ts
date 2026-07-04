import type { SynthParams } from './types';
import { DEFAULT_SYNTH } from './types';

// Presets de timbre del synth nativo, CURADOS POR GÉNERO. Cada uno es un conjunto de
// parámetros que se aplica sobre DEFAULT_SYNTH (timbre completo) y enciende el synth.
// Muchos traen un MACRO de un mando: un solo knob que morfea varios parámetros entre
// su valor base (macro=0) y un objetivo (macro=1) — la forma pro de "abrir" un sonido
// en vivo sin tocar 6 sliders.

// Un macro: etiqueta del mando + valores objetivo (al 100%) de los parámetros que barre.
export interface SynthMacro {
  label: string; // nombre del mando (ej. "empuje", "brillo", "aire")
  targets: Partial<SynthParams>; // valores numéricos al 100% del mando
}

export interface SynthPreset {
  name: string;
  genre: string; // categoría para agrupar en la UI
  params: Partial<SynthParams>;
  macro?: SynthMacro;
}

// Orden de los géneros en la UI (los presets se agrupan por este campo).
export const PRESET_GENRES = [
  'techno / EBM',
  'house / disco',
  'dnb / dubstep',
  'trance',
  'synthwave / retro',
  'urbano',
  'pads / cine',
] as const;

export const SYNTH_PRESETS: SynthPreset[] = [
  // ---------------------------------------------------------------- techno / EBM
  { name: 'acid 303', genre: 'techno / EBM', params: { wave: 'sawtooth', cutoff: 500, lpq: 16, ftype: 1, lpenv: 2.6, lpa: 0.01, lpd: 0.18, attack: 0.001, decay: 0.2, sustain: 0, release: 0.05, drive: 0.25 },
    macro: { label: 'empuje', targets: { cutoff: 1400, lpq: 26, lpenv: 4.6, drive: 0.7 } } },
  { name: 'reese bass', genre: 'techno / EBM', params: { wave: 'supersaw', spread: 0.7, detune: 0.2, cutoff: 600, lpq: 5, attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.25, drive: 0.3 },
    macro: { label: 'movimiento', targets: { spread: 1, detune: 0.4, cutoff: 340 } } },
  { name: 'fm growl', genre: 'techno / EBM', params: { wave: 'sawtooth', fm: 4, fmh: 1, cutoff: 1100, lpq: 4, attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2, drive: 0.4 },
    macro: { label: 'FM', targets: { fm: 7.5, drive: 0.7 } } },
  { name: 'hoover', genre: 'techno / EBM', params: { wave: 'supersaw', spread: 0.85, cutoff: 1800, lpq: 3, lpenv: 1.4, lpa: 0.06, vib: 5, vibmod: 0.35, attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.3, drive: 0.2 },
    macro: { label: 'grito', targets: { vibmod: 0.9, cutoff: 3400, drive: 0.5 } } },
  { name: 'pluck', genre: 'techno / EBM', params: { wave: 'triangle', attack: 0.001, decay: 0.16, sustain: 0, release: 0.1, cutoff: 3200, lpq: 6, lpenv: 1.3, lpa: 0.005, lpd: 0.1 },
    macro: { label: 'brillo', targets: { cutoff: 6000, lpenv: 2.6 } } },
  { name: 'stab', genre: 'techno / EBM', params: { wave: 'square', attack: 0.004, decay: 0.15, sustain: 0, release: 0.1, cutoff: 1700, lpq: 7, drive: 0.3 } },
  { name: 'sub', genre: 'techno / EBM', params: { wave: 'sine', attack: 0.01, decay: 0.1, sustain: 0.95, release: 0.08, cutoff: 0, drive: 0.1 } },
  { name: 'dark stab', genre: 'techno / EBM', params: { wave: 'sawtooth', attack: 0.003, decay: 0.22, sustain: 0, release: 0.14, cutoff: 900, lpq: 8, lpenv: 1.4, lpa: 0.004, drive: 0.25, hcutoff: 120 } },
  { name: 'lo-fi', genre: 'techno / EBM', params: { wave: 'sawtooth', coarse: 6, noise: 0.12, cutoff: 1500, lpq: 3, attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.2, drive: 0.3 },
    macro: { label: 'crudo', targets: { coarse: 14, noise: 0.3, drive: 0.5 } } },
  { name: 'metallic', genre: 'techno / EBM', params: { wave: 'square', fm: 2.6, fmh: 5.5, cutoff: 2600, lpq: 6, attack: 0.002, decay: 0.3, sustain: 0.2, release: 0.2, drive: 0.2 } },
  { name: 'noise hit', genre: 'techno / EBM', params: { wave: 'sine', noise: 0.8, attack: 0.001, decay: 0.12, sustain: 0, release: 0.08, cutoff: 4000, lpenv: 1.0, lpa: 0.003 } },

  // ---------------------------------------------------------------- house / disco
  { name: 'house organ', genre: 'house / disco', params: { wave: 'square', pw: 0.35, attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.12, cutoff: 2200, lpq: 2, drive: 0.12 },
    macro: { label: 'órgano', targets: { pw: 0.15, cutoff: 3600, drive: 0.25 } } },
  { name: 'disco pluck', genre: 'house / disco', params: { wave: 'sawtooth', attack: 0.002, decay: 0.2, sustain: 0.15, release: 0.14, cutoff: 3000, lpq: 5, lpenv: 1.4, lpa: 0.004, lpd: 0.14, delay: 0.15, delayfb: 0.3 } },
  { name: 'filter bass', genre: 'house / disco', params: { wave: 'sawtooth', attack: 0.004, decay: 0.18, sustain: 0.7, release: 0.14, cutoff: 700, lpq: 6, lpenv: 1.6, lpa: 0.01, lpd: 0.16, drive: 0.2 },
    macro: { label: 'funk', targets: { cutoff: 1900, lpq: 10, lpenv: 2.4 } } },
  { name: 'piano stab', genre: 'house / disco', params: { wave: 'triangle', fm: 1.4, fmh: 2, attack: 0.002, decay: 0.28, sustain: 0.1, release: 0.2, cutoff: 3200, lpenv: 0.6, lpa: 0.004, room: 0.2, roomsize: 2 } },

  // ---------------------------------------------------------------- dnb / dubstep
  { name: 'neuro reese', genre: 'dnb / dubstep', params: { wave: 'supersaw', spread: 0.8, detune: 0.24, fm: 1.5, fmh: 1, cutoff: 900, lpq: 6, lpenv: 1.2, lpa: 0.02, attack: 0.005, decay: 0.25, sustain: 0.8, release: 0.2, drive: 0.4, coarse: 2 },
    macro: { label: 'neuro', targets: { fm: 4, cutoff: 2400, drive: 0.75, coarse: 4 } } },
  { name: 'wobble bass', genre: 'dnb / dubstep', params: { wave: 'sawtooth', cutoff: 700, lpq: 7, lpenv: 1.2, attack: 0.006, decay: 0.2, sustain: 0.85, release: 0.16, vib: 4, vibmod: 0.15, drive: 0.35 },
    macro: { label: 'wobble', targets: { vib: 9, cutoff: 2000, drive: 0.6 } } },
  { name: 'sub drop', genre: 'dnb / dubstep', params: { wave: 'sine', penv: -18, pdecay: 0.16, attack: 0.002, decay: 0.2, sustain: 0.9, release: 0.14, cutoff: 0, drive: 0.15 } },
  { name: 'reese growl', genre: 'dnb / dubstep', params: { wave: 'supersaw', spread: 0.9, detune: 0.3, cutoff: 800, lpq: 5, attack: 0.008, decay: 0.2, sustain: 0.85, release: 0.2, drive: 0.5, coarse: 3 } },

  // ---------------------------------------------------------------- trance
  { name: 'supersaw lead', genre: 'trance', params: { wave: 'supersaw', unison: 7, detune: 0.18, spread: 0.7, attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.4, cutoff: 2600, lpq: 2, lpenv: 1.0, lpa: 0.05, room: 0.25, roomsize: 3, delay: 0.2, delayfb: 0.35 },
    macro: { label: 'épico', targets: { detune: 0.32, cutoff: 4500, spread: 1, room: 0.45 } } },
  { name: 'trance pluck', genre: 'trance', params: { wave: 'supersaw', unison: 5, detune: 0.14, spread: 0.6, attack: 0.001, decay: 0.18, sustain: 0, release: 0.16, cutoff: 3400, lpq: 4, lpenv: 1.6, lpa: 0.003, lpd: 0.14, delay: 0.22, delayfb: 0.4, room: 0.2 },
    macro: { label: 'aire', targets: { cutoff: 5200, delay: 0.35, room: 0.4 } } },
  { name: 'rolling bass', genre: 'trance', params: { wave: 'sawtooth', attack: 0.004, decay: 0.16, sustain: 0.5, release: 0.1, cutoff: 900, lpq: 4, lpenv: 0.8, lpa: 0.006, drive: 0.2, hcutoff: 90 } },
  { name: 'trance stab', genre: 'trance', params: { wave: 'supersaw', unison: 6, detune: 0.2, spread: 0.8, attack: 0.004, decay: 0.2, sustain: 0, release: 0.18, cutoff: 2200, lpq: 6, drive: 0.2, room: 0.3, roomsize: 3 } },

  // ---------------------------------------------------------------- synthwave / retro
  { name: 'retro lead', genre: 'synthwave / retro', params: { wave: 'square', pw: 0.4, attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3, cutoff: 2800, lpq: 3, vib: 5, vibmod: 0.12, delay: 0.25, delayfb: 0.4, room: 0.25 },
    macro: { label: 'brillo', targets: { pw: 0.2, cutoff: 4800, drive: 0.3 } } },
  { name: 'pwm bass', genre: 'synthwave / retro', params: { wave: 'square', pw: 0.5, attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.16, cutoff: 900, lpq: 4, lpenv: 0.8, drive: 0.18 },
    macro: { label: 'PWM', targets: { pw: 0.2, cutoff: 1700 } } },
  { name: 'brass stab', genre: 'synthwave / retro', params: { wave: 'sawtooth', attack: 0.03, decay: 0.25, sustain: 0.6, release: 0.25, cutoff: 2000, lpq: 3, lpenv: 1.0, lpa: 0.04, drive: 0.2, room: 0.2 } },
  { name: 'arp pluck', genre: 'synthwave / retro', params: { wave: 'triangle', attack: 0.001, decay: 0.14, sustain: 0, release: 0.12, cutoff: 3600, lpq: 4, lpenv: 1.2, lpa: 0.003, delay: 0.3, delayfb: 0.45, room: 0.2 } },

  // ---------------------------------------------------------------- urbano (phonk / dancehall / reggaetón)
  { name: '808 sub', genre: 'urbano', params: { wave: 'sine', attack: 0.005, decay: 0.1, sustain: 0.92, release: 0.18, cutoff: 0, drive: 0.12 } },
  { name: '808 dist', genre: 'urbano', params: { wave: 'sawtooth', cutoff: 700, lpq: 4, attack: 0.005, decay: 0.2, sustain: 0.85, release: 0.2, drive: 0.6, coarse: 2 },
    macro: { label: 'distorsión', targets: { drive: 1, coarse: 5, cutoff: 1000 } } },
  { name: 'reggaeton bass', genre: 'urbano', params: { wave: 'triangle', attack: 0.005, decay: 0.14, sustain: 0.85, release: 0.12, cutoff: 520, lpq: 3, drive: 0.18 } },
  { name: 'dembow stab', genre: 'urbano', params: { wave: 'square', attack: 0.004, decay: 0.18, sustain: 0, release: 0.12, cutoff: 1600, lpq: 7, lpenv: 1.2, lpa: 0.005, lpd: 0.1, drive: 0.2 } },
  { name: 'trap bell', genre: 'urbano', params: { wave: 'sine', fm: 3, fmh: 2, attack: 0.001, decay: 0.5, sustain: 0, release: 0.45, drive: 0.1 },
    macro: { label: 'metal', targets: { fm: 6, fmh: 3.5 } } },
  { name: 'phonk lead', genre: 'urbano', params: { wave: 'supersaw', spread: 0.6, cutoff: 1400, lpq: 4, lpenv: 1.0, lpa: 0.02, attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3, drive: 0.3 } },

  // ---------------------------------------------------------------- pads / cine
  { name: 'warm pad', genre: 'pads / cine', params: { wave: 'supersaw', unison: 5, detune: 0.14, spread: 0.6, attack: 0.9, decay: 0.5, sustain: 0.85, release: 2.0, cutoff: 1500, lpq: 2, lpenv: 0.6, lpa: 0.7, room: 0.35, roomsize: 3, phaser: 0.3, phaserdepth: 0.5 },
    macro: { label: 'aire', targets: { cutoff: 3200, room: 0.6, phaser: 0.6 } } },
  { name: 'super pad', genre: 'pads / cine', params: { wave: 'supersaw', unison: 7, detune: 0.22, spread: 0.85, attack: 0.6, decay: 0.5, sustain: 0.9, release: 1.8, cutoff: 2600, lpq: 2, lpenv: 1.2, lpa: 0.5, room: 0.3, roomsize: 3, delay: 0.2, delayfb: 0.35 } },
  { name: 'choir pad', genre: 'pads / cine', params: { wave: 'supersaw', unison: 6, detune: 0.12, spread: 0.7, attack: 1.2, decay: 0.6, sustain: 0.9, release: 2.4, cutoff: 1800, hcutoff: 220, room: 0.5, roomsize: 5, phaser: 0.2, phaserdepth: 0.6 } },
  { name: 'glass pad', genre: 'pads / cine', params: { wave: 'sine', fm: 2, fmh: 3.5, attack: 0.7, decay: 0.6, sustain: 0.8, release: 2.0, room: 0.45, roomsize: 4, delay: 0.25, delayfb: 0.4 } },
  { name: 'ambient wash', genre: 'pads / cine', params: { wave: 'supersaw', unison: 5, detune: 0.16, spread: 0.6, attack: 1.6, decay: 0.8, sustain: 0.8, release: 3.5, cutoff: 900, lpa: 1.0, room: 0.6, roomsize: 8, delay: 0.35, delayfb: 0.5, phaser: 0.15 },
    macro: { label: 'inmenso', targets: { room: 0.75, roomsize: 10, delay: 0.5, cutoff: 1600 } } },
  { name: 'cinematic pad', genre: 'pads / cine', params: { wave: 'supersaw', unison: 5, detune: 0.2, spread: 0.55, attack: 1.0, decay: 0.7, sustain: 0.85, release: 2.5, cutoff: 700, lpq: 3, lpenv: 0.6, lpa: 0.8, hcutoff: 120, room: 0.4, roomsize: 6, drive: 0.12 } },
  { name: 'analog strings', genre: 'pads / cine', params: { wave: 'sawtooth', attack: 0.4, decay: 0.4, sustain: 0.85, release: 1.4, cutoff: 2200, lpq: 2, lpenv: 0.8, lpa: 0.4, phaser: 0.5, phaserdepth: 0.7, room: 0.3, roomsize: 3 } },
  { name: 'soft keys', genre: 'pads / cine', params: { wave: 'triangle', fm: 1.5, fmh: 2, attack: 0.005, decay: 0.9, sustain: 0.25, release: 0.6, cutoff: 2400, lpenv: 0.5, lpa: 0.02, room: 0.25, roomsize: 2, delay: 0.15, delayfb: 0.3 } },
  { name: 'dark pad', genre: 'pads / cine', params: { wave: 'supersaw', spread: 0.5, attack: 0.8, decay: 0.4, sustain: 0.7, release: 1.6, cutoff: 1200, lpq: 2, lpenv: 0.8, lpa: 0.6 } },
];

export function presetByName(name: string | undefined): SynthPreset | undefined {
  if (!name) return undefined;
  return SYNTH_PRESETS.find((p) => p.name === name);
}

// Devuelve el PATCH del macro a la posición v (0..1): interpola cada parámetro objetivo
// entre su valor base (preset.params, o el DEFAULT si el preset no lo fija) y el valor
// al 100%. Solo toca las claves del macro → preserva el resto de ajustes del usuario.
export function macroPatch(preset: SynthPreset, v: number): Partial<SynthParams> {
  const m = preset.macro;
  const clamped = Math.max(0, Math.min(1, v));
  const patch: Partial<SynthParams> = { macro: clamped, macroPreset: preset.name };
  if (!m) return patch;
  const base = { ...DEFAULT_SYNTH, ...preset.params } as Record<string, unknown>;
  const targets = m.targets as Record<string, unknown>;
  for (const key of Object.keys(targets)) {
    const b = base[key];
    const t = targets[key];
    if (typeof b === 'number' && typeof t === 'number') {
      (patch as Record<string, unknown>)[key] = Math.round((b + (t - b) * clamped) * 10000) / 10000;
    }
  }
  return patch;
}
