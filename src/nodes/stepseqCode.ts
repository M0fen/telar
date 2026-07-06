// Lógica PURA del secuenciador por source (parse ↔ build del código Strudel).
// Extraída de StepSeq.tsx para poder testearla en Node (sin React ni @strudel/web),
// igual que laneCode/sampleFit. StepSeq.tsx importa de aquí.
//
// CONTRATO DE ROUND-TRIP (anti-fallo-silencioso): lo que la rejilla no modela NO se
// descarta al reconstruir. Cada segmento conserva su sufijo residual verbatim
// (`Lane.sfx`: .bank/.room/.lpf/… por pista) y su NIVEL escalar (`Lane.level`,
// un `.gain(0.35)` heredado de un kit) que se re-emite SIEMPRE como `.mul(gain(x))`
// — un `.gain(x)` escalar tras los acentos los PISA (set-semantics de Strudel,
// ver P0.1 en auditoria-dancehall.md); `.mul` los multiplica. Lo mismo con el
// nivel de la cola global (`tailGain`). Si el residuo no es una cadena de métodos
// válida, el patrón se marca `complex` (la rejilla no lo toca — sigue sonando).

// niveles de velocity (valor de gain). Ghost/normal/acento; el ciclo pasa por estos.
export const NORMAL = 1, ACCENT = 1.4, GHOST = 0.5;
export const DEFAULT_NOTE = 'c3'; // nota por defecto al afinar una pista
// A5 — GROOVE por pista: swing (balanceo/tumbao) + humanize (micro-timing y
// micro-dinámica aleatorios por golpe). Los sliders van 0..1 → estos máximos.
export const SWING_MAX = 0.34; // amount máx de .swingBy (~ tresillo a fondo)
export const HUMAN_LATE = 0.02; // desfase máx (fracción de ciclo) del .late(rand…)
export const HUMAN_GAIN = 0.3; // caída de dinámica máx del humanize (rand.range(1-x,1))

export interface Lane {
  sound: string;
  steps: number[]; // 0(off) | gain del paso (1 / 1.4 / 0.5)
  notes: (string | null)[]; // nota por paso (pista afinada) | null
  ratchet: number[]; // 1|2|3|4 (roll/tresillo → snd*N)
  prob: number[]; // 1|0.75|0.5|0.25 (probabilidad → snd?p)
  swing?: number; // groove por pista 0..1
  human?: number;
  level?: number; // nivel escalar del segmento (kit: .gain(0.35)) → se emite .mul(gain(x))
  sfx?: string; // sufijo residual del segmento, preservado verbatim (.bank/.room/…)
}
export interface Parsed {
  bank: string;
  tail: string;
  tailGain: number; // nivel escalar de la cola global → se emite .mul(gain(x))
  lanes: Lane[];
  steps: number;
  complex: boolean;
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
// 3 decimales: los montos de groove son chicos (0..0.34), 2 decimales perdían resolución
export const fmt3 = (n: number) => (isFinite(n) ? n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : '0');

export function splitTop(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const c of s) {
    if (c === '[' || c === '<' || c === '(') { depth++; cur += c; }
    else if (c === ']' || c === '>' || c === ')') { depth--; cur += c; }
    else if (c === sep && depth === 0) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function tokenize(pat: string): string[] {
  return splitTop(pat.trim().replace(/\s+/g, ' '), ' ').map((t) => t.trim()).filter(Boolean);
}
export const soundOf = (tok: string) => tok.replace(/\*\d+/, '').replace(/\?[\d.]*/, '').trim(); // quita roll (*N) y probabilidad (?p)
const isComplex = (tok: string) => /[[\]<>()]/.test(tok);

// A7 — normaliza sub-estructura que SÍ mapea al modelo de rejilla, para no rendirse:
// `[x x x]` (corchete plano, mismo sonido repetido) → `x*3` (roll, suena idéntico).
// Acordes `[c,e,g]`, alternancia `<a b>`, euclid `(3,8)` y `[a b]` mixto se dejan como
// están (siguen marcando "avanzado": forzarlos a la rejilla cambiaría el patrón).
function normalizeTok(tok: string): string {
  const m = /^\[([^[\]<>()]+)\]$/.exec(tok); // corchete plano, sin anidar
  if (!m) return tok;
  const inner = m[1].trim();
  if (inner.includes(',')) return tok; // acorde/stack → no tocar
  const parts = inner.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => p === parts[0])) return `${parts[0]}*${parts.length}`;
  return tok;
}

