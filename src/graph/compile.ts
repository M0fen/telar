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
import type { Edge, Node } from '@xyflow/react';
import type { NodeData, SynthParams, VoiceParams } from './types';
import { channelEqActive, SYNTH_WAVES } from './types';
import { OPS_BY_ID } from './ops';
import { irRoomsize, knownIr } from '../audio/irRegistry';

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
export interface ChannelEqRoute {
  orbit: number;
  low: number;
  mid: number;
  high: number;
  midFreq: number;
}

export interface CompileResult {
  code: string | null;
  error: string | null;
  spans: SourceSpan[];
  channelEqs: ChannelEqRoute[];
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
    // --- OSCILADOR: forma de onda + unísono (supersaw) + ruido + FM ---
    if (syn.wave) out += `.s("${syn.wave}")`;
    if (syn.wave === 'supersaw') {
      const unison = Math.round(n(syn.unison, 5));
      if (unison > 1) out += `.unison(${unison})`;
      const detune = n(syn.detune, 0.18);
      if (detune > 0.001) out += `.detune(${detune.toFixed(3)})`;
      const spread = n(syn.spread, 0);
      if (spread > 0.001) out += `.spread(${spread.toFixed(2)})`;
    }
    const noise = n(syn.noise, 0);
    if (noise > 0.001) out += `.noise(${noise.toFixed(2)})`;
    // ancho de pulso (timbre de la onda cuadrada/pulso; base de PWM)
    const pw = n(syn.pw, 0.5);
    if (Math.abs(pw - 0.5) > 0.001) out += `.pw(${pw.toFixed(3)})`;
    // FM (operador: índice + ratio + forma de onda del modulador + envolvente del índice)
    const fm = n(syn.fm, 0);
    if (fm > 0.01) {
      out += `.fm(${fm.toFixed(2)})`;
      const fmh = n(syn.fmh, 1);
      if (Math.abs(fmh - 1) > 0.001) out += `.fmh(${fmh.toFixed(2)})`;
      if (syn.fmwave && syn.fmwave !== 'sine') out += `.fmwave("${syn.fmwave}")`;
      const fa = n(syn.fmattack, 0), fd = n(syn.fmdecay, 0), fs = n(syn.fmsustain, 1);
      if (fa > 0.001 || fd > 0.001 || fs < 0.999)
        out += `.fmattack(${fa.toFixed(3)}).fmdecay(${fd.toFixed(3)}).fmsustain(${fs.toFixed(2)})`;
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
    // GLIDE/portamento: desliza el pitch entre notas (autotune "suave"). El control
    // `slide` del motor hace el legato de altura; escalamos 0..1 → deslizamiento útil.
    const glide = c01(num(v.glide, 0));
    if (glide > 0.01) out += `.slide(${(glide * 1.0).toFixed(2)})`;
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
  if (delay > 0.001) out += `.delay(${delay.toFixed(2)})`;
  const spread = c01(num(v.spread, 0));
  if (spread > 0.001)
    out += `.pan(sine.range(${(0.5 - spread / 2).toFixed(2)}, ${(0.5 + spread / 2).toFixed(2)}).slow(4))`;
  const gain = num(v.gain, 1);
  if (Math.abs(gain - 1) > 0.001) out += `.gain(${gain.toFixed(2)})`;
  return out;
}

export function applyMaster(code: string, m: MasterFx): string {
  let out = code;
  // GROOVE primero (afecta el TIEMPO de los eventos): swing (.swingBy) + humanize
  // (micro-retraso y micro-dinámica aleatorios por evento con la señal `rand`).
  // Recto y robótico si ambos son 0.
  //
  // OJO semántica de controles (verificado en @strudel/core): dos `.gain()` (o dos
  // `.velocity()`) encadenados NO se multiplican — el 2º PISA al 1º (controls.mjs
  // combina con `set`). Por eso aquí toda ganancia de MEZCLA se emite con
  // `.mul(gain(x))` / `.mul(velocity(x))`: multiplica la clave si el evento ya la
  // trae (acentos del secuenciador, velocity de lane, fader de canal) y la fija si
  // no existe (idéntico al comportamiento anterior para eventos sin gain). Antes,
  // mover el fader de un canal borraba los acentos, y el humanize/gain del máster
  // aplanaba el balance de TODOS los canales.
  // P0.2: swingBy(x, n) = n rebanadas por ciclo, retrasa la 2ª mitad de cada una.
  // n=8 → swing de SEMICORCHEAS con el compás estándar de 16 pasos (el tumbao del
  // dembow/dancehall). El n=4 anterior swingueaba corcheas (subdivisión equivocada).
  if (m.swing && m.swing > 0.01) out = `${out}.swingBy(${Math.min(0.6, m.swing).toFixed(2)}, 8)`;
  if (m.humanize && m.humanize > 0.01) {
    const h = Math.min(1, m.humanize);
    out = `${out}.late(rand.range(0, ${(h * 0.02).toFixed(3)})).mul(velocity(rand.range(${(1 - h * 0.35).toFixed(2)}, 1)))`;
  }
  // FX de performance momentáneos (afectan tiempo/estructura del máster):
  // reverse, loop roll (.ply repite cada evento) y gate rítmico (gain cuadrada,
  // multiplicativa para no pisar el balance mientras corta).
  if (m.rev) out = `${out}.rev()`;
  if (m.roll && m.roll > 1) out = `${out}.ply(${Math.round(m.roll)})`;
  if (m.gate && m.gate > 0) out = `${out}.mul(gain(square.range(0, 1).fast(${Math.round(m.gate)})))`;
  // macros creativos (saturación → lo-fi → eco), antes del filtro/room/gain.
  if (m.drive && m.drive > 0.02) out = `${out}.shape(${Math.min(0.9, m.drive * 0.9).toFixed(2)})`;
  if (m.crush && m.crush > 0.02) out = `${out}.crush(${(16 - m.crush * 12).toFixed(1)})`;
  if (m.delay && m.delay > 0.02) out = `${out}.delay(${m.delay.toFixed(2)})`;
  if (m.filter > 0.02) out = `${out}.hpf(${Math.round(20 * Math.pow(5000 / 20, m.filter))})`;
  else if (m.filter < -0.02) out = `${out}.lpf(${Math.round(18000 * Math.pow(100 / 18000, -m.filter))})`;
  if (m.room > 0.02) {
    out = `${out}.room(${m.room.toFixed(2)})`;
    // espacio por IR (convolución real): usa la muestra como respuesta al impulso.
    // roomsize DEBE ser la duración exacta del IR: superdough reconstruye el buffer
    // con adjustLength(roomsize, ir) — si roomsize>dur BUCLEA el IR (eco fantasma) y
    // si roomsize<dur lo TRUNCA (cola cortada). irRoomsize() da la duración medida
    // (IR real) o tabulada (sintético). knownIr evita emitir `.ir()` sobre una
    // muestra ausente (p.ej. IR de usuario no recargado) → cae a reverb algorítmico.
    if (m.space && knownIr(m.space)) out = `${out}.ir("${m.space}").roomsize(${irRoomsize(m.space)})`;
  }
  // fader (de canal o del máster): multiplicativo — respeta acentos/velocity internos.
  if (Math.abs(m.gain - 1) > 0.001) out = `${out}.mul(gain(${m.gain.toFixed(2)}))`;
  return out;
}

// Opciones globales de compilación (capa de transporte/performance).
export interface CompileOpts {
  transpose?: number; // semitonos globales ("tono"): se suma SOLO a fuentes con note(…)
  xfader?: number; // crossfader DJ 0..1 (0 = todo A, 1 = todo B); afecta el gain de los decks asignados
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
  if (outs.length === 0) return { code: null, error: 'sin nodo Out', spans: [], channelEqs: [] };
  if (hasCycle(nodes, edges)) return { code: null, error: 'ciclo en el grafo', spans: [], channelEqs: [] };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = incomingMap(edges);
  const memo = new Map<string, Expr | null>();
  let firstError: string | null = null;

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
  let nextOrbit = 2; // 0/1 reservados al bus por defecto
  for (const n of nodes) {
    if (n.data.kind !== 'fx' || n.data.opId !== 'sidechain') continue;
    if (String(n.data.params?.mode ?? 'gen') !== 'duck') continue;
    const trig = String(n.data.params?.trigger ?? '');
    const trigNode = byId.get(trig);
    if (!trig || !trigNode || trigNode.data.kind !== 'source') continue; // → genérico
    const orbit = nextOrbit++;
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
    const eq = n.data.eq;
    if (!channelEqActive(eq) || !eq) continue;
    const orbit = nextOrbit++;
    eqOrbitBySource.set(n.id, orbit);
    channelEqs.push({
      // min −30 dB permite el KILL del modo DJ (corte casi total de una banda).
      orbit,
      low: Math.max(-30, Math.min(15, eq.low ?? 0)),
      mid: Math.max(-30, Math.min(15, eq.mid ?? 0)),
      high: Math.max(-30, Math.min(15, eq.high ?? 0)),
      midFreq: Math.max(200, Math.min(8000, eq.midFreq ?? 1000)),
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
        const raw = (node.data.code ?? '').trim();
        const code = raw.replace(INLINE_VIZ_RE, '').trim();
        if (!code) {
          firstError ??= 'Source vacío';
        } else if (node.data.mute || (anySolo && !node.data.solo)) {
          // canal en mute, o hay solos activos y éste no es uno: no aporta al máster.
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
          // FX de performance por DECK (modo DJ, momentáneos): roll (.ply), gate rítmico
          // (.gain cuadrada) y echo throw (.delay). Se aplican solo a ESTE source.
          const perf = node.data.perf as { roll?: number; gate?: number; echo?: number } | undefined;
          if (perf) {
            if (perf.roll && perf.roll > 1) inner += `.ply(${Math.round(perf.roll)})`;
            if (perf.gate && perf.gate > 0) inner += `.gain(square.range(0, 1).fast(${Math.round(perf.gate)}))`;
            if (perf.echo && perf.echo > 0.02) inner += `.delay(${Math.min(0.9, perf.echo).toFixed(2)})`;
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
          let text = applyMaster(`(${inner})`, {
            gain: (node.data.gain ?? 1) * xf,
            filter: node.data.chFilter ?? 0,
            room: 0,
          });
          // tap del analyser del instrumento (no altera el sonido): alimenta el VU
          // por canal (siempre) y el osciloscopio inline (cuando está activo).
          text += `.analyze("${SRC_ANALYSER_PREFIX}${id}")`;
          expr = { text, spans };
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
  if (outExprs.length === 0) return { code: null, error: firstError ?? 'nada que sonar', spans: [], channelEqs };

  const master = combine(outExprs);
  return { code: master.text, error: null, spans: master.spans, channelEqs };
}
