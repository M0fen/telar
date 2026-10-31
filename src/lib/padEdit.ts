// EDITAR UN PAD EN TODA LA PISTA (Fase 9.7) — lógica PURA (testeable en Node).
// Un pad es un sonido de la rejilla; sus efectos y su sample valen en TODAS las secciones de la
// pista (no solo en la que se ve): se edita esa fila en cada brazo del arrange que la tiene.
import { buildSeq, isMutedArm, isSilenceArm, muteArm, parseSeq, splitArrange, spliceArm, unmuteArm, type Lane } from '../nodes/stepseqCode';

// la fila de ese sonido (la primera que aparezca en la pista), o null
export function laneOf(code: string, sound: string): Lane | null {
  const arms = splitArrange(code);
  const pats = arms ? arms.map((a) => (isMutedArm(a.code) ? unmuteArm(a.code) : a.code)) : [code];
  for (const c of pats) {
    if (isSilenceArm(c)) continue;
    const l = parseSeq(c)?.lanes.find((x) => x.sound === sound);
    if (l) return l;
  }
  return null;
}

function editPattern(pat: string, sound: string, fn: (l: Lane) => Lane): string | null {
  const p = parseSeq(pat);
  if (!p || p.complex || !p.lanes.some((l) => l.sound === sound)) return null;
  return buildSeq(p, p.lanes.map((l) => (l.sound === sound ? fn(l) : l)), p.steps);
}

// aplica `fn` a la fila `sound` en todos los patrones de la pista; devuelve el código nuevo (o el
// mismo si ninguna sección la tiene)
export function editLaneEverywhere(code: string, sound: string, fn: (l: Lane) => Lane): string {
  const arms = splitArrange(code);
  if (!arms) return editPattern(code, sound, fn) ?? code;
  let out = code;
  // de atrás hacia adelante: cada empalme no mueve los brazos que faltan
  for (let i = arms.length - 1; i >= 0; i--) {
    const a = arms[i];
    if (isSilenceArm(a.code)) continue;
    const muted = isMutedArm(a.code);
    const next = editPattern(muted ? unmuteArm(a.code) : a.code, sound, fn);
    if (next != null) out = spliceArm(out, a, muted ? muteArm(next) : next);
  }
  return out;
}