// tokens de un sublane; expande un único `X*N` a N pasos.
function expand(sl: string): string[] {
  let t = tokenize(sl).map(normalizeTok);
  if (t.length === 1 && /^[A-Za-z][\w:]*\*\d+$/.test(t[0])) {
    const [, base, n] = /^([A-Za-z][\w:]*)\*(\d+)$/.exec(t[0])!;
    t = Array.from({ length: Math.min(32, Number(n)) }, () => base);
  }
  return t;
}

// extrae un nivel escalar `.mul(gain(N))` (forma nueva) o `.gain(N)` (legado) de `s`.
// Solo números literales: un `.gain(saw.range(…))` (señal) no matchea y queda como sfx.
function extractLevel(s: string): { rest: string; level: number } {
  const m = /\.mul\(\s*gain\(\s*([\d.]+)\s*\)\s*\)/.exec(s) ?? /\.gain\(\s*([\d.]+)\s*\)/.exec(s);
  if (!m) return { rest: s, level: 1 };
  const level = Number(m[1]);
  return {
    rest: s.slice(0, m.index) + s.slice(m.index + m[0].length),
    level: isFinite(level) && level > 0 ? level : 1,
  };
}

// separa el sufijo de FX tras la llamada `s("…")` o `stack(…)`. Extrae el banco y el
// nivel escalar (se re-aplican aparte) y devuelve el resto de la cadena tal cual.
function splitTail(tailRaw: string): { bank: string; tail: string; tailGain: number } {
  const bankM = /\.bank\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(tailRaw);
  const bank = bankM ? bankM[1] : '';
  const noBank = bankM ? tailRaw.slice(0, bankM.index) + tailRaw.slice(bankM.index + bankM[0].length) : tailRaw;
  const { rest, level } = extractLevel(noBank);
  return { bank, tail: rest.trim(), tailGain: level };
}

// ¿`s` es una cadena de métodos re-emitible verbatim (`.a(…).b(…)` con paréntesis
// balanceados) o basura que no sabemos reconstruir? Vacío = válido.
function validSfx(s: string): boolean {
  if (!s) return true;
  if (!s.startsWith('.')) return false;
  let d = 0;
  for (const c of s) {
    if (c === '(') d++;
    else if (c === ')') { d--; if (d < 0) return false; }
  }
  return d === 0;
}

