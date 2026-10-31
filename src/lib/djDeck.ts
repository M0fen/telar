// DECKS DE TEMA (modo DJ, Fase DJ-1) — la cuenta PURA (sin audio; con tests). Un tema completo suena
// en un reproductor nativo que entra en la tira del deck; aquí está todo lo que es número:
//   · la REJILLA del tema (tempo y dónde cae un 1) y sus conversiones segundo ↔ tiempo ↔ compás;
//   · el SYNC: la sesión manda; el tema va a tempo_sesión / tempo_tema y con su fase fija a la de
//     la sesión (`lock` = tiempo del tema − tiempo de la sesión, constante mientras está sincronizado);
//   · la POSICIÓN analítica (segmentos de velocidad constante, con loop), cues, saltos y loops;
//   · claves Camelot (mezcla armónica, DJ-3) y la ganancia automática por loudness.
import type { SongKey } from './songKey';

// REJILLA: `first` = segundo del archivo donde cae un 1 (tiempo 1 de un compás), `bpm` original
export interface Grid { bpm: number; first: number; beats: number }

// lo que el PROYECTO guarda de un deck de tema (el audio está en IndexedDB por su `id`)
export interface DjTrack {
  id: string;
  title: string;
  bpm: number;
  first: number;
  beats: number;
  dur: number;
  key?: SongKey | null;
  lufs?: number | null;
  cue: number; // el CUE (segundos)
  hot: (number | null)[]; // 4 cues rápidos
  sync?: boolean; // false = a su tempo (con `pitch`)
  pitch?: number; // −0,16…0,16 sin sync
  trim?: number; // dB a mano (si no, la ganancia automática por loudness)
}
export const gridOf = (t: { bpm: number; first: number; beats?: number }): Grid => ({ bpm: t.bpm, first: t.first, beats: t.beats || 4 });

export const beatLen = (g: Grid) => 60 / Math.max(1, g.bpm);
export const barLen = (g: Grid) => beatLen(g) * Math.max(1, g.beats);
// tiempo (fraccional) del tema en el segundo `pos` (0 = el 1 de la rejilla; puede ser negativo)
export const beatAt = (g: Grid, pos: number) => (pos - g.first) / beatLen(g);
export const posOfBeat = (g: Grid, b: number) => g.first + b * beatLen(g);

// CUANTIZAR un punto del tema al tiempo (o al compás) más cercano
export function snapPos(g: Grid, pos: number, to: 'beat' | 'bar' | 'none' = 'beat'): number {
  if (to === 'none') return pos;
  const unit = to === 'bar' ? Math.max(1, g.beats) : 1;
  return posOfBeat(g, Math.round(beatAt(g, pos) / unit) * unit);
}

// VELOCIDAD con SYNC: el tema a tempo de la sesión (varispeed: como un vinilo); `nudge` empuja ±
export const syncRate = (sessionBpm: number, g: Grid, nudge = 0) => (Math.max(1, sessionBpm) / Math.max(1, g.bpm)) * (1 + nudge);

// POSICIÓN ANALÍTICA: desde (t0, pos0) a velocidad `rate`, con loop [a, b) si lo hay; se para al final
export interface PlayModel { t0: number; pos0: number; rate: number; loop: { a: number; b: number } | null }
export function posAt(m: PlayModel, t: number, dur: number): number {
  let p = m.pos0 + Math.max(0, t - m.t0) * m.rate;
  const L = m.loop;
  if (L && L.b > L.a && m.pos0 < L.b && p >= L.b) p = L.a + ((p - L.a) % (L.b - L.a));
  return Math.min(Math.max(0, p), dur);
}

// FASE: con el tema sincronizado, su tiempo = tiempo de la sesión + lock. Dónde debería estar:
export const lockedPos = (g: Grid, sessionBeat: number, lock: number) => posOfBeat(g, sessionBeat + lock);
// error de fase en tiempos (−0,5…0,5): cuánto va adelantado el tema respecto de la sesión
export function phaseError(songBeat: number, sessionBeat: number, lock: number): number {
  const d = songBeat - (sessionBeat + lock);
  return d - Math.round(d);
}
// al ENTRAR (▶ en el 1 del compás de la sesión `startBeat`): el lock que deja el tema en su fase
export const lockFor = (songBeat: number, sessionBeat: number) => songBeat - sessionBeat;
// al SINCRONIZAR un tema que ya suena: el lock entero más cercano — corrige la fase al tiempo más
// próximo (menos de medio tiempo), sin saltar compases
export const nearestLock = (songBeat: number, sessionBeat: number) => Math.round(songBeat - sessionBeat);

