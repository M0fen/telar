// FILLS Y VARIACIONES (Fase 7.3) — lógica PURA (testeable en Node).
//
// «Variación cada N compases»: dentro de un bloque (una sección de una pista, o el patrón entero si
// no va por secciones), el ÚLTIMO compás de cada N toca otro patrón — el fill de caja antes del
// drop, el hat que se abre, el corte del bombo. Se escribe en Strudel como sufijo del patrón:
//   BASE.lastOf(N, () => FILL)                                           (el compás entero)
//   BASE.lastOf(N, (x) => stack(x.mask("1 0"), (FILL).mask("0 1")))      (solo su segunda mitad)
// `lastOf` cuenta los compases desde el principio de la sección (arrange reinicia el reloj de cada
// brazo), así el fill cae al final de cada frase de N. Sigue siendo UN brazo por sección: el DAW y
// la canción no cambian; el secuenciador edita la base y el fill en dos pestañas.

import { parseSeq, buildSeq } from '../nodes/stepseqCode';

export interface Variation {
  base: string;
  fill: string;
  every: number; // cada cuántos compases (el último de cada N es el fill)
  half: boolean; // solo la segunda mitad del compás
}
export const VARIATION_EVERY = [2, 4, 8, 16];
export type FillKind = 'copy' | 'cut' | 'roll';

// recorre el código saltándose strings y comentarios; devuelve el índice del cierre que empareja
// con la apertura en `open` (o −1)
function matchParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return c === ')' ? i : -1;
    }
  }
  return -1;
}

const HALF_RE = /^\(x\)\s*=>\s*stack\(\s*x\.mask\(\s*"1 0"\s*\)\s*,\s*\(([\s\S]*)\)\.mask\(\s*"0 1"\s*\)\s*\)$/;
const FULL_RE = /^\(\)\s*=>\s*([\s\S]+)$/;

// separa la variación del final del código; null si no hay (o no es de la forma canónica)
export function splitVariation(code: string): Variation | null {
  const t = code.trimEnd();
  if (!t.endsWith(')')) return null;
  // la ÚLTIMA llamada `.lastOf(` cuyo paréntesis cierra justo al final
  for (let k = t.lastIndexOf('.lastOf('); k > 0; k = t.lastIndexOf('.lastOf(', k - 1)) {
    const open = k + '.lastOf'.length;
    if (matchParen(t, open) !== t.length - 1) continue;
    const inner = t.slice(open + 1, t.length - 1);
    const m = /^\s*(\d+)\s*,\s*([\s\S]+)$/.exec(inner);
    if (!m) return null;
    const every = Number(m[1]);
    const fn = m[2].trim();
    const base = t.slice(0, k);
    if (!base.trim() || !(every >= 2 && every <= 64)) return null;
    const h = HALF_RE.exec(fn);
    if (h) return { base, fill: h[1].trim(), every, half: true };
    const f = FULL_RE.exec(fn);
    if (f) return { base, fill: f[1].trim(), every, half: false };
    return null;
  }
  return null;
}

export function joinVariation(v: Variation): string {
  const fill = v.fill.trim() || 'silence';
  return v.half
    ? `${v.base}.lastOf(${v.every}, (x) => stack(x.mask("1 0"), (${fill}).mask("0 1")))`
    : `${v.base}.lastOf(${v.every}, () => ${fill})`;
}

// el fill de partida: una copia para editar, un corte (silencio) o un roll (cada golpe ×2). El
// roll de una rejilla se escribe en la rejilla (golpe*2: se sigue editando paso a paso); si el
// patrón no cabe en una rejilla, `.ply(2)`.
export function fillFor(base: string, kind: FillKind): string {
  if (kind === 'cut') return 'silence';
  if (kind === 'roll') {
    const p = parseSeq(base);
    if (p && !p.complex && p.lanes.length) {
      const lanes = p.lanes.map((l) => ({ ...l, ratchet: l.ratchet.map((r, i) => (l.steps[i] > 0 ? Math.max(2, r) : r)) }));
      return buildSeq(p, lanes, p.steps);
    }
    return `(${base}).ply(2)`;
  }
  return base;
}

// pone (o cambia) la variación de un patrón; con `every` 0 la quita (queda la base). Si ya tenía,
// conserva su fill y cambia cada cuánto / cuánto dura.
export function setVariation(code: string, every: number, kind: FillKind = 'copy', half = false): string {
  const cur = splitVariation(code);
  const base = cur ? cur.base : code;
  if (!every) return base;
  return joinVariation({ base, fill: cur ? cur.fill : fillFor(base, kind), every, half });
}