// construye lanes agrupando por sonido a partir de sublanes ya tokenizados, con sus
// niveles de velocity (gains[i]), notas, groove, nivel y sufijo residual por segmento.
// Marca `complex` si hay tokens con corchetes o longitudes dispares.
type Groove = { swing?: number; human?: number };
interface SegExtras { groove: Groove | null; level: number; sfx: string }
function lanesFromToks(
  toks: string[][],
  gainsPerSub: (number[] | null)[],
  notesPerSub: ((string | null)[] | null)[],
  extrasPerSub: (SegExtras | null)[],
): { lanes: Lane[]; steps: number; complex: boolean } {
  const steps = Math.max(1, ...toks.map((t) => t.length));
  let complex = false;
  for (const t of toks) {
    if (t.length !== steps) complex = true;
    for (const tk of t) if (tk !== '~' && isComplex(tk)) complex = true;
  }
  const laneMap = new Map<string, number[]>();
  const noteMap = new Map<string, (string | null)[]>();
  const ratchMap = new Map<string, number[]>();
  const probMap = new Map<string, number[]>();
  const extraMap = new Map<string, SegExtras>();
  if (!complex) {
    toks.forEach((t, si) => {
      const gains = gainsPerSub[si];
      const notes = notesPerSub[si];
      const extras = extrasPerSub[si];
      for (let i = 0; i < steps; i++) {
        const tk = t[i];
        if (!tk || tk === '~') continue;
        const snd = soundOf(tk);
        if (!snd) continue;
        if (!laneMap.has(snd)) { laneMap.set(snd, Array(steps).fill(0)); noteMap.set(snd, Array(steps).fill(null)); ratchMap.set(snd, Array(steps).fill(1)); probMap.set(snd, Array(steps).fill(1)); }
        laneMap.get(snd)![i] = gains && isFinite(gains[i]) ? gains[i] : NORMAL;
        if (notes && notes[i]) noteMap.get(snd)![i] = notes[i];
        if (extras && !extraMap.has(snd)) extraMap.set(snd, extras); // extras son de segmento → 1ª pista del sub
        const rm = /\*(\d+)/.exec(tk); if (rm) ratchMap.get(snd)![i] = Math.max(1, Math.min(8, Number(rm[1]))); // roll por paso
        const pm = /\?([\d.]*)/.exec(tk); if (pm) probMap.get(snd)![i] = pm[1] ? Math.max(0, Math.min(1, Number(pm[1]))) : 0.5; // probabilidad por paso (hh? = 0.5)
      }
    });
  }
  const lanes: Lane[] = [...laneMap.entries()].map(([sound, steps2]) => {
    const ex = extraMap.get(sound);
    return {
      sound, steps: steps2, notes: noteMap.get(sound)!, ratchet: ratchMap.get(sound)!, prob: probMap.get(sound)!,
      swing: ex?.groove?.swing, human: ex?.groove?.human,
      level: ex && Math.abs(ex.level - 1) > 0.001 ? ex.level : undefined,
      sfx: ex?.sfx || undefined,
    };
  });
  return { lanes, steps, complex };
}

