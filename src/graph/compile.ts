// Compilador grafo → código de Pattern. (master-prompt §3)
//   1. Valida DAG (sin ciclos).
//   2. Localiza Out(s).
//   3. Recorrido topológico hacia atrás desde cada Out.
//   4. Cada nodo se resuelve a una expresión de Pattern.
//   5. Varios Out ⇒ stack() de todos = patrón maestro.
//
// Emitimos un string de JS que la capa de audio pasa a repl.evaluate (hot-swap).
// Además rastreamos, por cada nodo Source, el rango [start,end) que ocupa su
// código dentro del string compilado: eso permite mapear los eventos activos
// (hap.context.locations, en coords del código evaluado) de vuelta a su editor
// para resaltar qué se está tocando, como en strudel.cc.
import { cleanSends, sendsActive, RETURN_RANGES, DEFAULT_RETURNS } from '../lib/returns';
import type { Edge, Node } from '@xyflow/react';
import { automationSuffix, masterAutomationSuffix, cleanAuto, isActive } from '../lib/automation';
import type { NodeData, SynthParams, VoiceParams } from './types';
import { channelEqActive, channelCompActive, DEFAULT_CHANNEL_COMP, SYNTH_WAVES, type ChannelComp } from './types';
import { OPS_BY_ID } from './ops';
import { irRoomsize, knownIr } from '../audio/irRegistry';
import { isMorphWave, isUserWave, userFrames } from '../audio/wavetables';

// Prefijo del id de analyser por Source (onda por instrumento, Fase 3). El tap
// `.analyze(...)` solo se añade cuando el scope de ese nodo está activo.
export const SRC_ANALYSER_PREFIX = 'telar-src-';

// Marcadores de visualizadores inline (`._scope()` / `._pianoroll()`): se quitan
// del código emitido (los dibuja el editor entre líneas). Con flag `g` para
// reemplazar todas las apariciones.
const INLINE_VIZ_RE = /\._(?:scope|pianoroll)\(\)/g;

// Rango del código de un Source dentro del string compilado.
export interface SourceSpan {
  nodeId: string;
  start: number;
  end: number;
}

// EQ de canal resuelto a un orbit concreto: el motor inserta filtros Biquad reales
// sobre el bus de ese orbit (ver engine.setChannelEqs).
// TIRA DE CANAL en el bus de una pista: EQ (M1) + compresor (Fase 6.1). `comp` null = sin
// compresor en esta sección (el motor lo deja en bypass).
export interface ChannelEqRoute {
  orbit: number;
  source: string; // id del Source (para su medidor de compresión)
  low: number;
  mid: number;
  high: number;
  midFreq: number;
  comp: { thr: number; ratio: number; att: number; rel: number; makeup: number } | null;
  sends: { rev: number; del: number }; // envíos a los retornos compartidos (6.4), desde la tira
  autoSends?: boolean; // los envíos tienen curva (7.2): la tira y los retornos hacen falta aunque estén en 0
}

export interface CompileResult {
  code: string | null;
  error: string | null;
  spans: SourceSpan[];
  channelEqs: ChannelEqRoute[];
  dropped: string[]; // nombres de fuentes AISLADAS por código roto (ver sourceCompiles)
}

// Tokens que NO aparecen en la mini-notación de Strudel y sí en código roto/malicioso
// (escape del sandbox de `sourceCompiles`, que EJECUTA el código con un proxy). NO incluye
// `=>`: las funciones flecha SÍ son válidas en patrones Strudel (p.ej. .every(4, x=>x.rev())).
const DANGER_SRC = /\b(import|require|eval|Function|constructor|__proto__|prototype|globalThis|window|document|process|XMLHttpRequest|fetch|localStorage|cookie)\b/;

// ¿el código de una fuente PARSEA (y ejecuta con un proxy inofensivo)? Un source con
// sintaxis rota (paréntesis/comillas sin cerrar — típico al pegar código de otra IA)
// rompería el `stack(...)` ENTERO al evaluar → SILENCIO TOTAL. Detectarlo aquí permite
// AISLAR esa sola fuente (suena `silence`) y dejar sonar el resto. Solo juzga sintaxis,
// no la semántica de Strudel (una escala inválida solo se ve al evaluar de verdad).
function sourceCompiles(code: string): boolean {
  if (!code || code.length > 8000) return false;
  if (DANGER_SRC.test(code)) return false;
  try {
    const proxy: unknown = new Proxy(function () {}, { get: () => proxy, apply: () => proxy });
    const env = new Proxy({}, { has: () => true, get: (_t, k) => (k === Symbol.unscopables ? undefined : proxy) });
    // eslint-disable-next-line no-new-func
    new Function('__env', 'with(__env){ return (\n' + code + '\n) }')(env);
    return true;
  } catch {
    return false;
  }
}

// Expresión compilada: su texto y los spans de los Source que contiene,
// relativos al inicio del texto (offset 0).
interface Expr {
  text: string;
  spans: SourceSpan[];
}

type N = Node<NodeData>;

function shift(spans: SourceSpan[], delta: number): SourceSpan[] {
  return spans.map((s) => ({ nodeId: s.nodeId, start: s.start + delta, end: s.end + delta }));
}

// Combina varias expresiones en un stack(...) ajustando los offsets de los spans.
function combine(inputs: Expr[]): Expr {
  if (inputs.length === 1) return inputs[0];
  let text = 'stack(';
  const spans: SourceSpan[] = [];
  inputs.forEach((e, i) => {
    if (i > 0) text += ', ';
    spans.push(...shift(e.spans, text.length));
    text += e.text;
  });
  text += ')';
  return { text, spans };
}

function incomingMap(edges: Edge[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    const arr = m.get(e.target) ?? [];
    arr.push(e.source);
    m.set(e.target, arr);
  }
  return m;
}

function hasCycle(nodes: N[], edges: Edge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.source)?.push(e.target);
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const nxt of adj.get(id) ?? []) if (visit(nxt)) return true;
    state.set(id, 2);
    return false;
  };
  for (const n of nodes) if (visit(n.id)) return true;
  return false;
}

// ¿El valor es un número plano (ej. "800") o una expresión-señal (ej.
// "sine.range(200,2000).slow(8)")? Si no es un número simple, lo tratamos como
// señal de automatización y lo emitimos CRUDO → el filtro se modula y "vuelve a
// la normalidad" solo. (pilar de automatización del modo híbrido)
export function isPlainNumber(s: string): boolean {
  return /^-?\d*\.?\d+$/.test(s.trim());
}

// Emite el argumento de un parámetro numérico: número literal o señal cruda.
function emitNumeric(v: unknown): string {
  const s = String(v ?? '').trim();
  if (s === '') return '0';
  if (isPlainNumber(s)) return s;
  return `(${s})`; // expresión-señal, entre paréntesis por seguridad
}

// Macros maestros de la capa de performance, aplicados como sufijo al patrón
// maestro (no desplazan los spans, que están al inicio del código).
export interface MasterFx {
  gain: number; // 0..1.5
  filter: number; // -1..1 : <0 lpf que baja, >0 hpf que sube (filtro DJ)
  room: number; // 0..0.8 reverb send
  space?: string; // IR del reverb ('' = algorítmico; 'ir_hall'/'ir_plate'/… = convolución)
  // macros creativos del master (opcionales: el gain/filtro de canal reusa este tipo).
  drive?: number; // 0..1 saturación (shape)
  delay?: number; // 0..1 envío de eco
  crush?: number; // 0..1 lo-fi (0=limpio, 1=destruido) → bits 16→4
  // FX de performance MOMENTÁNEOS (DJ): se sostienen mientras pulsas el botón.
  roll?: number; // 0=off · 2/4/8/16 → loop roll / stutter (.ply)
  gate?: number; // 0=off · tasa de corte rítmico (gate)
  rev?: boolean; // reverse throw del ciclo
  half?: number; // ½ TIEMPO: ciclo ANCLA (en la rejilla de pulsos) desde el que todo va a media velocidad · 0 = off
  // GROOVE global: swing (retrasa los off-beats) + humanize (micro-random de tiempo
  // y ganancia) → que todo "pegue" al grid con vida, no robótico.
  swing?: number; // 0..0.6 cantidad de swing (0 = recto), sobre semicorcheas
  humanize?: number; // 0..1 micro-variación aleatoria de tiempo/volumen
  // BUS DE MÁSTER (no se emiten en el código; los aplica el motor sobre el bus real):
  // limiter (evita clipping + loudness) y EQ 3 bandas en dB.
  limit?: number; // 0..1 limiter del máster (0 = off)
  glue?: number; // 0..1 glue-comp del bus (compresor gentil que "pega" la mezcla)
  sat?: number; // 0..1 saturador del bus (WaveShaper oversampled → calor analógico)
  width?: number; // 0..2 ancho estéreo Mid-Side (1 = normal, 0 = mono, 2 = ancho)
  punch?: number; // −1..1 transient shaper (>0 realza ataque, <0 lo suaviza)
  eqLow?: number; // −12..+12 dB (shelf graves)
  eqMid?: number; // −12..+12 dB (peak medios)
  eqHigh?: number; // −12..+12 dB (shelf agudos)
  // RETORNOS COMPARTIDOS (Fase 6.4): reverb y eco a tempo con su EQ y su nivel. Los aplica el
  // motor (audio/fxReturns.ts), no el código: no recompilan. Rangos y valores: lib/returns.ts.
  rvSpace?: string;
  rvLevel?: number;
  rvPre?: number;
  rvLow?: number;
  rvHigh?: number;
  dlNote?: number;
  dlFb?: number;
  dlLow?: number;
  dlHigh?: number;
  dlLevel?: number;
}

