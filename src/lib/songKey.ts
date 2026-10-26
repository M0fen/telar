// TONALIDAD DEL TEMA (Fase 5.1) — lógica PURA (testeable en Node).
//
// La tonalidad es la del tema tal como se escribe (raíz + modo). El «tono» de la barra (±) la
// transpone: lo que SUENA es raíz + tono. La usan los secuenciadores (escala por defecto), el
// autotune de la voz, los nombres de exportación y los loops (5.3: a la tonalidad del tema).
export interface SongKey {
  root: number; // 0–11 (C = 0)
  minor: boolean;
}

// nombres de raíz más comunes en la práctica (Splice, Beatport): sostenidos y bemoles mezclados
export const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const pc = (n: number) => ((Math.round(n) % 12) + 12) % 12;

export const keyShort = (k: SongKey, transpose = 0) => `${ROOT_NAMES[pc(k.root + transpose)]}${k.minor ? 'm' : ''}`;
export const keyLong = (k: SongKey, transpose = 0) => `${ROOT_NAMES[pc(k.root + transpose)]} ${k.minor ? 'menor' : 'mayor'}`;
// escala de Strudel (`.scale("A:minor")`): la tonalidad ESCRITA (el tono global se aplica después)
export const keyScale = (k: SongKey) => `${ROOT_NAMES[pc(k.root)]}:${k.minor ? 'minor' : 'major'}`;

// ¿Es una tonalidad válida? (lo que venga de un archivo de proyecto)
export function cleanKey(k: unknown): SongKey | null {
  const o = k as { root?: unknown; minor?: unknown } | null;
  if (!o || typeof o !== 'object' || typeof o.root !== 'number' || !Number.isFinite(o.root)) return null;
  return { root: pc(o.root), minor: !!o.minor };
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// token de un nombre de archivo → tonalidad. Raíz en MAYÚSCULA (Splice capitaliza: Amin, C#maj,
// Bbminor, F#m, Em); sin sufijo de modo → modo desconocido (null).
export const KEY_TOKEN = /^([A-G])([#b]?)(maj|major|min|minor|m)?$/;
export function parseKeyToken(tok: string): { root: number; minor: boolean | null } | null {
  const m = KEY_TOKEN.exec(tok);
  if (!m) return null;
  const root = pc(LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
  const mode = m[3];
  return { root, minor: mode == null ? null : mode.startsWith('min') || mode === 'm' };
}

// Tonalidad de un nombre de archivo de Splice («PL_126_Amin_top_loop.wav»): el primer token que
// parece tonalidad CON modo; una raíz sola (F, C#) solo cuenta justo después del BPM, como en la
// convención de Splice (ARTISTA_PACK_BPM_TONALIDAD_nombre): una «A» o «B» suelta puede ser otra cosa.
export function keyFromFileName(fileName: string): { root: number; minor: boolean | null } | null {
  const toks = fileName.replace(/\.[^.]+$/, '').split(/[_\-\s]+/).filter(Boolean);
  const isBpm = (t: string) => /^\d{2,3}$/.test(t) && Number(t) >= 60 && Number(t) <= 220;
  for (let i = 0; i < toks.length; i++) {
    const k = parseKeyToken(toks[i]);
    if (k && (k.minor != null || (i > 0 && isBpm(toks[i - 1])))) return k;
  }
  return null;
}

// La tonalidad que traen más archivos (con modo; una raíz sin modo vota por el modo más votado de
// esa raíz, o menor). null = ninguno trae tonalidad.
export function suggestKey(fileNames: string[]): { key: SongKey; votes: number } | null {
  const votes = new Map<string, number>();
  const rootOnly = new Map<number, number>();
  for (const f of fileNames) {
    const k = keyFromFileName(f);
    if (!k) continue;
    if (k.minor == null) rootOnly.set(k.root, (rootOnly.get(k.root) ?? 0) + 1);
    else votes.set(`${k.root}|${k.minor ? 1 : 0}`, (votes.get(`${k.root}|${k.minor ? 1 : 0}`) ?? 0) + 1);
  }
  for (const [root, n] of rootOnly) {
    const minor = (votes.get(`${root}|1`) ?? 0) >= (votes.get(`${root}|0`) ?? 0);
    const id = `${root}|${minor ? 1 : 0}`;
    votes.set(id, (votes.get(id) ?? 0) + n);
  }
  let best: [string, number] | null = null;
  for (const e of votes) if (!best || e[1] > best[1]) best = e;
  if (!best) return null;
  const [root, minor] = best[0].split('|').map(Number);
  return { key: { root, minor: minor === 1 }, votes: best[1] };
}
