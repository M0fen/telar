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
// P1.2 — MICRO-TIMING por paso (el pocket): empuje/arrastre DETERMINISTA de cada golpe
// (la caja que respira, el shaker que empuja). Se emite como patrón paralelo
// `.late("0 0.01 0 -0.006 …")` alineado a los pasos; negativo = adelanta (verificado
// contra el parser krill: la mini-notación acepta números negativos).
export const NUDGE_MAX = 0.02; // ± fracción de ciclo por paso (~±20 ms a 96 BPM)

export interface Lane {
  sound: string;
  steps: number[]; // 0(off) | gain del paso (1 / 1.4 / 0.5 o valor continuo)
  notes: (string | null)[]; // nota por paso (pista afinada) | null
  ratchet: number[]; // 1|2|3|4 (roll/tresillo → snd*N)
  prob: number[]; // 1|0.75|0.5|0.25 (probabilidad → snd?p)
  nudge?: number[]; // micro-timing por paso (±NUDGE_MAX, fracción de ciclo) → .late("…")
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
  melodic?: boolean; // forma melódica pura (note("…").s("snd") sin stack) → se re-emite SIN stack
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

// Sonidos EXENTOS del banco: `.bank("X")` prefija el nombre a ciegas (superdough:
// s = `${bank}_${s}`) → un sample de pack (crate_conga, o conga de vcsl) se volvería
// "RolandTR808_crate_conga" = inexistente = PISTA MUDA. Los nombres con "_" (packs,
// importados, freeze_*) y la percusión de vcsl quedan fuera del banco: se emiten sin
// `.bank()` (el banco va POR SEGMENTO en las pistas que sí son de caja de ritmos).
const BANK_EXEMPT = new Set(['conga', 'bongo', 'darbuka', 'framedrum', 'timpani']);
export const bankExempt = (snd: string) => snd.includes('_') || BANK_EXEMPT.has(soundOf(snd).split(':')[0]);

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
  nudgesPerSub: (number[] | null)[],
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
  const nudgeMap = new Map<string, number[]>();
  const extraMap = new Map<string, SegExtras>();
  if (!complex) {
    toks.forEach((t, si) => {
      const gains = gainsPerSub[si];
      const notes = notesPerSub[si];
      const nudges = nudgesPerSub[si];
      const extras = extrasPerSub[si];
      for (let i = 0; i < steps; i++) {
        const tk = t[i];
        if (!tk || tk === '~') continue;
        const snd = soundOf(tk);
        if (!snd) continue;
        if (!laneMap.has(snd)) { laneMap.set(snd, Array(steps).fill(0)); noteMap.set(snd, Array(steps).fill(null)); ratchMap.set(snd, Array(steps).fill(1)); probMap.set(snd, Array(steps).fill(1)); nudgeMap.set(snd, Array(steps).fill(0)); }
        laneMap.get(snd)![i] = gains && isFinite(gains[i]) ? gains[i] : NORMAL;
        if (notes && notes[i]) noteMap.get(snd)![i] = notes[i];
        if (nudges && isFinite(nudges[i])) nudgeMap.get(snd)![i] = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, nudges[i]));
        if (extras && !extraMap.has(snd)) extraMap.set(snd, extras); // extras son de segmento → 1ª pista del sub
        const rm = /\*(\d+)/.exec(tk); if (rm) ratchMap.get(snd)![i] = Math.max(1, Math.min(8, Number(rm[1]))); // roll por paso
        const pm = /\?([\d.]*)/.exec(tk); if (pm) probMap.get(snd)![i] = pm[1] ? Math.max(0, Math.min(1, Number(pm[1]))) : 0.5; // probabilidad por paso (hh? = 0.5)
      }
    });
  }
  const lanes: Lane[] = [...laneMap.entries()].map(([sound, steps2]) => {
    const ex = extraMap.get(sound);
    const nudge = nudgeMap.get(sound)!;
    return {
      sound, steps: steps2, notes: noteMap.get(sound)!, ratchet: ratchMap.get(sound)!, prob: probMap.get(sound)!,
      nudge: nudge.some((v) => Math.abs(v) > 0.0005) ? nudge : undefined,
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
  // RED DE SEGURIDAD: si la cola tras el stack no es una cadena de métodos válida,
  // el código tiene estructura que NO modelamos (p.ej. este stack es un brazo de un
  // arrange(...)) → patrón avanzado: la rejilla no se ofrece a editarlo (reconstruirlo
  // lo rompería con un error de sintaxis y silenciaría la pista).
  const tailOk = validSfx(tail);
  const segs = splitTop(inner, ',').map((s) => s.trim()).filter(Boolean);
  const toks: string[][] = [];
  const gains: (number[] | null)[] = [];
  const notes: ((string | null)[] | null)[] = [];
  const nudges: (number[] | null)[] = [];
  const extras: (SegExtras | null)[] = [];
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  let badSfx = false;
  const segBanks: string[] = [];
  const segBankable: boolean[] = [];
  for (const seg of segs) {
    let rest = seg; // copia de la que vamos RETIRANDO lo que sí modelamos → el resto es sfx
    const cut = (m: RegExpExecArray | null) => { if (m) rest = rest.replace(m[0], ''); };
    // groove por segmento (A5): .swingBy(x,n) y/o humanize .late(rand.range(a,b)) —
    // centrado (-h/2,h/2) o legado (0,h) — + .velocity(rand…)
    const swM = /\.swingBy\(\s*([\d.]+)\s*,\s*\d+\s*\)/.exec(seg);
    const laM = /\.late\(\s*rand\.range\(\s*(-?[\d.]+)\s*,\s*([\d.]+)\s*\)\s*\)/.exec(seg);
    cut(swM); cut(laM);
    cut(/\.velocity\(\s*rand\.range\([^)]*\)\s*\)/.exec(rest)); // dinámica del humanize (se re-emite)
    cut(/\.gain\(\s*rand\.range\([^)]*\)\s*\)/.exec(rest)); // humanize legado por .gain (superseded)
    const humanOf = (m: RegExpExecArray | null) => (m ? clamp01((Number(m[1]) < 0 ? 2 * Number(m[2]) : Number(m[2])) / HUMAN_LATE) : undefined);
    const groove: Groove | null = (swM || laM) ? { swing: swM ? clamp01(Number(swM[1]) / SWING_MAX) : undefined, human: humanOf(laM) } : null;
    // micro-timing por paso (P1.2): patrón paralelo entrecomillado .late("0 0.01 …")
    const nuM = /\.late\(\s*"([^"]*)"\s*\)/.exec(rest);
    cut(nuM);
    const nudge = nuM ? nuM[1].trim().split(/\s+/).map((x) => (x === '~' ? 0 : Number(x))).map((n) => (isFinite(n) ? n : 0)) : null;
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
      nudges.push(nudge);
    } else {
      const sM = /\bs(?:ound)?\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(rest);
      if (!sM) return null; // segmento no es un s("…") → deja el patrón como avanzado
      cut(sM);
      toks.push(expand(sM[1]));
      notes.push(null);
      gains.push(gain);
      nudges.push(nudge);
    }
    // banco por segmento: se extrae para unificarlo como banco de la rejilla (si es
    // coherente) o re-adjuntarlo al residuo (si cada pista trae el suyo).
    const bkM = /\.bank\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(rest);
    cut(bkM);
    segBanks.push(bkM ? bkM[1] : '');
    segBankable.push(toks[toks.length - 1].some((t) => t !== '~' && !bankExempt(soundOf(t))));
    // nivel escalar del segmento (kit: .gain(0.85)) + residuo verbatim (.room/.lpf/…)
    const lv = extractLevel(rest);
    const sfx = lv.rest.trim();
    if (!validSfx(sfx)) badSfx = true; // residuo irreconstruible → patrón avanzado
    extras.push({ groove, level: lv.level, sfx });
  }
  // Unificación del banco: si NO hay banco en la cola y todos los segmentos BANCABLES
  // (sonidos de caja de ritmos) comparten el mismo, ese es el banco de la rejilla (el
  // selector «caja» lo muestra). Un banco sobre un segmento EXENTO se descarta al
  // reconstruir — lo estaba SILENCIANDO (superdough prefijaría un nombre inexistente).
  // Si los bancos no son coherentes, cada uno vuelve a su residuo (preservado verbatim).
  let gridBank = bank;
  if (!bank) {
    const withBank = segBanks.filter(Boolean);
    const coherent = withBank.length > 0 && withBank.every((b) => b === withBank[0]) &&
      segBanks.every((b, i) => (segBankable[i] ? b === withBank[0] : true));
    if (coherent) gridBank = withBank[0];
    else segBanks.forEach((b, i) => { const ex = extras[i]; if (b && ex) ex.sfx += `.bank("${b}")`; });
  }
  const parsed = lanesFromToks(toks, gains, notes, nudges, extras);
  return { bank: gridBank, tail, tailGain, lanes: parsed.lanes, steps: parsed.steps, complex: parsed.complex || badSfx || !tailOk };
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
  // RED DE SEGURIDAD: si hay CABEZA antes del s("…") (p.ej. `arrange([4, s(…)` de las
  // demos, o `note("…").s("sine")` — melodía cuyo editor es el de notas) o la cola no
  // es una cadena de métodos reconstruible, editar aquí ROMPERÍA el código (error de
  // sintaxis → pista muda) o descartaría la melodía → patrón avanzado, no se toca.
  const structOk = !code.slice(0, om.index).trim() && validSfx(tail);
  const sublanes = splitTop(content, ',').map((s) => s.trim()).filter((s) => s.length);
  const toks = sublanes.map(expand);
  const parsed = lanesFromToks(toks, toks.map(() => null), toks.map(() => null), toks.map(() => null), toks.map(() => null));
  return { bank, tail, tailGain, lanes: parsed.lanes, steps: parsed.steps, complex: parsed.complex || !structOk };
}