// LOOP de N compases (o fracción) desde el tiempo donde está el cabezal
export function loopFrom(g: Grid, pos: number, bars: number): { a: number; b: number } {
  const a = posOfBeat(g, Math.floor(beatAt(g, pos) + 1e-6));
  return { a, b: a + bars * barLen(g) };
}
// SALTO de k compases manteniendo la fase (el lock se corre los mismos tiempos)
export const jumpBeats = (g: Grid, bars: number) => bars * Math.max(1, g.beats);

// FORMA DE ONDA POR BANDAS (graves / medios / agudos) de una señal mono, en `buckets` columnas:
// pico por columna y la energía de cada banda (filtros de un polo: graves < ~180 Hz, agudos > ~2,5 kHz)
export interface Bands { pk: Float32Array; lo: Float32Array; mid: Float32Array; hi: Float32Array }
export function bandPeaks(x: Float32Array, sr: number, buckets: number, from = 0, to = x.length): Bands {
  const n = Math.max(1, buckets);
  const pk = new Float32Array(n), lo = new Float32Array(n), mid = new Float32Array(n), hi = new Float32Array(n);
  const len = Math.max(1, to - from);
  const aL = Math.exp((-2 * Math.PI * 180) / sr); // paso-bajo de un polo
  const aH = Math.exp((-2 * Math.PI * 2500) / sr);
  let yl = 0, yh = 0;
  for (let k = 0; k < n; k++) {
    const s0 = from + Math.floor((k * len) / n);
    const s1 = from + Math.floor(((k + 1) * len) / n);
    let p = 0, el = 0, em = 0, eh = 0;
    for (let i = s0; i < s1; i++) {
      const v = x[i] || 0;
      yl = (1 - aL) * v + aL * yl;
      yh = (1 - aH) * v + aH * yh;
      const h = v - yh; // agudos = la señal menos su paso-bajo de 2,5 kHz
      const m = yh - yl;
      const av = v < 0 ? -v : v;
      if (av > p) p = av;
      el += yl * yl; em += m * m; eh += h * h;
    }
    const c = Math.max(1, s1 - s0);
    pk[k] = p; lo[k] = Math.sqrt(el / c); mid[k] = Math.sqrt(em / c); hi[k] = Math.sqrt(eh / c);
  }
  return { pk, lo, mid, hi };
}
// normaliza las bandas a la columna más fuerte (para dibujar)
export function normBands(b: Bands): Bands {
  const top = (a: Float32Array) => a.reduce((m, v) => (v > m ? v : m), 1e-6);
  const s = Math.max(top(b.lo), top(b.mid), top(b.hi));
  const p = top(b.pk);
  const map = (a: Float32Array, k: number) => a.map((v) => Math.min(1, v / k));
  return { pk: map(b.pk, p), lo: map(b.lo, s), mid: map(b.mid, s), hi: map(b.hi, s) };
}

// ENVOLVENTE DE ATAQUES (para la rejilla): energía de graves por ventana de `hop` muestras y su
// subida (flujo positivo) — donde pega el bombo. Señal mono a cualquier frecuencia de muestreo.
export function onsetEnvelope(x: Float32Array, sr: number, hop: number): Float32Array {
  const n = Math.floor(x.length / hop);
  const env = new Float32Array(n);
  const a = Math.exp((-2 * Math.PI * 150) / sr);
  let y = 0, prev = 0;
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = k * hop, end = i + hop; i < end; i++) { y = (1 - a) * x[i] + a * y; e += y * y; }
    const v = Math.sqrt(e / hop);
    env[k] = Math.max(0, v - prev);
    prev = v;
  }
  return env;
}