// forma STACK: stack(seg, seg, …)<tail>. Cada seg es `s("…")[.gain("…")]` (percusión) o
// `note("…").s("snd")[.gain("…")]` (pista melódica/afinada), más su residuo preservado.
function parseStackForm(code: string): Parsed | null {
  const open = code.indexOf('(');
  if (open < 0) return null;
  let depth = 0, close = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) return null;
  const inner = code.slice(open + 1, close);
  const { bank, tail, tailGain } = splitTail(code.slice(close + 1));
  const segs = splitTop(inner, ',').map((s) => s.trim()).filter(Boolean);
  const toks: string[][] = [];
  const gains: (number[] | null)[] = [];
  const notes: ((string | null)[] | null)[] = [];
  const extras: (SegExtras | null)[] = [];
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  let badSfx = false;
  for (const seg of segs) {
    let rest = seg; // copia de la que vamos RETIRANDO lo que sí modelamos → el resto es sfx
    const cut = (m: RegExpExecArray | null) => { if (m) rest = rest.replace(m[0], ''); };
    // groove por segmento (A5): .swingBy(x,n) y/o .late(rand.range(0,h)) + .velocity(rand…)
    const swM = /\.swingBy\(\s*([\d.]+)\s*,\s*\d+\s*\)/.exec(seg);
    const laM = /\.late\(\s*rand\.range\(\s*0\s*,\s*([\d.]+)\s*\)\s*\)/.exec(seg);
    cut(swM); cut(laM);
    cut(/\.velocity\(\s*rand\.range\([^)]*\)\s*\)/.exec(rest)); // dinámica del humanize (se re-emite)
    cut(/\.gain\(\s*rand\.range\([^)]*\)\s*\)/.exec(rest)); // humanize legado por .gain (superseded)
    const groove: Groove | null = (swM || laM) ? { swing: swM ? clamp01(Number(swM[1]) / SWING_MAX) : undefined, human: laM ? clamp01(Number(laM[1]) / HUMAN_LATE) : undefined } : null;
    // gain "de acento" por segmento (entrecomillado; NO el rand del humanize)
    const gM = /\.gain\(\s*"([^"]*)"\s*\)/.exec(rest);
    cut(gM);
    const gain = gM ? gM[1].trim().split(/\s+/).map((x) => Number(x)).map((n) => (isFinite(n) ? n : 1)) : null;
    const noteM = /\bnote\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(rest);
    if (noteM) {
      // pista afinada: note("…").s("snd") → presencia por posición + notas aparte.
      const sM = /\.s(?:ound)?\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/.exec(rest);
      if (!sM) return null;
      cut(noteM); cut(sM);
      const nt = expand(noteM[1]);
      toks.push(nt.map((t) => (t === '~' ? '~' : sM[1] + (/\*\d+/.exec(t)?.[0] ?? '') + (/\?[\d.]*/.exec(t)?.[0] ?? '')))); // conserva *N (roll) y ?p (prob) en la presencia
      notes.push(nt.map((t) => (t === '~' ? null : t.replace(/\*\d+/, '').replace(/\?[\d.]*/, ''))));
      gains.push(gain);
    } else {
      const sM = /\bs(?:ound)?\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(rest);
      if (!sM) return null; // segmento no es un s("…") → deja el patrón como avanzado
      cut(sM);
      toks.push(expand(sM[1]));
      notes.push(null);
      gains.push(gain);
    }
    // nivel escalar del segmento (kit: .gain(0.85)) + residuo verbatim (.bank/.room/…)
    const lv = extractLevel(rest);
    const sfx = lv.rest.trim();
    if (!validSfx(sfx)) badSfx = true; // residuo irreconstruible → patrón avanzado
    extras.push({ groove, level: lv.level, sfx });
  }
  const parsed = lanesFromToks(toks, gains, notes, extras);
  return { bank, tail, tailGain, lanes: parsed.lanes, steps: parsed.steps, complex: parsed.complex || badSfx };
}