// forma MELÓDICA pura: note("…").s("snd") con sufijos, SIN stack — la rejilla la edita
// como UNA pista afinada (pasos + sub-fila de pitch arrastrable + «afinar todo» +
// escala/acorde), el flujo preferido del usuario. El piano roll queda como vista
// alternativa del mismo código. Duplica a propósito la extracción por-segmento de
// parseStackForm (el "segmento" aquí es la cadena entera).
function parseMelodicForm(code: string): Parsed | null {
  let rest = code.trim();
  const cut = (m: RegExpExecArray | null) => { if (m) rest = rest.replace(m[0], ''); };
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const swM = /\.swingBy\(\s*([\d.]+)\s*,\s*\d+\s*\)/.exec(rest); cut(swM);
  const laM = /\.late\(\s*rand\.range\(\s*(-?[\d.]+)\s*,\s*([\d.]+)\s*\)\s*\)/.exec(rest); cut(laM);
  cut(/\.velocity\(\s*rand\.range\([^)]*\)\s*\)/.exec(rest));
  cut(/\.gain\(\s*rand\.range\([^)]*\)\s*\)/.exec(rest));
  const groove: { swing?: number; human?: number } | null = (swM || laM)
    ? { swing: swM ? clamp01(Number(swM[1]) / SWING_MAX) : undefined, human: laM ? clamp01((Number(laM[1]) < 0 ? 2 * Number(laM[2]) : Number(laM[2])) / HUMAN_LATE) : undefined }
    : null;
  // micro-timing por paso (P1.2): patrón paralelo entrecomillado .late("0 0.01 …")
  const nuM = /\.late\(\s*"([^"]*)"\s*\)/.exec(rest); cut(nuM);
  const nudge = nuM ? nuM[1].trim().split(/\s+/).map((x) => (x === '~' ? 0 : Number(x))).map((n) => (isFinite(n) ? n : 0)) : null;
  const gM = /\.gain\(\s*"([^"]*)"\s*\)/.exec(rest); cut(gM);
  const gain = gM ? gM[1].trim().split(/\s+/).map((x) => Number(x)).map((n) => (isFinite(n) ? n : 1)) : null;
  const noteM = /\bnote\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(rest);
  if (!noteM) return null;
  const sM = /\.?\bs(?:ound)?\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/.exec(rest);
  if (!sM) return null;
  cut(noteM); cut(sM);
  const bkM = /\.bank\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(rest); cut(bkM);
  const lv = extractLevel(rest);
  const sfx = lv.rest.trim();
  const sound = sM[1];
  const nt = expand(noteM[1]);
  const toks = nt.map((t) => (t === '~' ? '~' : sound + (/\*\d+/.exec(t)?.[0] ?? '') + (/\?[\d.]*/.exec(t)?.[0] ?? '')));
  const notes = nt.map((t) => (t === '~' ? null : t.replace(/\*\d+/, '').replace(/\?[\d.]*/, '')));
  const parsed = lanesFromToks([toks], [gain], [notes], [nudge], [{ groove, level: lv.level, sfx }]);
  let lanes = parsed.lanes;
  const steps = Math.max(parsed.steps, nt.length || 1);
  // melodía toda en silencio: la pista se crea IGUAL (el instrumento no se pierde y
  // la rejilla siempre muestra su fila — nada de "añade sonidos" a un instrumento).
  if (!lanes.length) {
    lanes = [{
      sound, steps: Array(steps).fill(0), notes: Array(steps).fill(null),
      ratchet: Array(steps).fill(1), prob: Array(steps).fill(1),
      level: Math.abs(lv.level - 1) > 0.001 ? lv.level : undefined, sfx: sfx || undefined,
      swing: groove?.swing, human: groove?.human,
    }];
  }
  return { bank: bkM?.[1] ?? '', tail: '', tailGain: 1, lanes, steps, complex: parsed.complex || !validSfx(sfx), melodic: true };
}