// AFINAR LA REJILLA sobre TODO el tema: el tempo (±0,4 BPM del estimado, de a 0,01) y la fase que
// más energía de ataques juntan en sus tiempos. Un tempo redondeado (127 en vez de 127,6) se corre
// casi un segundo en 5 minutos; afinado, la rejilla sirve para mezclar el tema entero.
// `env` a `rate` valores por segundo. Devuelve el tempo y el primer tiempo (segundos, ≥ 0).
export function refineGrid(env: Float32Array, rate: number, bpm0: number): { bpm: number; first: number } {
  const n = env.length;
  if (n < 8 || !(bpm0 > 0)) return { bpm: bpm0, first: 0 };
  const val = (pos: number) => { const i = Math.round(pos); return i >= 0 && i < n ? env[i] : 0; };
  let best = { bpm: bpm0, first: 0, score: -1 };
  const tryTempo = (bpm: number, phases: number) => {
    const period = (60 / bpm) * rate; // valores de la envolvente por tiempo
    for (let p = 0; p < phases; p++) {
      const ph = (p / phases) * period;
      let s = 0;
      for (let pos = ph; pos < n; pos += period) s += val(pos) + 0.5 * (val(pos - 1) + val(pos + 1));
      if (s > best.score) best = { bpm, first: ph / rate, score: s };
    }
  };
  for (let d = -0.4; d <= 0.4001; d += 0.02) tryTempo(Math.round((bpm0 + d) * 100) / 100, 48);
  // segunda pasada fina alrededor del mejor
  const b1 = best.bpm;
  for (let d = -0.02; d <= 0.0201; d += 0.005) tryTempo(Math.round((b1 + d) * 1000) / 1000, 96);
  return { bpm: best.bpm, first: best.first };
}

// EL PRIMER 1: el primer tiempo de la rejilla donde de verdad pega algo (no un tiempo fantasma antes
// de que arranque el tema): la fase `phase` (s) se corre de a un tiempo hasta el primer ataque fuerte
// (≥ 30 % del ataque típico en los tiempos). Así los compases del deck coinciden con los del tema.
export function firstStrongBeat(env: Float32Array, rate: number, bpm: number, phase: number): number {
  const beat = 60 / bpm;
  const at = (s: number) => { const i = Math.round(s * rate); let m = 0; for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < env.length && env[k] > m) m = env[k]; return m; };
  const vals: number[] = [];
  for (let s = phase; s * rate < env.length; s += beat) vals.push(at(s));
  if (!vals.length) return phase;
  const sorted = [...vals].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length * 0.75)] || 0;
  if (!(typical > 0)) return phase;
  const k = vals.findIndex((v) => v >= 0.3 * typical);
  return phase + Math.max(0, k) * beat;
}

// CAMELOT (mezcla armónica): La menor = 8A, Do mayor = 8B; compatibles = misma clave, ±1, o su relativa
export function camelot(k: SongKey | null | undefined): string {
  if (!k) return '';
  const r = ((k.root % 12) + 12) % 12;
  const n = k.minor ? ((((r - 8) * 7) % 12) + 12) % 12 + 1 : ((((r - 11) * 7) % 12) + 12) % 12 + 1;
  return `${n}${k.minor ? 'A' : 'B'}`;
}
export function camelotCompatible(a: string, b: string): boolean {
  const pa = /^(\d+)([AB])$/.exec(a), pb = /^(\d+)([AB])$/.exec(b);
  if (!pa || !pb) return false;
  const na = Number(pa[1]), nb = Number(pb[1]);
  if (na === nb) return true; // la misma o su relativa
  if (pa[2] !== pb[2]) return false;
  const d = Math.abs(na - nb);
  return d === 1 || d === 11;
}

// GANANCIA AUTOMÁTICA: lleva el tema al loudness de referencia (sin pasarse: −12…+6 dB)
export function autoGainDb(lufs: number | null | undefined, target = -14): number {
  if (lufs == null || !Number.isFinite(lufs)) return 0;
  return Math.max(-12, Math.min(6, Math.round((target - lufs) * 10) / 10));
}

// formato mm:ss del tiempo de un tema
export function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