// forma SIMPLE: s("a ~, ~ b")<tail>
function parseSimpleForm(code: string): Parsed | null {
  const om = /\b(?:s|sound)\(\s*["'`]/.exec(code);
  if (!om) return null;
  const contentStart = om.index + om[0].length;
  const quote = code[contentStart - 1];
  const contentEnd = code.indexOf(quote, contentStart);
  if (contentEnd < 0) return null;
  const content = code.slice(contentStart, contentEnd);
  // salta el cierre `")` y toma el resto como cola de FX.
  let j = contentEnd + 1;
  while (j < code.length && /\s/.test(code[j])) j++;
  if (code[j] === ')') j++;
  const { bank, tail, tailGain } = splitTail(code.slice(j));
  const sublanes = splitTop(content, ',').map((s) => s.trim()).filter((s) => s.length);
  const toks = sublanes.map(expand);
  const parsed = lanesFromToks(toks, toks.map(() => null), toks.map(() => null), toks.map(() => null));
  return { bank, tail, tailGain, lanes: parsed.lanes, steps: parsed.steps, complex: parsed.complex };
}

export function parseSeq(code: string): Parsed | null {
  const t = code.trim();
  if (/^stack\s*\(/.test(t)) return parseStackForm(t);
  return parseSimpleForm(code);
}

// ¿la pista está afinada? (algún paso encendido tiene nota)
export function lanePitched(l: Lane, steps: number): boolean {
  return l.steps.slice(0, steps).some((v, i) => v > 0 && !!l.notes[i]);
}
const ratchSfx = (l: Lane, i: number) => (l.ratchet[i] > 1 ? `*${l.ratchet[i]}` : ''); // roll: hh*3
const probSfx = (l: Lane, i: number) => ((l.prob?.[i] ?? 1) < 0.999 ? `?${fmt(l.prob[i])}` : ''); // probabilidad: hh?0.5
const stepSfx = (l: Lane, i: number) => ratchSfx(l, i) + probSfx(l, i); // roll + prob (hh*3?0.5)
function laneBody(l: Lane, steps: number): string {
  return l.steps.slice(0, steps).map((v, i) => (v > 0 ? l.sound + stepSfx(l, i) : '~')).join(' ');
}
function laneNotesBody(l: Lane, steps: number): string {
  return l.steps.slice(0, steps).map((v, i) => (v > 0 ? (l.notes[i] || DEFAULT_NOTE) + stepSfx(l, i) : '~')).join(' ');
}
export const laneGroove = (l: Lane) => (l.swing ?? 0) > 0.01 || (l.human ?? 0) > 0.01;
const laneExtra = (l: Lane) => !!l.sfx || Math.abs((l.level ?? 1) - 1) > 0.001;
// sufijo de groove por pista (A5). swing = balanceo del tumbao; humanize = micro-timing
// + micro-dinámica aleatorios (rand por golpe). Se emite como método sobre el segmento.
function grooveSfx(l: Lane): string {
  let s = '';
  if ((l.swing ?? 0) > 0.01) s += `.swingBy(${fmt3((l.swing as number) * SWING_MAX)}, 4)`;
  // dinámica aleatoria por .velocity (NO .gain): superdough hace gain*=velocity, así se
  // MULTIPLICA con el .gain de los acentos en vez de pisarlo (dos .gain encadenados =
  // el 2º gana, borraría los acentos).
  if ((l.human ?? 0) > 0.01) { const h = l.human as number; s += `.late(rand.range(0,${fmt3(h * HUMAN_LATE)})).velocity(rand.range(${fmt3(1 - h * HUMAN_GAIN)},1))`; }
  return s;
}
// nivel escalar del segmento: SIEMPRE `.mul(gain(x))` (multiplica los acentos; un
// `.gain(x)` a secas los pisaría — P0.1d).
const levelSfx = (l: Lane) => (Math.abs((l.level ?? 1) - 1) > 0.001 ? `.mul(gain(${fmt(l.level as number)}))` : '');
const tailGainSfx = (g: number) => (Math.abs(g - 1) > 0.001 ? `.mul(gain(${fmt(g)}))` : '');

export function buildSeq(p: Parsed, lanes: Lane[], steps: number): string {
  const active = lanes.filter((l) => l.steps.slice(0, steps).some((v) => v > 0));
  const bankSfx = p.bank ? `.bank("${p.bank}")` : '';
  const tail = (p.tail || '') + tailGainSfx(p.tailGain ?? 1);
  if (!active.length) return `s("~")${bankSfx}${tail}`;
  const hasAccent = active.some((l) => l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01));
  const anyPitched = active.some((l) => lanePitched(l, steps));
  const anyGroove = active.some(laneGroove);
  const anyExtra = active.some(laneExtra); // nivel o residuo por pista → necesita stack
  if (!hasAccent && !anyPitched && !anyGroove && !anyExtra) {
    const body = active.map((l) => laneBody(l, steps)).join(', ');
    return `s("${body}")${bankSfx}${tail}`;
  }
  const parts = active.map((l) => {
    const laneAccent = l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01);
    const g = laneAccent ? `.gain("${l.steps.slice(0, steps).map((v) => (v > 0 ? fmt(v) : '1')).join(' ')}")` : '';
    const gr = grooveSfx(l);
    const extra = (l.sfx ?? '') + levelSfx(l); // residuo verbatim + nivel multiplicativo
    // pista afinada → note("…").s("snd") (note re-afina el sample); si no, s("…").
    if (lanePitched(l, steps)) return `note("${laneNotesBody(l, steps)}").s("${l.sound}")${g}${gr}${extra}`;
    return `s("${laneBody(l, steps)}")${g}${gr}${extra}`;
  });
  return `stack(${parts.join(', ')})${bankSfx}${tail}`;
}