export function parseSeq(code: string): Parsed | null {
  const t = code.trim();
  if (/^stack\s*\(/.test(t)) return parseStackForm(t);
  if (/\bnote\(\s*["'`]/.test(t) && /\bs(?:ound)?\(\s*["'`]/.test(t)) {
    const m = parseMelodicForm(t);
    if (m) return m;
  }
  return parseSimpleForm(code);
}

// --- SECCIONES (P0.3): editar cada brazo de un arrange([compases, patrón], …) --------
// Los sources arreglados por secciones (las demos, el copiloto IA) se editan POR BRAZO:
// el secuenciador muestra pestañas y opera sobre el patrón de la sección elegida. El
// guardado es un EMPALME TEXTUAL por spans — solo cambian los bytes del brazo editado,
// el resto del código queda verbatim (imposible romper las otras secciones).

export interface ArrangeArm {
  bars: number; // compases (ciclos) del brazo
  code: string; // expresión del patrón del brazo (puede ser `silence`)
  start: number; // span [start, end) del EXPR dentro del código completo
  end: number;
  nStart: number; // span del NÚMERO de compases (para redimensionar por empalme)
  nEnd: number;
  wholeStart: number; // span del brazo completo `[n, expr]` (para duplicar/quitar/insertar)
  wholeEnd: number;
}

// Parte un arrange(...) en sus brazos con spans. Devuelve null si el código no es un
// arrange editable (sin arrange, brazos no estándar `[n, expr]`, paréntesis rotos…).
export function splitArrange(code: string): ArrangeArm[] | null {
  const m = /\barrange\s*\(/.exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0, close = -1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (!depth) { close = i; break; } }
  }
  if (close < 0) return null;
  const inner = code.slice(open + 1, close);
  const innerOff = open + 1;
  // trozos al nivel superior (coma fuera de paréntesis/corchetes), con offset.
  const pieces: { text: string; start: number }[] = [];
  let d = 0, curStart = 0;
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (c === '(' || c === '[' || c === '<') d++;
    else if (c === ')' || c === ']' || c === '>') d--;
    else if (c === ',' && d === 0) { pieces.push({ text: inner.slice(curStart, k), start: curStart }); curStart = k + 1; }
  }
  pieces.push({ text: inner.slice(curStart), start: curStart });
  const arms: ArrangeArm[] = [];
  for (const p of pieces) {
    const t = p.text;
    const bm = /^\s*\[\s*([\d.]+)\s*,/.exec(t); // brazo estándar: [n, expr]
    if (!bm) return null;
    const closeBr = t.lastIndexOf(']');
    if (closeBr < bm[0].length) return null;
    let s = bm[0].length, e = closeBr;
    while (s < e && /\s/.test(t[s])) s++;
    while (e > s && /\s/.test(t[e - 1])) e--;
    if (e <= s) return null;
    const base = innerOff + p.start;
    const numAt = bm[0].indexOf(bm[1]); // posición del número dentro del match "[ n,"
    arms.push({
      bars: Number(bm[1]), code: t.slice(s, e), start: base + s, end: base + e,
      nStart: base + numAt, nEnd: base + numAt + bm[1].length,
      wholeStart: base + t.indexOf('['), wholeEnd: base + closeBr + 1,
    });
  }
  return arms.length ? arms : null;
}

// --- gestión de secciones (P0.3 ampliado): todo por EMPALME textual (spans) ----------

// cambia los compases de un brazo (solo se tocan los dígitos del número).
export function setArmBars(code: string, arm: ArrangeArm, bars: number): string {
  const b = Math.max(1, Math.min(64, Math.round(bars)));
  return code.slice(0, arm.nStart) + String(b) + code.slice(arm.nEnd);
}

// duplica un brazo justo después de sí mismo (variación: editas la copia).
export function duplicateArm(code: string, arm: ArrangeArm): string {
  return code.slice(0, arm.wholeEnd) + `, [${fmt(arm.bars)}, ${arm.code}]` + code.slice(arm.wholeEnd);
}

// añade una sección EN SILENCIO al final (el instrumento no entra hasta que se pinte).
export function addSilentArm(code: string, lastArm: ArrangeArm, bars = 4): string {
  return code.slice(0, lastArm.wholeEnd) + `, [${Math.max(1, Math.round(bars))}, silence]` + code.slice(lastArm.wholeEnd);
}

// quita un brazo (con su coma adyacente). null si es el único (un arrange sin brazos
// no existe; para volver al patrón plano se edita el código).
export function removeArm(code: string, arms: ArrangeArm[], idx: number): string | null {
  if (arms.length <= 1 || idx < 0 || idx >= arms.length) return null;
  const from = idx > 0 ? arms[idx - 1].wholeEnd : arms[0].wholeStart;
  const to = idx > 0 ? arms[idx].wholeEnd : arms[1].wholeStart;
  return code.slice(0, from) + code.slice(to);
}

// convierte un patrón PLANO en un arrange por secciones, sembrando CADA sección con el
// patrón actual → suena idéntico (un loop), y luego se edita cada sección por pestañas.
export function wrapAsArrange(code: string, sections: number[]): string {
  const c = code.trim();
  return `arrange(${sections.map((n) => `[${Math.max(1, Math.round(n))}, ${c}]`).join(', ')})`;
}

// alinea las secciones de un source a la ESTRUCTURA de la canción (compases por
// sección): plano → se envuelve sembrado (suena igual); mismo nº de brazos → se
// redimensionan; menos brazos → se completan con silencios; MÁS brazos que la
// estructura → null (no se toca: recortar secciones sería destructivo).
export function alignArrangeToBars(code: string, bars: number[]): string | null {
  if (!bars.length || !code.trim()) return null;
  const arms0 = splitArrange(code);
  if (!arms0) return wrapAsArrange(code, bars);
  if (arms0.length > bars.length) return null;
  let out = code;
  // redimensiona de ATRÁS hacia delante (cada empalme desplaza los spans posteriores)
  for (let i = arms0.length - 1; i >= 0; i--) {
    const arms = splitArrange(out);
    if (!arms) return null;
    out = setArmBars(out, arms[i], bars[i]);
  }
  for (let i = arms0.length; i < bars.length; i++) {
    const arms = splitArrange(out);
    if (!arms) return null;
    out = addSilentArm(out, arms[arms.length - 1], bars[i]);
  }
  return out;
}

// Reemplaza el patrón de UN brazo dentro del código completo (empalme por span).
export function spliceArm(code: string, arm: ArrangeArm, newExpr: string): string {
  return code.slice(0, arm.start) + newExpr + code.slice(arm.end);
}

// ¿el código es una MELODÍA editable en el piano roll? (note/n con contenido, no una
// rejilla stack ni un loop de sample). Compartido por el enrutado de editores.
export function isMelodicCode(code: string): boolean {
  if (/^\s*stack\s*\(/.test(code)) return false;
  return /\b(?:note|n)\(\s*["'`]/.test(code) && !/\.loopAt\(/.test(code) && !code.includes('arrange');
}

// SIEMBRA de una sección en silencio (P0.3 UX): a partir de la sección de REFERENCIA
// (el primer brazo con patrón) construye la base editable de la sección callada con
// LA MISMA instrumentación pero sin golpes/notas → al abrirla ves las pistas o el
// piano roll de siempre, pre-escuchas el instrumento, y pintar lo hace entrar. Nada
// de rejillas vacías sin pistas ni pasos intermedios de "activar".
export function seedSilent(ref: string): { code: string; seedFrom?: string } | null {
  const r = ref.trim();
  if (isMelodicCode(r)) {
    // melodía: mismo instrumento/FX, contenido del note() → 16 silencios. Se quitan
    // las lanes de vel/dur de la referencia (no aplican a una sección vacía).
    const rests = Array(16).fill('~').join(' ');
    const code = r
      .replace(/\.gain\(\s*"[^"]*"\s*\)/, '')
      .replace(/\.clip\(\s*"[^"]*"\s*\)/, '')
      .replace(/\b(note|n)\(\s*(["'`])[^"'`]*\2\s*\)/, (_m, fn, q) => `${fn}(${q}${rests}${q})`);
    // seedFrom: la rejilla siembra las NOTAS de la referencia (pintar un paso recupera
    // su nota original); el piano roll usa `code` directo.
    return /\b(?:note|n)\(/.test(code) ? { code, seedFrom: r } : null;
  }
  const p = parseSeq(r);
  if (!p || p.complex) return null;
  // rejilla: base emitible con el banco/cola de la referencia y CERO pasos activos;
  // las pistas (con sus niveles/sfx) las siembra la UI desde `seedFrom`.
  const zero = p.lanes.map((l) => ({ ...l, steps: l.steps.map(() => 0) }));
  return { code: buildSeq(p, zero, p.steps), seedFrom: r };
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
//
// P0.2: swingBy(x, n) parte el ciclo en n rebanadas y retrasa la 2ª mitad de cada una
// (verificado en @strudel/core/pattern.mjs). El shuffle debe ir en el PAR de pasos
// adyacentes → n = pasos/2 (16 pasos → 8 = swing de semicorcheas, el tumbao del
// dembow; 8 pasos → 4). Antes iba fijo en 4: con 16 pasos swingueaba corcheas y
// arrastraba los pasos 3-4 de cada negra en bloque — ningún riddim suena así.
function grooveSfx(l: Lane, steps: number): string {
  let s = '';
  if ((l.swing ?? 0) > 0.01) s += `.swingBy(${fmt3((l.swing as number) * SWING_MAX)}, ${Math.max(2, Math.round(steps / 2))})`;
  // dinámica aleatoria por .velocity (NO .gain): superdough hace gain*=velocity, así se
  // MULTIPLICA con el .gain de los acentos en vez de pisarlo (dos .gain encadenados =
  // el 2º gana, borraría los acentos). Timing CENTRADO (±h/2): la variación humana
  // rodea el grid — el rango (0,h) anterior arrastraba todo el patrón hacia tarde.
  if ((l.human ?? 0) > 0.01) { const h = l.human as number; s += `.late(rand.range(${fmt3(-h * HUMAN_LATE / 2)},${fmt3(h * HUMAN_LATE / 2)})).velocity(rand.range(${fmt3(1 - h * HUMAN_GAIN)},1))`; }
  return s;
}
// micro-timing por paso (P1.2): patrón paralelo .late("0 0.01 0 -0.006 …") alineado a
// los pasos — el push/pull determinista del pocket (negativo = adelanta el golpe).
function nudgeSfx(l: Lane, steps: number): string {
  const n = l.nudge;
  // solo cuenta el nudge de pasos ACTIVOS (el de un silencio no suena → no se emite;
  // emitirlo dejaba el round-trip inestable). Posiciones inactivas se escriben 0.
  if (!n || !n.slice(0, steps).some((v, i) => Math.abs(v) > 0.0005 && (l.steps[i] ?? 0) > 0)) return '';
  const vals = Array.from({ length: steps }, (_, i) => ((l.steps[i] ?? 0) > 0 ? fmt3(Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, n[i] ?? 0))) : '0'));
  return `.late("${vals.join(' ')}")`;
}
// nivel escalar del segmento: SIEMPRE `.mul(gain(x))` (multiplica los acentos; un
// `.gain(x)` a secas los pisaría — P0.1d).
const levelSfx = (l: Lane) => (Math.abs((l.level ?? 1) - 1) > 0.001 ? `.mul(gain(${fmt(l.level as number)}))` : '');

// P2.2 — banco PROPIO por pista (mezclar kick 808 con caja LinnDrum en la misma
// rejilla): vive como `.bank("X")` en el residuo de la pista (Lane.sfx). Cuando alguna
// pista trae banco propio, el banco de la rejilla se emite POR SEGMENTO en las demás
// (un banco global en la cola PISARÍA los overrides — set-semantics).
export function laneOwnBank(l: Lane): string {
  const m = /\.bank\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(l.sfx ?? '');
  return m ? m[1] : '';
}
export function withLaneBank(l: Lane, bank: string): Lane {
  const sfx = (l.sfx ?? '').replace(/\.bank\(\s*["'`][^"'`]+["'`]\s*\)/, '');
  return { ...l, sfx: (sfx + (bank ? `.bank("${bank}")` : '')) || undefined };
}
const tailGainSfx = (g: number) => (Math.abs(g - 1) > 0.001 ? `.mul(gain(${fmt(g)}))` : '');

export function buildSeq(p: Parsed, lanes: Lane[], steps: number): string {
  const active = lanes.filter((l) => l.steps.slice(0, steps).some((v) => v > 0));
  const tail = (p.tail || '') + tailGainSfx(p.tailGain ?? 1);
  // forma MELÓDICA pura (una sola pista afinada): se re-emite SIN stack, con su
  // note("…").s(...) — aunque esté toda en silencio, el INSTRUMENTO no se pierde
  // (nada de degradar una melodía a s("~")). Compatible con el piano roll.
  if (p.melodic && lanes.length === 1 && !p.tail && Math.abs((p.tailGain ?? 1) - 1) < 0.001) {
    const l = lanes[0];
    const body = l.steps.slice(0, steps).map((v, i) => (v > 0 ? (l.notes[i] || DEFAULT_NOTE) + stepSfx(l, i) : '~')).join(' ');
    const laneAccent = l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01);
    const g = laneAccent ? `.gain("${l.steps.slice(0, steps).map((v) => (v > 0 ? fmt(v) : '1')).join(' ')}")` : '';
    const bk = p.bank && !bankExempt(l.sound) && !laneOwnBank(l) ? `.bank("${p.bank}")` : '';
    return `note("${body}").s("${l.sound}")${g}${nudgeSfx(l, steps)}${grooveSfx(l, steps)}${bk}${l.sfx ?? ''}${levelSfx(l)}`;
  }
  // vacía: conserva PASOS y banco. Antes emitía s("~") (1 paso) → al vaciar la rejilla,
  // el nº de pasos colapsaba 8→1 (y "empezar rejilla" silenciaba). Emitimos N silencios.
  if (!active.length) return `s("${Array(Math.max(1, steps)).fill('~').join(' ')}")${p.bank ? `.bank("${p.bank}")` : ''}${tail}`;
  // BANCO: global (en la cola) solo si NINGUNA pista es exenta NI trae banco propio.
  // Con mezcla (packs exentos, o una pista con su propia caja — P2.2), el banco de la
  // rejilla va POR SEGMENTO en las pistas que lo heredan (un global en la cola pisaría
  // los overrides y silenciaría los packs). Si nadie lo hereda, no se emite.
  const inherits = (l: Lane) => !bankExempt(l.sound) && !laneOwnBank(l);
  const anyNoInherit = active.some((l) => !inherits(l));
  const bankSfx = p.bank && !anyNoInherit ? `.bank("${p.bank}")` : '';
  const mixedBank = !!p.bank && anyNoInherit && active.some(inherits); // banco por segmento → necesita stack
  const hasAccent = active.some((l) => l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01));
  const anyPitched = active.some((l) => lanePitched(l, steps));
  const anyGroove = active.some(laneGroove);
  const anyNudge = active.some((l) => !!nudgeSfx(l, steps)); // micro-timing → necesita stack
  const anyExtra = active.some(laneExtra) || mixedBank || anyNudge; // nivel/residuo/banco-mixto → stack
  if (!hasAccent && !anyPitched && !anyGroove && !anyExtra) {
    const body = active.map((l) => laneBody(l, steps)).join(', ');
    return `s("${body}")${bankSfx}${tail}`;
  }
  const parts = active.map((l) => {
    const laneAccent = l.steps.slice(0, steps).some((v) => v > 0 && Math.abs(v - NORMAL) > 0.01);
    const g = laneAccent ? `.gain("${l.steps.slice(0, steps).map((v) => (v > 0 ? fmt(v) : '1')).join(' ')}")` : '';
    const gr = nudgeSfx(l, steps) + grooveSfx(l, steps);
    const bk = mixedBank && !bankExempt(l.sound) && !laneOwnBank(l) ? `.bank("${p.bank}")` : '';
    const extra = (l.sfx ?? '') + levelSfx(l); // residuo verbatim + nivel multiplicativo
    // pista afinada → note("…").s("snd") (note re-afina el sample); si no, s("…").
    if (lanePitched(l, steps)) return `note("${laneNotesBody(l, steps)}").s("${l.sound}")${g}${gr}${bk}${extra}`;
    return `s("${laneBody(l, steps)}")${g}${gr}${bk}${extra}`;
  });
  return `stack(${parts.join(', ')})${bankSfx}${tail}`;
}
