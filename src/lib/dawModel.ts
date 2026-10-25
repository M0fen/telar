// Modelo PURO de la vista DAW (Fase 1.1): de los `arrange([n, patrón], …)` de cada pista y
// las secciones de la canción a bloques colocados en compases. La verdad es el CÓDIGO de
// cada Source: esto se recalcula en cada cambio y no guarda estado propio.
import { splitArrange, isMutedArm, isSilenceArm, isSilentArm, muteArm, unmuteArm, spliceArm } from '../nodes/stepseqCode';

export type BlockState = 'on' | 'off' | 'empty'; // suena · apagada (.mask(0), conserva patrón) · vacía (silence)

export interface DawBlock {
  arm: number; // índice del brazo en el arrange (-1 = pista sin secciones)
  start: number; // compás de inicio (desde 0)
  bars: number; // compases visibles
  state: BlockState;
  ghost: boolean; // repetición: el arrange dura menos que la canción y vuelve a empezar
  code: string; // patrón del brazo (para el tooltip)
}

export interface DawTrack {
  id: string;
  name: string;
  plain: boolean; // sin arrange: el mismo patrón suena en todos los compases
  bars: number; // compases de SU arrange (0 si es plana)
  seed: number; // brazo con el que se enciende una sección vacía (-1 = no hay patrón para sembrar)
  blocks: DawBlock[];
  mismatch: boolean; // su arrange no dura lo que la línea de tiempo → se desfasa en cada vuelta
  mute: boolean;
  solo: boolean;
  audible: boolean; // false si está en mute o si hay solos y ella no es uno
}

export interface DawSection {
  start: number;
  bars: number;
  label: string;
  scene: number | null; // escena de la canción (null = sección derivada de un arrange)
}

export interface DawModel {
  sections: DawSection[];
  total: number; // compases de la línea de tiempo
  tracks: DawTrack[];
  fromSong: boolean; // secciones tomadas de la canción (si no, del primer arrange)
}

export interface DawSourceLike {
  id: string;
  name?: string;
  code?: string;
  mute?: boolean;
  solo?: boolean;
}
export interface DawStepLike {
  scene: number;
  bars: number;
}

export const DAW_DEFAULT_BARS = 8; // sin canción ni arrange: 8 compases para ver los bucles

// LÍNEA DE REPRODUCCIÓN (Fase 1.2): el ciclo del scheduler dentro de la línea de tiempo (1
// ciclo = 1 compás; la canción y los arrange son cíclicos desde el ciclo 0, el mismo reloj
// que songClock). Devuelve el compás (fraccional) y la sección que suena (-1 sin secciones).
export function playheadAt(now: number, total: number, sections: DawSection[]): { pos: number; section: number } {
  const pos = total > 0 && Number.isFinite(now) ? ((now % total) + total) % total : 0;
  let section = -1;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (pos >= s.start && pos < s.start + s.bars) { section = i; break; }
  }
  return { pos, section };
}

// Brazo con el que se SIEMBRA una sección vacía (`silence`): el primero que suena; si ninguno
// suena, el primero apagado (su patrón sigue en el código). -1 = la pista no tiene patrón.
export function seedArm(arms: { code: string }[]): number {
  const on = arms.findIndex((a) => !isSilentArm(a.code));
  return on >= 0 ? on : arms.findIndex((a) => isMutedArm(a.code));
}

// ENCENDER / APAGAR UN BLOQUE (Fase 1.3): UN solo empalme sobre el brazo `arm` del arrange,
// igual que la tira de secciones del nodo. suena → `.mask(0)` (apagada, conserva su patrón) ·
// apagada → se lo quita (vuelve EXACTO) · vacía → entra con el patrón de `seedArm`. Devuelve
// el código nuevo o null si no se puede (pista sin arrange, brazo que no existe, nada que sembrar).
export function toggleBlockCode(code: string, arm: number): string | null {
  const arms = splitArrange(code);
  if (!arms || !Number.isInteger(arm) || arm < 0 || arm >= arms.length) return null;
  const a = arms[arm];
  if (isSilenceArm(a.code)) {
    const s = seedArm(arms);
    return s < 0 ? null : spliceArm(code, a, unmuteArm(arms[s].code));
  }
  return spliceArm(code, a, isMutedArm(a.code) ? unmuteArm(a.code) : muteArm(a.code));
}

export function buildDawModel(
  sources: DawSourceLike[],
  steps: DawStepLike[],
  sceneName: (scene: number) => string = (n) => `escena ${n}`,
): DawModel {
  const parsed = sources.map((s) => ({ s, arms: splitArrange(s.code ?? '') }));

  // SECCIONES: las de la canción; si no hay canción, las del primer instrumento con arrange.
  let sections: DawSection[] = [];
  let fromSong = false;
  if (steps.length) {
    fromSong = true;
    let acc = 0;
    sections = steps.map((st) => {
      const bars = Math.max(1, st.bars);
      const sec: DawSection = { start: acc, bars, label: sceneName(st.scene), scene: st.scene };
      acc += bars;
      return sec;
    });
  } else {
    const first = parsed.find((p) => p.arms && p.arms.length);
    if (first?.arms) {
      let acc = 0;
      sections = first.arms.map((a, i) => {
        const bars = Math.max(1, a.bars);
        const sec: DawSection = { start: acc, bars, label: `sección ${i + 1}`, scene: null };
        acc += bars;
        return sec;
      });
    }
  }
  const total = sections.reduce((m, s) => Math.max(m, s.start + s.bars), 0) || DAW_DEFAULT_BARS;

  const anySolo = sources.some((s) => !!s.solo);
  const tracks: DawTrack[] = parsed.map(({ s, arms }) => {
    const name = (s.name ?? '').trim() || s.id;
    const mute = !!s.mute;
    const solo = !!s.solo;
    const audible = !mute && (!anySolo || solo);
    if (!arms || !arms.length) {
      return {
        id: s.id, name, plain: true, bars: 0, seed: -1, mismatch: false, mute, solo, audible,
        blocks: [{ arm: -1, start: 0, bars: total, state: 'on', ghost: false, code: (s.code ?? '').trim() }],
      };
    }
    const own = arms.reduce((a, x) => a + Math.max(0, x.bars), 0);
    // El arrange es CÍCLICO: si dura menos que la línea de tiempo vuelve a empezar (los
    // bloques «fantasma» son lo que de verdad suena en esa vuelta); si dura más, se recorta.
    const blocks: DawBlock[] = [];
    let pos = 0;
    for (let lap = 0; pos < total && own > 0 && lap < 256; lap++) {
      for (let i = 0; i < arms.length && pos < total; i++) {
        const a = arms[i];
        const bars = Math.max(0, a.bars);
        if (bars <= 0) continue;
        const state: BlockState = isSilenceArm(a.code) ? 'empty' : isMutedArm(a.code) ? 'off' : 'on';
        blocks.push({ arm: i, start: pos, bars: Math.min(bars, total - pos), state, ghost: lap > 0, code: a.code.trim() });
        pos += bars;
      }
    }
    return { id: s.id, name, plain: false, bars: own, seed: seedArm(arms), blocks, mismatch: sections.length > 0 && Math.abs(own - total) > 1e-9, mute, solo, audible };
  });

  return { sections, total, tracks, fromSong };
}