// ¿La fuente es un SAMPLE (s("kick")) o un OSCILADOR (note()/s("sawtooth"))? Un
// sample pasa por la MISMA cadena de shaping (filtro/envolvente/fx) pero NO se le
// impone una forma de onda (eso lo convertiría en oscilador y perdería la muestra),
// y en su lugar admite controles de reproducción de sample (velocidad/reversa/chop/loop).
export function isSampleSource(code: string): boolean {
  const m = /\bs(?:ound)?\(\s*["'`]([^"'`]+)/.exec(code || '');
  const first = m ? m[1].match(/[A-Za-z0-9_]+/)?.[0] : null;
  if (!first) return false; // sin s(...) (solo note()) → oscilador
  return !(SYNTH_WAVES as readonly string[]).includes(first);
}

// Aplica los parámetros de synth como sufijos al patrón (Fase 4). ADAPTATIVO: si la
// fuente es un SAMPLE, no le pone oscilador ni note — le aplica reproducción de sample
// (velocidad/reversa/troceo/loop) + el mismo shaping (filtro/envolvente/fx). No desplaza
// el span del Source porque se añade tras el código.
function applySynth(code: string, syn: SynthParams): string {
  const n = (v: number | undefined, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
  const sample = isSampleSource(code);
  let out = code;
  if (!sample) {
    // --- OSCILADOR A: forma de onda + morph (wavetable) + unísono + ruido + FM ---
    // Los sufijos de OSC A se acumulan en `a` (no en `out`) para poder envolverlo en un
    // stack() con las capas extra del multi-oscilador (abajo).
    let a = '';
    if (syn.wave) a += `.s("${syn.wave}")`;
    // MORPH: tablas telar_* de fábrica, o la ONDA PROPIA con >1 cuadro (barrido con .wt).
    const morph = isMorphWave(syn.wave) || (isUserWave(syn.wave) && userFrames(syn.userWave).length > 1);
    // WAVETABLE de MORPH: posición del barrido entre cuadros. Patroneable (texto, el
    // diferencial de Telar) tiene prioridad sobre el valor estático.
    if (morph) {
      const pat = (syn.wtpat || '').trim();
      a += pat ? `.wt("${pat}")` : `.wt(${n(syn.wtpos, 0).toFixed(3)})`;
    }
    if (syn.wave === 'supersaw') {
      const unison = Math.round(n(syn.unison, 5));
      if (unison > 1) a += `.unison(${unison})`;
      const detune = n(syn.detune, 0.18);
      if (detune > 0.001) a += `.detune(${detune.toFixed(3)})`;
      const spread = n(syn.spread, 0);
      if (spread > 0.001) a += `.spread(${spread.toFixed(2)})`;
    } else if (morph) {
      // El oscilador wavetable soporta el MISMO unísono (voces/detune/spread). detune/spread
      // no hacen nada con 1 voz → se emiten SOLO al engordar (voces>1), dejando el morph puro por defecto.
      const unison = Math.round(n(syn.unison, 1));
      if (unison > 1) {
        a += `.unison(${unison})`;
        const detune = n(syn.detune, 0.18);
        if (detune > 0.001) a += `.detune(${detune.toFixed(3)})`;
        const spread = n(syn.spread, 0);
        if (spread > 0.001) a += `.spread(${spread.toFixed(2)})`;
      }
    }
    const noise = n(syn.noise, 0);
    if (noise > 0.001) a += `.noise(${noise.toFixed(2)})`;
    // ancho de pulso (timbre de la onda cuadrada/pulso; base de PWM)
    const pw = n(syn.pw, 0.5);
    if (Math.abs(pw - 0.5) > 0.001) a += `.pw(${pw.toFixed(3)})`;
    // FM (operador: índice + ratio + forma de onda del modulador + envolvente del índice)
    const fm = n(syn.fm, 0);
    if (fm > 0.01) {
      a += `.fm(${fm.toFixed(2)})`;
      const fmh = n(syn.fmh, 1);
      if (Math.abs(fmh - 1) > 0.001) a += `.fmh(${fmh.toFixed(2)})`;
      if (syn.fmwave && syn.fmwave !== 'sine') a += `.fmwave("${syn.fmwave}")`;
      const fa = n(syn.fmattack, 0), fd = n(syn.fmdecay, 0), fs = n(syn.fmsustain, 1);
      if (fa > 0.001 || fd > 0.001 || fs < 0.999)
        a += `.fmattack(${fa.toFixed(3)}).fmdecay(${fd.toFixed(3)}).fmsustain(${fs.toFixed(2)})`;
    }
    // MULTI-OSCILADOR: capas extra (OSC B, Sub…) SUMADAS a OSC A en un stack(). Los sufijos
    // compartidos de abajo (envolvente/filtro/fx) se reparten a cada capa; como el filtro es
    // LINEAL, filtrar cada capa por igual ≡ filtrar la suma (= multi-osc de Serum). El nivel por
    // capa va en .gain (sobrevive: el gain de NODO se aplica con .mul(gain())). Sin capas: 1 onda.
    const layers = (Array.isArray(syn.oscLayers) ? syn.oscLayers : []).filter((l) => l && l.wave && n(l.level, 0) > 0.001);
    if (layers.length > 0) {
      const layerExpr = (wave: string, level: number, oct: number, det: number): string => {
        let s = `${code}.s("${wave}")`;
        const off = oct * 12 + det; // octava (×12) + desafinado fino, en semitonos
        if (Math.abs(off) > 0.0005) s += `.add(note(${off.toFixed(3)}))`;
        return s + `.gain(${level.toFixed(2)})`;
      };
      const parts = [`${code}${a}.gain(${n(syn.levelA, 1).toFixed(2)})`];
      for (const l of layers) parts.push(layerExpr(l.wave, n(l.level, 0.6), Math.round(n(l.octave, 0)), n(l.detune, 0)));
      out = `stack(${parts.join(', ')})`;
    } else {
      out += a;
    }
  } else {
    // --- SAMPLE: reproducción de la muestra (tras el .begin()/.end() ya inyectado) ---
    const chop = Math.round(n(syn.chop, 0));
    if (chop > 1) out += `.chop(${chop})`;
    // "loop" = repetir cada N ciclos. natural (.slow) = a su TEMPO REAL, sin varispeed
    // (manda el BPM del sample); 'beat' (.loopAt) = encaja al tempo del proyecto (varispeed,
    // cambia pitch). Ambos evitan el re-disparo/solape del sample largo.
    const loop = Math.round(n(syn.loop, 0) * 100) / 100;
    if (loop >= 1) out += syn.loopMode === 'beat' ? `.loopAt(${loop})` : `.slow(${loop})`;
    let sp = n(syn.speed, 1);
    if (syn.reverse) sp = -Math.abs(sp || 1); // superdough invierte el buffer con speed<0
    if (Math.abs(sp - 1) > 0.001 || syn.reverse) out += `.speed(${sp.toFixed(2)})`;
  }
  // envolvente de amplitud. En OSCILADOR siempre (la onda necesita envolvente); en
  // SAMPLE solo si el usuario la toca (para no imponer un envelope al sample crudo).
  const adsrTouched =
    Math.abs(n(syn.attack, 0.01) - 0.01) > 0.001 ||
    Math.abs(n(syn.decay, 0.12) - 0.12) > 0.001 ||
    Math.abs(n(syn.sustain, 0.6) - 0.6) > 0.001 ||
    Math.abs(n(syn.release, 0.2) - 0.2) > 0.001;
  if (!sample || adsrTouched)
    out += `.attack(${n(syn.attack, 0.01)}).decay(${n(syn.decay, 0.12)}).sustain(${n(syn.sustain, 0.6)}).release(${n(syn.release, 0.2)})`;
  // filtro: el env necesita un cutoff base que barrer
  let cut = n(syn.cutoff, 0);
  const lpenv = n(syn.lpenv, 0);
  if (lpenv > 0.01 && cut <= 20) cut = 800;
  if (cut > 20) {
    out += `.lpf(${Math.round(cut)})`;
    // tipo/pendiente del filtro: 12db (limpio) · ladder (Moog, resonante) · 24db (marcado)
    const ft = Math.round(n(syn.ftype, 0));
    if (ft > 0) out += `.ftype("${ft === 1 ? 'ladder' : '24db'}")`;
  }
  const q = n(syn.lpq, 0);
  if (q > 0) out += `.lpq(${q.toFixed(2)})`;
  if (lpenv > 0.01) {
    out += `.lpenv(${lpenv.toFixed(2)})`;
    const la = n(syn.lpa, 0);
    if (la > 0.001) out += `.lpattack(${la.toFixed(3)})`;
    const ld = n(syn.lpd, 0);
    if (ld > 0.001) out += `.lpdecay(${ld.toFixed(3)})`;
  }
  // filtro paso-alto: carva los graves (aire en pads, definición en leads)
  const hcut = n(syn.hcutoff, 0);
  if (hcut > 20) {
    out += `.hpf(${Math.round(hcut)})`;
    const hq = n(syn.hpq, 0);
    if (hq > 0) out += `.hpq(${hq.toFixed(2)})`;
  }
  // envolvente de PITCH: barrido en semitonos que decae (plucks, risers, kick tonal)
  const penv = n(syn.penv, 0);
  if (Math.abs(penv) > 0.01) {
    out += `.penv(${penv.toFixed(2)}).pdecay(${n(syn.pdecay, 0.1).toFixed(3)})`;
  }
  // vibrato
  const vib = n(syn.vib, 0);
  if (vib > 0.01) {
    out += `.vib(${vib.toFixed(2)})`;
    const vm = n(syn.vibmod, 0);
    if (vm > 0.001) out += `.vibmod(${vm.toFixed(2)})`;
  }
  // phaser: movimiento estéreo barriendo el timbre (firma de pads/estéreo amplio)
  const phaser = n(syn.phaser, 0);
  if (phaser > 0.01) {
    out += `.phaser(${phaser.toFixed(2)})`;
    const pd = n(syn.phaserdepth, 0.6);
    if (Math.abs(pd - 0.75) > 0.001) out += `.phaserdepth(${pd.toFixed(2)})`;
  }
  // ESPACIO (envíos): reverb (con tamaño) + eco con realimentación. Los pads viven aquí.
  const room = n(syn.room, 0);
  if (room > 0.001) {
    out += `.room(${room.toFixed(2)})`;
    const rs = n(syn.roomsize, 2);
    if (rs > 0.01 && Math.abs(rs - 1) > 0.001) out += `.roomsize(${rs.toFixed(1)})`;
  }
  const delay = n(syn.delay, 0);
  if (delay > 0.001) {
    out += `.delay(${delay.toFixed(2)}).delayfeedback(${n(syn.delayfb, 0.4).toFixed(2)})`;
    // tiempo del eco SINCRONIZADO al tempo (delaysync = fracción de ciclo; el motor
    // trae 3/16 = corchea con puntillo, el dub clásico). Solo se emite si difiere.
    const dsync = n(syn.delaysync, 3 / 16);
    if (Math.abs(dsync - 3 / 16) > 0.0001) out += `.delaysync(${Number(dsync.toFixed(4))})`;
  }
  // carácter: distorsión + reducción de muestreo
  const drive = n(syn.drive, 0);
  if (drive > 0.01) out += `.distort(${(drive * 3).toFixed(2)})`;
  const coarse = Math.round(n(syn.coarse, 1));
  if (coarse > 1) out += `.coarse(${coarse})`;
  // paneo (colocación estéreo)
  const pan = n(syn.pan, 0.5);
  if (Math.abs(pan - 0.5) > 0.01) out += `.pan(${pan.toFixed(2)})`;
  return out;
}

// Editor de voz: aplica los controles como sufijos sobre s("voz_…"). Tres modos:
//   • NATURAL (por defecto): la voz suena a su PITCH REAL. Usa .slow(span) para
//     darle su duración (no se corta ni se reactiva a destiempo). NO usa loopAt:
//     loopAt es varispeed (estira el sample para encajar N ciclos) → DESAFINA, y
//     además bucla sin parar. Ese era el bug del grabador ("se pitchea / no corta").
//   • GRANULAR (opcional, v.granular): loopAt+chop para texturas/grano (sí afina,
//     es el efecto buscado).
//   • MELÓDICO (v.melody): la voz "canta" una melodía con note()/scale (autotune).
// position→begin · speed→pitch manual · vowel→formante · shape→sat · room/delay→
// espacio · spread→paneo · gain.
function applyVoice(code: string, v: VoiceParams): string {
  const num = (x: number | undefined, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
  const c01 = (x: number) => Math.max(0, Math.min(1, x));
  const clean = (s: string) => s.replace(/["'`\\]/g, ' ').trim();
  let out = code;
  const pos = c01(num(v.position, 0));
  if (pos > 0.001) out += `.begin(${pos.toFixed(3)})`;
  const mel = clean(v.melody ?? '');
  const scale = clean(v.scale ?? '');
  const melodic = mel.length > 0;
  // si el código ya define su loop/troceo manual, respetamos eso (no duplicamos).
  const hasLoopCode = /\.(?:loopAt|chop|slice|slow)\s*\(/.test(code);
  if (melodic) {
    // Un sample sin metadatos tiene su pitch NATURAL en midi 36 = "c2" (superdough:
    // transpose = midi - 36). Si la melodía usa octavas altas (c4/c5) la voz se
    // reproduce octavas ARRIBA → chirrido casi inaudible ("no suena"). Por eso el
    // piano roll trabaja en octava 2 y aquí anclamos la ESCALA a la raíz en octava 2
    // (grado 0 = c2 = pitch natural). La carpeta de la voz tiene 1 sample → .n() sin
    // riesgo (módulo).
    if (scale) {
      const rooted = /\d/.test(scale) ? scale : scale.replace(/^([A-Ga-g][#bfs]?)/, (m) => m + '2');
      out += `.n("${mel}").scale("${rooted}")`;
    } else {
      out += `.note("${mel}")`;
    }
    // doblaje/armonía: convierte cada nota en un intervalo [0, h] (dyad) → coros.
    const harm = Math.round(num(v.harmony, 0));
    if (harm !== 0) out += `.add(note("[0,${harm}]"))`;
    // GLIDE/portamento: cada nota ENTRA con un barrido de pitch que decae (como el slide del
    // 808 en MelodicSeq) → sensación de deslizamiento entre notas ("autotune suave"). Antes se
    // emitía `.slide()`, que superdough SOLO lee en el synth zzfx → INERTE para la voz (sample);
    // `penv/pdecay` SÍ actúa sobre samples re-pitcheados por note()/n(). Barrido desde abajo
    // (scoop): 1..4 semitonos, decae en ~30..150 ms según la cantidad de glide.
    const glide = c01(num(v.glide, 0));
    if (glide > 0.01) out += `.penv(${(-(1 + glide * 3)).toFixed(2)}).pdecay(${(0.03 + glide * 0.12).toFixed(3)})`;
  } else if (v.tempo && !hasLoopCode) {
    // AL TEMPO: encaja la voz en N ciclos (loopAt = varispeed). loopAt lee el cps EN
    // VIVO (_loopAt usa state.controls._cps), así que la voz sigue los cambios de BPM
    // y queda pegada al grid. El tono acompaña a la velocidad (sampler clásico); para
    // recuperar la altura, la perilla "afinar" (stretch) actúa aparte.
    const cyc = Math.max(1, Math.round(num(v.tempoCycles, num(v.loop, 1))));
    out += `.loopAt(${cyc})`;
  } else if (v.granular && !hasLoopCode) {
    // granular (opt-in): loopAt estira a N ciclos (afina) + chop = grano.
    const loop = Math.max(1, Math.round(num(v.loop, 1)));
    out += `.loopAt(${loop})`;
    const grain = Math.max(1, Math.round(num(v.grain, 8)));
    if (grain > 1) out += `.chop(${grain})`;
  } else if (!hasLoopCode) {
    // natural: pitch real. .slow(span) reparte el disparo a la duración del sample.
    const span = Math.max(1, Math.round(num(v.loop, 1)));
    if (span > 1) out += `.slow(${span})`;
  }
  const speed = num(v.speed, 1);
  if (Math.abs(speed - 1) > 0.001) out += `.speed(${speed.toFixed(2)})`;
  // VIBRATO vocal (LFO sobre el detune del sample): da vida a la voz. Ahora se aplica a
  // CUALQUIER voz (con o sin melodía), no solo a las notas del piano roll.
  const vib = num(v.vibrato, 0);
  if (vib > 0.01) {
    out += `.vib(${Math.min(8, vib).toFixed(2)})`;
    const vd = num(v.vibratoDepth, 0.3);
    if (vd > 0.001) out += `.vibmod(${Math.min(2, vd).toFixed(2)})`;
  }
  // AFINAR: pitch-shift espectral en SEMITONOS, independiente de la velocidad (control
  // `stretch` = phase-vocoder). El worklet mapea el valor `raw` a un factor de pitch:
  // raw>=0 → pf = raw+1 ; raw<0 → pf = raw*0.25+1. Para lograr pf = 2^(semi/12) exacto
  // (subir/bajar `semi` semitonos) usamos una fórmula por tramos. Añade latencia y CPU,
  // por eso solo se emite cuando hay afinado real.
  const semi = num(v.pitchShift, 0);
  if (Math.abs(semi) > 0.01) {
    const pf = Math.pow(2, Math.max(-24, Math.min(24, semi)) / 12);
    const raw = pf >= 1 ? pf - 1 : (pf - 1) * 4;
    out += `.stretch(${raw.toFixed(3)})`;
  }
  if (v.vowel) out += `.vowel("${v.vowel}")`;
  // PULIR: cadena de voz "pro" — paso-alto quita el retumbe/pops graves + compresor
  // nivela la dinámica (la voz "se sienta" en la mezcla). +postgain para recuperar nivel.
  if (v.polish) out += `.hpf(110).compressor("-18:3:6:0.005:0.12").postgain(1.4)`;
  const shape = c01(num(v.shape, 0));
  if (shape > 0.001) out += `.shape(${Math.min(0.95, shape).toFixed(2)})`;
  const room = c01(num(v.room, 0));
  if (room > 0.001) out += `.room(${room.toFixed(2)})`;
  const delay = c01(num(v.delay, 0));
  if (delay > 0.001) {
    out += `.delay(${delay.toFixed(2)})`;
    // tiempo del eco al tempo (dub): solo se emite si difiere del 3/16 del motor.
    const dsync = num(v.delaysync, 3 / 16);
    if (Math.abs(dsync - 3 / 16) > 0.0001) out += `.delaysync(${Number(dsync.toFixed(4))})`;
  }
  const spread = c01(num(v.spread, 0));
  if (spread > 0.001)
    out += `.pan(sine.range(${(0.5 - spread / 2).toFixed(2)}, ${(0.5 + spread / 2).toFixed(2)}).slow(4))`;
  // nivel de la voz: como el fader, multiplica la velocity (continuo en 1 y no pisa un gain propio)
  const gain = num(v.gain, 1);
  if (Math.abs(gain - 1) > 0.001) out += `.mul(velocity(${+gain.toFixed(3)}))`;
  return out;
}

// COMPONER, NO PISAR (verificado contra @strudel/core): cada control vale UNA vez por
// voz y un sufijo posterior PISA el valor propio de la voz — `.lpf(300).lpf(6372)` deja
// 6372 (un «paso-bajo» que ABRE un bajo oscuro) y `.room(0.6).room(0.1)` deja 0.1 (subir
// la reverb SECA una voz húmeda). Los FX de mezcla se combinan con el valor de la voz en
// un solo `.fmap`: lpf → min(propio, X) · hpf → max(propio, X) · room/delay →
// 1−(1−propio)(1−X) (el envío solo suma) · crush → min(bits propios, X).
// Object.assign (ES5) a propósito: pasa por el transpiler de Strudel sin sorpresas.
function composeFx(parts: string[]): string {
  return parts.length ? `.fmap(v=>Object.assign({},v,{${parts.join(',')}}))` : '';
}

// MÁSTER GLOBAL (sobre el stack entero). El FILTRO y el DRIVE del máster viven en el BUS
// Web Audio (engine.applyMasterBus: djHP/djLP/djDrive) → afectan toda la mezcla al
// instante, sin recompilar; por eso aquí van en 0. Lo demás (groove, roll/gate/rev,
// gain) se emite en código, y crush/eco/reverb COMPUESTOS con los de cada voz.
export function applyGlobalMaster(code: string, m: MasterFx): string {
  return applyMaster(code, { ...m, filter: 0 }, { composeSends: true });
}

// TOCAR DESDE UN COMPÁS (Modo DAW, Fase 1.4): el transporte se reinicia (ciclo 0) y TODO el
// grafo se adelanta `from` compases → en el ciclo 0 suena el compás `from + 1`, arrange de
// cada instrumento incluidos (1 ciclo = 1 compás). Va POR DENTRO del máster global: el ancla
// del ½ tiempo y el swing viven en el reloj del scheduler, no en el de la canción. Con from 0
// el código queda idéntico. El salto de línea protege de un `//` final en el código.
export function applyStartBar(code: string, from: number): string {
  const f = Math.floor(Number(from));
  return Number.isFinite(f) && f > 0 ? `(${code}\n).early(${f})` : code;
}

// LÍNEA DE TIEMPO (Fase 2.4): con el LOOP DE REGIÓN activo el grafo entero repite esos
// compases (`.ribbon(inicio, compases)`; `.early(off)` si se arrancó dentro de la región);
// si no, «tocar desde un compás» (applyStartBar). También por DENTRO del máster global.
export function applyTimeline(
  code: string,
  t: { from: number; region: { start: number; bars: number } | null; regionOn: boolean; stopAt?: number | null },
): string {
  const r = t.region;
  let out: string;
  if (t.regionOn && r && r.bars >= 1) {
    const start = Math.max(0, Math.floor(r.start));
    const bars = Math.max(1, Math.floor(r.bars));
    const off = Math.floor(Number(t.from)) - start;
    const tail = off > 0 && off < bars ? `.early(${off})` : '';
    out = `(${code}\n).ribbon(${start}, ${bars})${tail}`;
  } else out = applyStartBar(code, t.from);
  // EXPORTAR (Fase 3.3): pasado `stopAt` (ciclos del transporte) no arranca ningún evento
  // nuevo → la grabación termina con las colas, sin la vuelta siguiente de la canción.
  if (t.stopAt != null && Number.isFinite(t.stopAt) && t.stopAt > 0) out = `(${out}).filterHaps((h)=>!h.whole||h.whole.begin<${Number(t.stopAt.toFixed(4))})`;
  return out;
}

// Los FX MOMENTÁNEOS del máster (se sostienen mientras pulsas) nunca sobreviven a una carga:
// un roll «pegado» al recargar, o un ancla vieja de ½ tiempo que se dispararía sola minutos
// después, serían fallos en vivo.
export function releaseMomentary(m: MasterFx): MasterFx {
  return { ...m, roll: 0, gate: 0, rev: false, half: 0 };
}

// El máster SIN los momentáneos: lo que guarda/aplica una ESCENA. Capturar mientras sostienes
// un pad no debe dejarlo «grabado» (al dispararla se pegaría un roll, o un ½ tiempo con un
// ancla vieja), y disparar una escena no debe cortar el pad que tienes apretado.
export function withoutMomentary(m: Partial<MasterFx>): Partial<MasterFx> {
  const out: Partial<MasterFx> = { ...m };
  delete out.roll;
  delete out.gate;
  delete out.rev;
  delete out.half;
  return out;
}

export function applyMaster(code: string, m: MasterFx, opts: { composeSends?: boolean } = {}): string {
  let out = code;
  // ½ TIEMPO (momentáneo): desde el ciclo ANCLA A (un pulso, fijado al pulsar) todo suena a
  // media velocidad SIN saltar: p(A + (t−A)/2) = p.early(A/2).slow(2). Antes de A, el patrón
  // normal (lo ya agendado no cambia). Al soltar vuelve a p(t): la canción sigue en su sitio,
  // como el «slip» de un DJ. Va PRIMERO para que roll/gate/rev actúen encima a tempo real.
  // Guarda `!h.whole`: un hap sin whole jamás debe romper la consulta (= silencio).
  const half = Number(m.half) || 0;
  if (half > 0) {
    const a = Math.round(half * 4) / 4; // siempre en la rejilla de pulsos (1/4 de ciclo)
    out = `((p)=>stack(p.filterHaps((h)=>!h.whole||h.whole.begin<${a}),p.early(${a / 2}).slow(2).filterHaps((h)=>!h.whole||h.whole.begin>=${a})))(${out})`;
  }
  // GROOVE primero (afecta el TIEMPO de los eventos): swing (.swingBy) + humanize
  // (micro-retraso y micro-dinámica aleatorios por evento con la señal `rand`).
  // Recto y robótico si ambos son 0.
  //
  // OJO semántica de controles (verificado en @strudel/core): dos `.gain()` (o dos
  // `.velocity()`) encadenados NO se multiplican — el 2º PISA al 1º (controls.mjs
  // combina con `set`). Por eso aquí toda ganancia de MEZCLA se emite con `.mul(…)`:
  // multiplica la clave si el evento ya la trae y la fija si no existe.
  // Y va sobre VELOCITY, no sobre gain: superdough suena a `gain × velocity` con gain
  // 0,8 y velocity 1 por defecto. `.mul(gain(x))` sobre un evento SIN gain lo fijaba en x
  // (no 0,8·x): el fader saltaba +1,9 dB al pasar de 1,00 a 0,99 y desequilibraba un kit
  // (el bombo sin gain subía; la caja con `.gain(0.85)` no). `.mul(velocity(x))` escala
  // TODO el canal por x, tenga o no gain: fader continuo y balance interno intacto.
  // P0.2: swingBy(x, n) = n rebanadas por ciclo, retrasa la 2ª mitad de cada una.
  // n=8 → swing de SEMICORCHEAS con el compás estándar de 16 pasos (el tumbao del
  // dembow/dancehall). El n=4 anterior swingueaba corcheas (subdivisión equivocada).
  if (m.swing && m.swing > 0.01) out = `${out}.swingBy(${Math.min(0.6, m.swing).toFixed(2)}, 8)`;
  if (m.humanize && m.humanize > 0.01) {
    // timing CENTRADO (±h/2): la variación rodea el grid; el rango (0,h) anterior
    // arrastraba el patrón entero hacia tarde. (P1.2)
    const h = Math.min(1, m.humanize);
    out = `${out}.late(rand.range(${(-h * 0.01).toFixed(3)}, ${(h * 0.01).toFixed(3)})).mul(velocity(rand.range(${(1 - h * 0.35).toFixed(2)}, 1)))`;
  }
  // FX de performance momentáneos (afectan tiempo/estructura del máster):
  // reverse, loop roll (.ply repite cada evento) y gate rítmico (gain cuadrada,
  // multiplicativa para no pisar el balance mientras corta).
  if (m.rev) out = `${out}.rev()`;
  if (m.roll && m.roll > 1) out = `${out}.ply(${Math.round(m.roll)})`;
  if (m.gate && m.gate > 0) out = `${out}.mul(velocity(square.range(0, 1).fast(${Math.round(m.gate)})))`;
  // macros creativos (saturación → lo-fi → eco), antes del filtro/room/gain.
  // CLAMP DEFENSIVO a rango válido: un proyecto IMPORTADO (otra IA, JSON a mano) puede
  // traer valores que la UI jamás produce y que ROMPEN/silencian la salida — p.ej.
  // filter:-2 → lpf(1 Hz) = MUDO, crush:2 → crush(-8) inválido. La UI ya acota; esto
  // protege las demás vías (CLAUDE.md §4: nunca dejar que un cambio silencie la salida).
  // Es no-op para valores en rango → los proyectos normales suenan idéntico.
  const mCrush = Math.max(0, Math.min(1, m.crush ?? 0));
  const mDelay = Math.max(0, Math.min(1, m.delay ?? 0));
  const mRoom = Math.max(0, Math.min(0.95, m.room ?? 0));
  // FILTRO DE CANAL (DJ, −1..1: <0 paso-bajo, >0 paso-alto): lo pasa cada Source con su
  // chFilter (deck DJ, perilla del nodo, escenas, MIDI). El máster GLOBAL llega aquí con
  // filter 0 — su filtro y su drive viven en el BUS Web Audio (ver applyGlobalMaster).
  // COMPUESTO con el filtro propio de la voz (composeFx): un paso-bajo nunca ABRE un
  // bajo que ya era oscuro, un paso-alto nunca BAJA el corte de unos hats ya finos.
  const mFilter = Math.max(-1, Math.min(1, m.filter ?? 0));
  const comp: string[] = [];
  if (mFilter < -0.02) comp.push(`cutoff:Math.min(+v.cutoff||20000,${Math.round(18000 * Math.pow(100 / 18000, -mFilter))})`);
  else if (mFilter > 0.02) comp.push(`hcutoff:Math.max(+v.hcutoff||0,${Math.round(20 * Math.pow(5000 / 20, mFilter))})`);
  // ECO / REVERB / CRUSH. En el máster GLOBAL se COMPONEN con lo que cada voz ya trae:
  // como sufijo pisaban → la perilla de reverb a 0.3 SECABA unas aves con room 0.6 (y el
  // eco igual); ahora solo suman. En el CANAL (chRoom/wash de cada Source) siguen como
  // envío único que fija el valor (diseño V3: el throw de wash manda).
  if (opts.composeSends) {
    if (mCrush > 0.02) comp.push(`crush:Math.min(+v.crush||16,${(16 - mCrush * 12).toFixed(1)})`);
    if (mDelay > 0.02) comp.push(`delay:1-(1-(+v.delay||0))*${(1 - mDelay).toFixed(2)}`);
    if (mRoom > 0.02) comp.push(`room:1-(1-(+v.room||0))*${(1 - mRoom).toFixed(2)}`);
  }
  out += composeFx(comp);
  if (!opts.composeSends) {
    if (mCrush > 0.02) out = `${out}.crush(${(16 - mCrush * 12).toFixed(1)})`;
    if (mDelay > 0.02) out = `${out}.delay(${mDelay.toFixed(2)})`;
    if (mRoom > 0.02) out = `${out}.room(${mRoom.toFixed(2)})`;
  }
  if (mRoom > 0.02) {
    // espacio por IR (convolución real): usa la muestra como respuesta al impulso.
    // roomsize DEBE ser la duración exacta del IR: superdough reconstruye el buffer
    // con adjustLength(roomsize, ir) — si roomsize>dur BUCLEA el IR (eco fantasma) y
    // si roomsize<dur lo TRUNCA (cola cortada). irRoomsize() da la duración medida
    // (IR real) o tabulada (sintético). knownIr evita emitir `.ir()` sobre una
    // muestra ausente (p.ej. IR de usuario no recargado) → cae a reverb algorítmico.
    if (m.space && knownIr(m.space)) out = `${out}.ir("${m.space}").roomsize(${irRoomsize(m.space)})`;
  }
  // fader (de canal o del máster): multiplica la velocity (ver arriba) — respeta acentos,
  // velocity internos y el gain por defecto de superdough. Hasta 3 decimales («dejar margen»).
  const mGain = Math.max(0, Math.min(4, m.gain ?? 1));
  if (Math.abs(mGain - 1) > 0.001) out = `${out}.mul(velocity(${+mGain.toFixed(3)}))`;
  return out;
}

// Rango VÁLIDO de cada campo del máster (el que produce la UI de Telar). Un proyecto
// IMPORTADO (otra IA / JSON a mano) puede traer valores fuera de rango que suenan raro o
// silencian (p.ej. filter:-2 → lpf a 1 Hz = mudo, crush:2 → crush negativo). Se acotan AL
// CARGAR y se avisa, para que la perilla muestre un valor sano y el usuario afine desde
// ahí. (applyMaster además clampa en render como red de seguridad — esto es la capa de UX.)
const MASTER_RANGES: { key: keyof MasterFx; min: number; max: number; def: number; label: string }[] = [
  { key: 'gain', min: 0, max: 1.5, def: 1, label: 'ganancia' },
  { key: 'filter', min: -1, max: 1, def: 0, label: 'filtro' },
  { key: 'room', min: 0, max: 0.8, def: 0, label: 'reverb' },
  { key: 'drive', min: 0, max: 1, def: 0, label: 'saturación' },
  { key: 'delay', min: 0, max: 1, def: 0, label: 'eco' },
  { key: 'crush', min: 0, max: 1, def: 0, label: 'crush' },
  { key: 'roll', min: 0, max: 16, def: 0, label: 'roll' },
  { key: 'gate', min: 0, max: 16, def: 0, label: 'gate' },
  { key: 'swing', min: 0, max: 0.6, def: 0, label: 'swing' },
  { key: 'humanize', min: 0, max: 1, def: 0, label: 'humanize' },
  { key: 'limit', min: 0, max: 1, def: 0, label: 'limitador' },
  { key: 'glue', min: 0, max: 1, def: 0, label: 'glue' },
  { key: 'sat', min: 0, max: 1, def: 0, label: 'saturador de bus' },
  { key: 'width', min: 0, max: 2, def: 1, label: 'ancho' },
  { key: 'rvLevel', min: RETURN_RANGES.rvLevel[0], max: RETURN_RANGES.rvLevel[1], def: DEFAULT_RETURNS.rvLevel, label: 'nivel del retorno de reverb' },
  { key: 'rvPre', min: RETURN_RANGES.rvPre[0], max: RETURN_RANGES.rvPre[1], def: DEFAULT_RETURNS.rvPre, label: 'pre-delay de la reverb' },
  { key: 'rvLow', min: RETURN_RANGES.rvLow[0], max: RETURN_RANGES.rvLow[1], def: DEFAULT_RETURNS.rvLow, label: 'corte de graves de la reverb' },
  { key: 'rvHigh', min: RETURN_RANGES.rvHigh[0], max: RETURN_RANGES.rvHigh[1], def: DEFAULT_RETURNS.rvHigh, label: 'corte de agudos de la reverb' },
  { key: 'dlNote', min: RETURN_RANGES.dlNote[0], max: RETURN_RANGES.dlNote[1], def: DEFAULT_RETURNS.dlNote, label: 'división del eco' },
  { key: 'dlFb', min: RETURN_RANGES.dlFb[0], max: RETURN_RANGES.dlFb[1], def: DEFAULT_RETURNS.dlFb, label: 'realimentación del eco' },
  { key: 'dlLow', min: RETURN_RANGES.dlLow[0], max: RETURN_RANGES.dlLow[1], def: DEFAULT_RETURNS.dlLow, label: 'corte de graves del eco' },
  { key: 'dlHigh', min: RETURN_RANGES.dlHigh[0], max: RETURN_RANGES.dlHigh[1], def: DEFAULT_RETURNS.dlHigh, label: 'corte de agudos del eco' },
  { key: 'dlLevel', min: RETURN_RANGES.dlLevel[0], max: RETURN_RANGES.dlLevel[1], def: DEFAULT_RETURNS.dlLevel, label: 'nivel del retorno de eco' },
];
const fmtN = (n: number): string => String(Number(n.toFixed(2)));

// Normaliza los campos del máster de un import y describe qué se cambió (para el aviso).
// Un valor FUERA de rango casi siempre es "la otra IA no entendió la escala del parámetro",
// no un extremo a propósito → se RESETEA al NEUTRO (default de la UI), no al borde: filter
// -2 clampeado a -1 daba lpf(100 Hz), que sigue casi mudo en altavoces de laptop; resetear
// a 0 (sin filtro) lo deja sonando de verdad. NO-OP para proyectos normales (todo en rango).
export function sanitizeMasterFx(m: MasterFx): { master: MasterFx; notes: string[] } {
  const master: MasterFx = { ...m };
  const notes: string[] = [];
  for (const { key, min, max, def, label } of MASTER_RANGES) {
    const v = master[key];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    if (v < min || v > max) {
      (master[key] as number) = def;
      notes.push(`${label} ${fmtN(v)}→${fmtN(def)} (neutro)`);
    }
  }
  return { master, notes };
}

// Opciones globales de compilación (capa de transporte/performance).
export interface CompileOpts {
  transpose?: number; // semitonos globales ("tono"): se suma SOLO a fuentes con note(…)
  xfader?: number; // crossfader DJ 0..1 (0 = todo A, 1 = todo B); afecta el gain de los decks asignados
  songBars?: number; // compases de la canción: las curvas de automatización se repiten con ella (Fase 3.1)
  // STEM (Fase 3.4): solo suena ESTA pista (con sus FX, sus secciones y lo que las escenas le
  // hagan, igual que en la mezcla); las demás callan — los bombos que disparan un sidechain
  // siguen disparándolo en silencio para que el stem bombee como en la mezcla.
  only?: string | null;
  // CANCIÓN HORNEADA (Fase 4.1): orbits FIJOS para todas las secciones — cada sección se compila
  // con la mezcla de su escena y todas deben mandar cada pista al MISMO bus (si no, el EQ por
  // canal y las colas de reverb cambiarían de pista al pasar de sección). Sin plan: como siempre.
  orbitPlan?: OrbitPlan;
  // false = sin `.analyze()` (los medidores en vivo): el render offline corre en OTRO contexto de
  // audio y no puede conectarse a los analizadores del contexto en vivo.
  analyze?: boolean;
}

// Orbits fijos (Fase 4.1): sidechain duck por id del nodo fx, EQ por canal por id del source.
export interface OrbitPlan {
  sidechain: Map<string, number>;
  eq: Map<string, number>;
}

// Nodos sidechain en modo duck con un disparador válido (los que reciben un orbit propio).
export function duckSidechainIds(nodes: N[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const n of nodes) {
    if (n.data.kind !== 'fx' || n.data.opId !== 'sidechain') continue;
    if (String(n.data.params?.mode ?? 'gen') !== 'duck') continue;
    const trig = String(n.data.params?.trigger ?? '');
    const t = byId.get(trig);
    if (!trig || !t || t.data.kind !== 'source') continue;
    out.push(n.id);
  }
  return out;
}

// Sources con tira de canal activa (EQ, compresor o envíos a los retornos): reciben un orbit propio.
export function eqSourceIds(nodes: N[]): string[] {
  return nodes.filter((n) => n.data.kind === 'source' && (channelEqActive(n.data.eq) || channelCompActive(n.data.comp) || sendsActive(n.data.sends) || autoSendsActive(n.data.auto))).map((n) => n.id);
}
// ¿los envíos de la pista tienen curva de automatización? (7.2)
function autoSendsActive(auto: unknown): boolean {
  const a = cleanAuto(auto);
  return (!!a.rev && isActive(a.rev, 'rev')) || (!!a.del && isActive(a.del, 'del'));
}

const clampN = (x: unknown, a: number, b: number, d: number) => {
  const v = Number(x);
  return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d;
};
function compRoute(c: ChannelComp | undefined): ChannelEqRoute['comp'] {
  if (!channelCompActive(c)) return null;
  const d = DEFAULT_CHANNEL_COMP;
  return {
    thr: clampN(c!.thr, -60, 0, d.thr),
    ratio: clampN(c!.ratio, 1, 20, d.ratio),
    att: clampN(c!.att, 0.05, 500, d.att),
    rel: clampN(c!.rel, 5, 3000, d.rel),
    makeup: clampN(c!.makeup, -12, 30, d.makeup),
  };
}

// Ganancia de crossfader por lado (curva de potencia constante: ambos a −3 dB en el
// centro, como una mesa de DJ). asign 'a'|'b'|undefined; undefined = fuera del fader (1).
function xfaderGain(assign: 'a' | 'b' | undefined, pos: number): number {
  if (assign !== 'a' && assign !== 'b') return 1;
  const p = Math.max(0, Math.min(1, pos));
  return assign === 'a' ? Math.cos((p * Math.PI) / 2) : Math.sin((p * Math.PI) / 2);
}

export function compileGraph(nodes: N[], edges: Edge[], opts: CompileOpts = {}): CompileResult {
  const transpose = Math.round(opts.transpose ?? 0);
  const xfader = typeof opts.xfader === 'number' ? opts.xfader : 0.5;
  const outs = nodes.filter((n) => n.data.kind === 'out');
  if (outs.length === 0) return { code: null, error: 'sin nodo Out', spans: [], channelEqs: [], dropped: [] };
  if (hasCycle(nodes, edges)) return { code: null, error: 'ciclo en el grafo', spans: [], channelEqs: [], dropped: [] };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = incomingMap(edges);
  const memo = new Map<string, Expr | null>();
  let firstError: string | null = null;
  const droppedSources: string[] = []; // fuentes aisladas por código roto (fix aislamiento)

  // Solo de mixer: si AL MENOS un source está en solo, los sources NO soloed se
  // silencian (clásico de mesa de mezclas / DJ). El solo "gana" al mute implícito.
  const anySolo = nodes.some((n) => n.data.kind === 'source' && n.data.solo);

  // SIDECHAIN por DUCKING REAL (3a): cada nodo sidechain en modo 'duck' con una
  // fuente disparadora VÁLIDA obtiene un ORBIT propio (2,3,…). La rama que pasa por
  // ese sidechain se enruta a ese orbit (`.orbit K`) y la fuente disparadora (el
  // bombo) dispara el ducking de ese bus (`.duck K …`), así el pump lo genera el
  // kick REAL (no un LFO genérico). Un mismo disparador puede duckear varios orbits
  // (mininotación "2:3"). Sin disparador válido, el nodo cae al tremolo genérico.
  const sidechainOrbit = new Map<string, number>(); // fx nodeId → orbit asignado
  const duckByTrigger = new Map<string, { orbits: number[]; depth: number; attack: number }>();
  const plan = opts.orbitPlan;
  // con plan, los orbits libres empiezan después de TODOS los del plan (no chocan)
  let nextOrbit = plan ? Math.max(1, ...plan.sidechain.values(), ...plan.eq.values()) + 1 : 2; // 0/1 reservados al bus por defecto
  for (const n of nodes) {
    if (n.data.kind !== 'fx' || n.data.opId !== 'sidechain') continue;
    if (String(n.data.params?.mode ?? 'gen') !== 'duck') continue;
    const trig = String(n.data.params?.trigger ?? '');
    const trigNode = byId.get(trig);
    if (!trig || !trigNode || trigNode.data.kind !== 'source') continue; // → genérico
    const orbit = plan?.sidechain.get(n.id) ?? nextOrbit++;
    sidechainOrbit.set(n.id, orbit);
    const depth = Math.max(0.05, Math.min(1, Number(n.data.params?.depth ?? 0.7)));
    const attack = Math.max(0.005, Math.min(0.5, Number(n.data.params?.attack ?? 0.1)));
    const cur = duckByTrigger.get(trig) ?? { orbits: [], depth, attack };
    cur.orbits.push(orbit);
    duckByTrigger.set(trig, cur);
  }

  // EQ POR CANAL (M1): cada Source con EQ activo obtiene un orbit propio; el motor
  // inserta filtros BiquadFilter reales sobre ese bus (shelf/peak con ganancia en
  // dB), fuera del código (superdough no tiene EQ paramétrico con boost). El orbit
  // se emite en la expresión del source con `.orbit(K)`; comparte el asignador con
  // el sidechain para no colisionar. Nota: si el canal además pasa por un sidechain
  // 'duck', ese `.orbit()` posterior prevalece → el EQ no se aplica (caso raro).
  const eqOrbitBySource = new Map<string, number>();
  const channelEqs: ChannelEqRoute[] = [];
  for (const n of nodes) {
    if (n.data.kind !== 'source') continue;
    const eqOn = channelEqActive(n.data.eq);
    const comp = compRoute(n.data.comp);
    const autoSends = autoSendsActive(n.data.auto);
    const sendsOn = sendsActive(n.data.sends) || autoSends;
    const planned = plan?.eq.get(n.id);
    // con plan: TODA pista del plan va a su orbit (EQ plano / compresor en bypass / envíos a 0 en
    // las secciones donde no los tiene)
    if (!eqOn && !comp && !sendsOn && planned == null) continue;
    const eq = eqOn ? n.data.eq! : { low: 0, mid: 0, high: 0 };
    const orbit = planned ?? nextOrbit++;
    eqOrbitBySource.set(n.id, orbit);
    channelEqs.push({
      // min −30 dB permite el KILL del modo DJ (corte casi total de una banda).
      orbit,
      source: n.id,
      low: Math.max(-30, Math.min(15, eq.low ?? 0)),
      mid: Math.max(-30, Math.min(15, eq.mid ?? 0)),
      high: Math.max(-30, Math.min(15, eq.high ?? 0)),
      midFreq: Math.max(200, Math.min(8000, (eq as { midFreq?: number }).midFreq ?? 1000)),
      comp,
      sends: cleanSends(n.data.sends),
      ...(autoSends ? { autoSends: true } : {}),
    });
  }

  const resolve = (id: string, stack: Set<string>): Expr | null => {
    if (memo.has(id)) return memo.get(id)!;
    if (stack.has(id)) return null;
    stack.add(id);
    const node = byId.get(id);
    if (!node) return null;
    // nodo cortado (click derecho) → su salida es silencio, corta toda la rama.
    // Incluye el Out: anularlo silencia su mezcla (kill maestro si es el único).
    if (node.data.mute) {
      stack.delete(id);
      const cut: Expr = { text: 'silence', spans: [] };
      memo.set(id, cut);
      return cut;
    }
    const inputs = (incoming.get(id) ?? [])
      .map((src) => resolve(src, stack))
      .filter((x): x is Expr => !!x);
    let expr: Expr | null = null;

    switch (node.data.kind) {
      case 'source': {
        // Marcadores de viz inline (`._scope()` / `._pianoroll()`): los dibuja el
        // editor entre las líneas; NO son métodos reales del runtime, así que se
        // quitan del código emitido.
        //
        // AUDICIÓN DE SECCIÓN: con el source en SOLO y un seqPreviewCode activo
        // (preview del secuenciador sobre un brazo de arrange), se compila ESE
        // patrón en loop en vez del código completo — la sección editada suena al
        // instante. Gateado por `solo` para que un valor rancio jamás altere la mezcla.
        const preview = node.data.solo && typeof node.data.seqPreviewCode === 'string' && node.data.seqPreviewCode.trim();
        const raw = (preview ? (node.data.seqPreviewCode as string) : node.data.code ?? '').trim();
        const code = raw.replace(INLINE_VIZ_RE, '').trim();
        if (!code) {
          firstError ??= 'Source vacío';
        } else if (node.data.mute || (anySolo && !node.data.solo)) {
          // canal en mute, o hay solos activos y éste no es uno: no aporta al máster.
          expr = { text: 'silence', spans: [] };
        } else if (!sourceCompiles(code)) {
          // AÍSLA una fuente con código roto: suena `silence` en vez de tumbar el stack
          // ENTERO al evaluar. Se reporta (dropped) para avisar al usuario cuál falló.
          droppedSources.push(String(node.data.name ?? id));
          expr = { text: 'silence', spans: [] };
        } else {
          // (código) — el código real arranca tras el "(" → offset 1.
          // Macros de canal (gain/filtro DJ) se añaden como sufijo: no desplazan
          // el span del código, que está al inicio.
          const spans = [{ nodeId: id, start: 1, end: 1 + code.length }];
          // recorte del sample (.begin/.end): se inyecta JUSTO tras s("…"), antes
          // de loopAt/chop, para no romper el troceado. (el prefijo s("…") no se
          // desplaza, así el span del resaltado sigue siendo válido.)
          let inner = code;
          const b = node.data.begin;
          const e = node.data.end;
          const trims: string[] = [];
          if (typeof b === 'number' && b > 0.001) trims.push(`.begin(${b.toFixed(3)})`);
          if (typeof e === 'number' && e < 0.999) trims.push(`.end(${e.toFixed(3)})`);
          if (trims.length) {
            const suffix = trims.join('');
            const injected = inner.replace(/\b(?:s|sound)\(\s*(["'`])[^"'`]*\1\s*\)/, (m) => m + suffix);
            inner = injected !== inner ? injected : inner + suffix;
          }
          // synth tocable: se aplica solo si está ACTIVO (switch / elegir onda),
          // no por abrir el panel — así explorar la UI no cambia el sonido.
          if (node.data.synthOn && node.data.synth) {
            const syn = node.data.synth;
            inner = applySynth(inner, syn);
            const isSamp = isSampleSource(code);
            // El OSCILADOR necesita una nota: si la fuente no trae altura (ruido,
            // synth sin note), la frecuencia queda indefinida → NO suena. Usa la nota
            // base del estudio (data.synthNote) o "c3". Un SAMPLE NO lleva note forzada
            // (lo re-pitchearía): suena a su tono natural, salvo que su código ya tenga note.
            if (!isSamp && !/\b(?:note|n|freq)\s*\(/.test(code)) {
              const base = String(node.data.synthNote ?? 'c3').replace(/["'`\\]/g, '');
              inner += `.note("${base || 'c3'}")`;
            }
            // AFINACIÓN (octava/semitonos/fino): desplaza la altura del oscilador.
            if (!isSamp) {
              const oct = Math.round(Number(syn.octave ?? 0));
              const semi = Math.round(Number(syn.semi ?? 0));
              const fine = Number(syn.fine ?? 0);
              const offset = oct * 12 + semi + (isFinite(fine) ? fine / 100 : 0);
              if (Math.abs(offset) > 0.0005) inner += `.add(note(${Number(offset.toFixed(3))}))`;
            }
          }
          // editor de voz: position/grain/speed/shape/spread/vowel/melodía/gain.
          // Se aplica SIEMPRE que el nodo tenga parámetros de voz (el estudio abre por
          // `voiceEditId`, no por `showVoice`; exigir showVoice hacía que NADA de lo
          // editado en el estudio surtiera efecto). Con valores por defecto applyVoice
          // no añade ningún sufijo, así que es un no-op para fuentes normales.
          if (node.data.voice) inner = applyVoice(inner, node.data.voice);
          // "tono" global: transpone en semitonos SOLO el material con altura
          // (fuentes con note(…)); los samples de percusión no llevan note → no se
          // desafinan. .add(note(n)) suma n a la nota existente (transposición cromática).
          if (transpose !== 0 && /\bnote\s*\(/.test(code)) inner += `.add(note(${transpose}))`;
          // disparador de sidechain-duck: este source (el bombo) duckea su(s) orbit(s).
          // `.duckonset` pequeño evita el click del arranque del ducking.
          const duckCfg = duckByTrigger.get(id);
          if (duckCfg && duckCfg.orbits.length) {
            const tgt = duckCfg.orbits.length === 1 ? String(duckCfg.orbits[0]) : `"${duckCfg.orbits.join(':')}"`;
            inner += `.duck(${tgt}).duckattack(${duckCfg.attack.toFixed(3)}).duckdepth(${duckCfg.depth.toFixed(2)}).duckonset(0.006)`;
          }
          // FX de performance por SOURCE (momentáneos): roll (.ply), reverse (.rev),
          // gate rítmico, echo throw (.delay) y reverb wash (.room). Se aplican solo a ESTE
          // source. PATRÓN (roll/rev, caen en frontera de ciclo) primero; AUDIO después.
          // gate = `.mul(velocity(square…))` MULTIPLICATIVO (P0.1: `.gain(square)` PISABA los
          // acentos del patrón — igual que el gate del máster ya corregido).
          const perf = node.data.perf as { roll?: number; gate?: number; echo?: number; rev?: boolean; wash?: number } | undefined;
          if (perf) {
            if (perf.roll && perf.roll > 1) inner += `.ply(${Math.round(perf.roll)})`;
            if (perf.rev) inner += `.rev()`;
            if (perf.gate && perf.gate > 0) inner += `.mul(velocity(square.range(0, 1).fast(${Math.round(perf.gate)})))`;
            if (perf.echo && perf.echo > 0.02) inner += `.delay(${Math.min(0.9, perf.echo).toFixed(2)})`;
            // el reverb `wash` NO se emite aquí: se unifica con chRoom en UN solo `.room()`
            // (dos `.room()` en la misma voz se pisan) — ver la llamada a applyMaster abajo.
          }
          // EQ por canal: enruta el source a su orbit propio; el motor inserta el EQ
          // Biquad real sobre ese bus (setChannelEqs).
          const eqOrbit = eqOrbitBySource.get(id);
          if (eqOrbit != null) inner += `.orbit(${eqOrbit})`;
          // pan de canal (mezcla): colocación estéreo del source. Va después del synth/voz
          // (que pueden tener su propio pan); en superdough el último .pan() prevalece.
          const chPan = typeof node.data.chPan === 'number' ? node.data.chPan : 0.5;
          if (Math.abs(chPan - 0.5) > 0.01) inner += `.pan(${chPan.toFixed(2)})`;
          // crossfader DJ: multiplica el gain del canal por la curva del lado asignado.
          const xf = xfaderGain(node.data.xfa as 'a' | 'b' | undefined, xfader);
          // reverb del canal en UN solo send: el máximo entre el chRoom persistente (V3 ·
          // halo de la superficie de mezcla, 0..0.8) y el wash momentáneo (fila de
          // performance). Así el throw de wash SIEMPRE se oye, aunque el canal tenga reverb.
          const chRoom = Math.max(0, Math.min(0.8, Number(node.data.chRoom) || 0));
          const perfWash = perf?.wash && perf.wash > 0.02 ? Math.min(0.9, perf.wash) : 0;
          let text = applyMaster(`(${inner})`, {
            gain: (node.data.gain ?? 1) * xf,
            filter: node.data.chFilter ?? 0,
            room: Math.max(chRoom, perfWash),
          });
          // AUTOMATIZACIÓN (Fase 3.1): volumen y filtro por compás de la canción, DESPUÉS de la
          // mezcla del canal (compone con su filtro y su volumen). Sin curvas: no añade nada.
          text += automationSuffix(node.data.auto, opts.songBars ?? 0);
          // tap del analyser del instrumento (no altera el sonido): alimenta el VU
          // por canal (siempre) y el osciloscopio inline (cuando está activo).
          if (opts.analyze !== false) text += `.analyze("${SRC_ANALYSER_PREFIX}${id}")`;
          expr = { text, spans };
          if (opts.only && opts.only !== id) {
            // stem de OTRA pista: esta calla; si dispara un sidechain, lo sigue disparando muda
            expr = duckByTrigger.has(id) ? { text: `${text}.mul(gain(0))`, spans: [] } : { text: 'silence', spans: [] };
          }
        }
        break;
      }
      case 'transform':
      case 'fx': {
        const op = node.data.opId ? OPS_BY_ID[node.data.opId] : undefined;
        if (inputs.length === 0) {
          firstError ??= `${node.data.opId ?? 'op'} sin entrada`;
        } else if (!op) {
          expr = combine(inputs);
        } else if (op.id === 'sidechain') {
          const base = combine(inputs);
          const orbit = sidechainOrbit.get(node.id);
          if (orbit != null) {
            // DUCK REAL: enruta esta rama a un orbit propio; el bombo elegido
            // (params.trigger) genera el ducking de ese bus con `.duck(orbit)…`.
            expr = { text: `${base.text}.orbit(${orbit})`, spans: base.spans };
          } else {
            // GENÉRICO (por defecto / sin disparador válido): pump de sidechain
            // CONTINUO (tremolo LFO por-muestra) → duckea DENTRO de notas sostenidas
            // (pads/acordes), no solo por onset. tremolosync = pumps por ciclo;
            // tremolodepth = profundidad (gain mínimo = 1-depth); diente de sierra.
            const depth = Math.max(0.05, Math.min(0.95, Number(node.data.params?.depth ?? 0.7)));
            const rate = Math.max(1, Math.round(Number(node.data.params?.rate ?? 4)));
            expr = { text: `${base.text}.tremolosync(${rate}).tremolodepth(${depth.toFixed(2)})`, spans: base.spans };
          }
        } else if (op.id === 'compressor') {
          // Los controles de Strudel toman UN solo argumento; para pasar los 5 valores
          // (threshold:ratio:knee:attack:release) hay que usar la forma de cadena con
          // ":" (documentada). Con args sueltos solo se aplicaría el umbral.
          const base = combine(inputs);
          const g = (k: string, d: number) => { const v = String(node.data.params?.[k] ?? d); return isPlainNumber(v) ? v : String(d); };
          const cs = [g('threshold', -20), g('ratio', 4), g('knee', 10), g('attack', 0.01), g('release', 0.1)].join(':');
          expr = { text: `${base.text}.compressor("${cs}")`, spans: base.spans };
        } else if (op.id === 'euclid') {
          // euclid(pulses, steps) NO toma rotación (el 3er arg es el patrón). La
          // rotación es un método aparte: euclidRot(pulses, steps, rot).
          const base = combine(inputs);
          const p = Math.max(0, Math.round(Number(node.data.params?.pulses ?? 3)));
          const st = Math.max(1, Math.round(Number(node.data.params?.steps ?? 8)));
          const rot = Math.max(0, Math.round(Number(node.data.params?.rot ?? 0)));
          const call = rot > 0 ? `.euclidRot(${p}, ${st}, ${rot})` : `.euclid(${p}, ${st})`;
          expr = { text: `${base.text}${call}`, spans: base.spans };
        } else {
          const base = combine(inputs); // base en offset 0
          const args: string[] = [];
          if (op.rawArg) args.push(op.rawArg);
          for (const p of op.params) {
            const val = node.data.params?.[p.key] ?? p.default;
            args.push(p.kind === 'number' ? emitNumeric(val) : `"${String(val)}"`);
          }
          expr = { text: `${base.text}.${op.method}(${args.join(', ')})`, spans: base.spans };
        }
        break;
      }
      case 'out': {
        if (inputs.length === 0) firstError ??= 'Out sin entrada';
        else expr = combine(inputs);
        break;
      }
    }
    stack.delete(id);
    memo.set(id, expr);
    return expr;
  };

  const outExprs = outs.map((o) => resolve(o.id, new Set())).filter((x): x is Expr => !!x);
  if (outExprs.length === 0) return { code: null, error: firstError ?? 'nada que sonar', spans: [], channelEqs, dropped: droppedSources };

  const master = combine(outExprs);
  // automatización del MÁSTER que vive en el código (reverb/eco/crush, Fase 7.2): del primer Out
  const mAuto = masterAutomationSuffix(outs[0]?.data.auto, opts.songBars ?? 0);
  if (mAuto) return { code: `(${master.text})${mAuto}`, error: null, spans: shift(master.spans, 1), channelEqs, dropped: droppedSources };
  return { code: master.text, error: null, spans: master.spans, channelEqs, dropped: droppedSources };
}
