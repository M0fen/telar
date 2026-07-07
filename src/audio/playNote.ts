import { superdough, getAudioContext } from '@strudel/web';
import type { SynthParams, VoiceParams } from '../graph/types';
import { SYNTH_WAVES } from '../graph/types';
import { isMorphWave } from './wavetables';
import { SRC_ANALYSER_PREFIX } from '../graph/compile';
import { ensureEngine, ensureAudioReady } from './engine';
import { toast } from '../store/useNotifyStore';

// Reporta un fallo de audición SIN spamear: con throttle (una vez cada ~4 s) e ignorando
// el típico "contexto no listo / autoplay" (benigno, se resuelve con el 1er gesto). Así
// las audiciones (synth, secuenciador, voz) avisan de fallos REALES en vez de callar.
let lastAudioErrAt = 0;
function reportAudioErr(where: string, err: unknown): void {
  const m = err instanceof Error ? err.message : String(err);
  if (/not allowed|autoplay|suspend|InvalidState|user gesture|was interrupted/i.test(m)) return;
  const now = Date.now();
  if (now - lastAudioErrAt < 4000) return;
  lastAudioErrAt = now;
  toast.err(`Audio (${where}): ${m}`.slice(0, 180));
}

// Convierte SynthParams al objeto-valor que entiende superdough (mismas CLAVES de
// control que emite applySynth, verificadas en @strudel/core/controls.mjs) y dispara
// UNA nota en vivo con la MISMA instancia de superdough que usa el repl (importada de
// @strudel/web). Es el motor del teclado tocable del Synth Studio: tocar notas para
// probar/afinar el sonido sin depender del transporte.
function num(x: number | undefined, d: number): number {
  return typeof x === 'number' && isFinite(x) ? x : d;
}

export function synthToValue(syn: SynthParams, note: string | number, nodeId?: string): Record<string, unknown> {
  // afinación: desplaza la altura (octava/semitonos/fino) sobre la nota tocada.
  const off = Math.round(num(syn.octave, 0)) * 12 + Math.round(num(syn.semi, 0)) + num(syn.fine, 0) / 100;
  const pnote = typeof note === 'number' ? note + off : note;
  const v: Record<string, unknown> = {
    s: syn.wave || 'sawtooth',
    note: pnote,
    attack: num(syn.attack, 0.01),
    decay: num(syn.decay, 0.12),
    sustain: num(syn.sustain, 0.6),
    release: num(syn.release, 0.2),
    gain: 0.85,
  };
  if (syn.wave === 'supersaw') {
    const u = Math.round(num(syn.unison, 5));
    if (u > 1) v.unison = u;
    const dt = num(syn.detune, 0.18);
    if (dt > 0.001) v.detune = dt;
    const sp = num(syn.spread, 0);
    if (sp > 0.001) v.spread = sp;
  }
  // WAVETABLE de MORPH: audiciona a la posición estática del knob (v.s ya es la tabla).
  if (isMorphWave(syn.wave)) {
    v.wt = num(syn.wtpos, 0);
    const u = Math.round(num(syn.unison, 1));
    if (u > 1) {
      v.unison = u;
      const dt = num(syn.detune, 0.18);
      if (dt > 0.001) v.detune = dt;
      const sp = num(syn.spread, 0);
      if (sp > 0.001) v.spread = sp;
    }
  }
  const noise = num(syn.noise, 0);
  if (noise > 0.001) v.noise = noise;
  const pw = num(syn.pw, 0.5);
  if (Math.abs(pw - 0.5) > 0.001) v.pw = pw;
  const fm = num(syn.fm, 0);
  if (fm > 0.01) {
    v.fmi = fm; // .fm() → clave 'fmi'
    const h = num(syn.fmh, 1);
    if (Math.abs(h - 1) > 0.001) v.fmh = h;
    if (syn.fmwave && syn.fmwave !== 'sine') v.fmwave = syn.fmwave;
    const fa = num(syn.fmattack, 0), fd = num(syn.fmdecay, 0), fs = num(syn.fmsustain, 1);
    if (fa > 0.001 || fd > 0.001 || fs < 0.999) { v.fmattack = fa; v.fmdecay = fd; v.fmsustain = fs; }
  }
  let cut = num(syn.cutoff, 0);
  const lpenv = num(syn.lpenv, 0);
  if (lpenv > 0.01 && cut <= 20) cut = 800;
  if (cut > 20) {
    v.cutoff = Math.round(cut);
    const ft = Math.round(num(syn.ftype, 0));
    if (ft > 0) v.ftype = ft === 1 ? 'ladder' : '24db';
  }
  const q = num(syn.lpq, 0);
  if (q > 0) v.resonance = q; // .lpq() → 'resonance'
  if (lpenv > 0.01) {
    v.lpenv = lpenv;
    v.lpattack = num(syn.lpa, 0.01);
    v.lpdecay = num(syn.lpd, 0.12);
  }
  const hc = num(syn.hcutoff, 0);
  if (hc > 20) {
    v.hcutoff = Math.round(hc); // .hpf() → 'hcutoff'
    const hq = num(syn.hpq, 0);
    if (hq > 0) v.hresonance = hq;
  }
  const penv = num(syn.penv, 0);
  if (Math.abs(penv) > 0.01) {
    v.penv = penv;
    v.pdecay = num(syn.pdecay, 0.1);
  }
  const vib = num(syn.vib, 0);
  if (vib > 0.01) {
    v.vib = vib;
    const vm = num(syn.vibmod, 0);
    if (vm > 0.001) v.vibmod = vm;
  }
  const phaser = num(syn.phaser, 0);
  if (phaser > 0.01) {
    v.phaserrate = phaser; // .phaser() → 'phaserrate'
    v.phaserdepth = num(syn.phaserdepth, 0.6);
  }
  const room = num(syn.room, 0);
  if (room > 0.001) {
    v.room = room;
    const rs = num(syn.roomsize, 2);
    if (rs > 0.01) v.roomsize = rs;
  }
  const delay = num(syn.delay, 0);
  if (delay > 0.001) {
    v.delay = delay;
    v.delayfeedback = num(syn.delayfb, 0.4);
  }
  const drive = num(syn.drive, 0);
  if (drive > 0.01) v.distort = drive * 3;
  const coarse = Math.round(num(syn.coarse, 1));
  if (coarse > 1) v.coarse = coarse;
  const pan = num(syn.pan, 0.5);
  if (Math.abs(pan - 0.5) > 0.01) v.pan = pan;
  // alimenta el osciloscopio del Synth Studio (mismo id de analyser que el nodo).
  if (nodeId) v.analyze = SRC_ANALYSER_PREFIX + nodeId;
  return v;
}

// Audiciona el SONIDO DE LA FUENTE tal cual: si el synth está en bypass, suena el
// ORIGINAL sin modificación (el sample a su pitch natural, o la onda a la nota base);
// si el synth está activo, suena YA con su timbre editado. Es el ▶ del Synth Studio,
// para tener siempre la referencia del sonido mientras se edita.
export function sourceAuditionValue(
  code: string,
  syn: SynthParams,
  synthOn: boolean,
  note: string | number,
  nodeId?: string,
  begin = 0,
  end = 1,
): Record<string, unknown> {
  const m = /\bs(?:ound)?\(\s*["'`]([^"'`]+)/.exec(code || '');
  const sample = m ? (m[1].match(/[A-Za-z0-9_]+/)?.[0] ?? null) : null;
  const isWave = sample ? (SYNTH_WAVES as readonly string[]).includes(sample) : false;
  const isSample = !!sample && !isWave;
  const hasNote = /\bnote\s*\(|\bn\s*\(/.test(code || '');
  // recorte + reproducción de sample (velocidad/reversa) para que el ▶ suene fiel.
  const applySample = (val: Record<string, unknown>) => {
    if (begin > 0.001) val.begin = begin;
    if (end < 0.999) val.end = end;
    let sp = num(syn.speed, 1);
    if (syn.reverse) sp = -Math.abs(sp || 1);
    if (Math.abs(sp - 1) > 0.001 || syn.reverse) val.speed = sp;
  };
  if (synthOn) {
    // sonido EDITADO: timbre del synth. Si la fuente es un sample, el sample pasa por
    // la cadena del synth (filtro/envolvente/fx) en vez de un oscilador.
    const val = synthToValue(syn, note, nodeId);
    if (isSample) {
      val.s = sample;
      if (!hasNote) delete val.note; // percusión: a su tono natural, no re-pitcheado
      applySample(val);
    }
    return val;
  }
  // ORIGINAL sin modificación:
  const val: Record<string, unknown> = { gain: 0.9 };
  if (nodeId) val.analyze = SRC_ANALYSER_PREFIX + nodeId;
  if (isSample) {
    val.s = sample;
    if (hasNote) val.note = note; // melódico → a la nota base; percusión → natural
    applySample(val);
  } else {
    val.s = sample || syn.wave || 'sawtooth';
    val.note = note;
  }
  return val;
}

export async function playSourceSound(
  code: string,
  syn: SynthParams,
  synthOn: boolean,
  note: string | number,
  nodeId?: string,
  holdSec = 1.4,
  begin = 0,
  end = 1,
): Promise<void> {
  await ensureEngine();
  await ensureAudioReady();
  const ctx = getAudioContext();
  try {
    await superdough(sourceAuditionValue(code, syn, synthOn, note, nodeId, begin, end), ctx.currentTime + 0.03, holdSec, 0.5, 0.5);
  } catch (err) {
    reportAudioErr('source', err);
  }
}

// Convierte VoiceParams al objeto-valor de superdough para AUDICIONAR la voz YA
// PROCESADA (mismos FX que emite applyVoice: recorte, velocidad, formante, saturación,
// espacio, afinado, pulir). No incluye la melodía/autotune (eso es a nivel de patrón);
// audiciona el tono natural con la cadena de FX. Es el "escuchar con FX" del estudio.
export function voiceToValue(v: VoiceParams, name: string, begin = 0, end = 1): Record<string, unknown> {
  const num = (x: number | undefined, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
  const c01 = (x: number) => Math.max(0, Math.min(1, x));
  const val: Record<string, unknown> = { s: name, gain: num(v.gain, 1) };
  if (begin > 0.001) val.begin = begin;
  if (end < 0.999) val.end = end;
  const pos = c01(num(v.position, 0));
  if (pos > 0.001) val.begin = Math.max(pos, Number(val.begin ?? 0));
  const speed = num(v.speed, 1);
  if (Math.abs(speed - 1) > 0.001) val.speed = speed;
  if (v.vowel) val.vowel = v.vowel;
  const shape = c01(num(v.shape, 0));
  if (shape > 0.001) val.shape = Math.min(0.95, shape);
  const room = c01(num(v.room, 0));
  if (room > 0.001) { val.room = room; val.roomsize = 3; }
  const delay = c01(num(v.delay, 0));
  if (delay > 0.001) { val.delay = delay; val.delayfeedback = 0.4; }
  // afinar: pitch-shift espectral en semitonos (control stretch = pitchFactor-1, por tramos)
  const semi = num(v.pitchShift, 0);
  if (Math.abs(semi) > 0.01) {
    const pf = Math.pow(2, Math.max(-24, Math.min(24, semi)) / 12);
    val.stretch = pf >= 1 ? pf - 1 : (pf - 1) * 4;
  }
  // VIBRATO: superdough modula el `detune` del sample con un LFO (vib Hz, vibmod
  // semitonos). Antes NO se pasaba a la audición → el vibrato "no se oía" en la preview
  // (solo en el grafo). Se necesita una nota que SOSTENGA para notarlo (holdSec largo).
  const vib = num(v.vibrato, 0);
  if (vib > 0.01) {
    val.vib = Math.min(8, vib);
    const vd = num(v.vibratoDepth, 0.3);
    if (vd > 0.001) val.vibmod = Math.min(2, vd);
  }
  // pulir: paso-alto + compresor + postgain (misma cadena que applyVoice)
  if (v.polish) {
    val.hcutoff = 110;
    val.compressor = -18; val.compressorRatio = 3; val.compressorKnee = 6;
    val.compressorAttack = 0.005; val.compressorRelease = 0.12; val.postgain = 1.4;
  }
  return val;
}

// Audiciona la voz procesada (con FX) AL INSTANTE, independiente del transporte/ciclo.
export async function playVoiceSample(name: string, v: VoiceParams, begin = 0, end = 1, holdSec = 6): Promise<void> {
  await ensureEngine();
  await ensureAudioReady();
  const ctx = getAudioContext();
  try {
    await superdough(voiceToValue(v, name, begin, end), ctx.currentTime + 0.03, holdSec, 0.5, 0.5);
  } catch (err) {
    reportAudioErr('voz', err);
  }
}

// Audiciona la voz procesada A UNA NOTA concreta (autotune). Re-pitcha el sample con
// `note` (su pitch natural = c2/midi36, como en el compilador melódico) y aplica la
// MISMA cadena de FX que la voz final (formante, espacio, afinar, pulir) → el preview
// del piano roll suena IDÉNTICO al resultado. holdSec corto para respuesta inmediata
// al probar teclas. Es la ÚNICA vía de audición del piano roll (coherente con el final).
export async function playVoiceNote(name: string, v: VoiceParams, note: string, begin = 0, end = 1, holdSec = 1.4): Promise<void> {
  await ensureEngine();
  await ensureAudioReady();
  const ctx = getAudioContext();
  try {
    const val = voiceToValue(v, name, begin, end);
    val.note = note; // superdough transpone el sample: transpose = midi(note) − 36
    await superdough(val, ctx.currentTime + 0.02, holdSec, 0.5, 0.5);
  } catch (err) {
    reportAudioErr('voz', err);
  }
}

// Audiciona UN golpe de batería/sample (una celda del secuenciador) al instante, con
// su banco. Feedback inmediato al colocar/probar pasos. note opcional (para pitchear
// samples melódicos como el cencerro).
export async function playDrumHit(sound: string, bank?: string, note?: string | number, holdSec = 0.5, gain = 0.9): Promise<void> {
  await ensureEngine();
  await ensureAudioReady();
  const ctx = getAudioContext();
  try {
    const val: Record<string, unknown> = { s: sound, gain: Math.max(0.05, gain) };
    if (bank) val.bank = bank;
    if (note != null) val.note = note;
    await superdough(val, ctx.currentTime + 0.02, holdSec, 0.5, 0.5);
  } catch (err) {
    reportAudioErr('secuenciador', err);
  }
}

// Dispara una nota (note = nombre "c4" o número MIDI) con los params del synth.
export async function playSynthNote(
  syn: SynthParams,
  note: string | number,
  holdSec = 0.6,
  nodeId?: string,
): Promise<void> {
  await ensureEngine(); // registra osciladores/samples (idempotente) por si no hubo Play
  await ensureAudioReady(); // reanuda el AudioContext + carga worklets (1ª vez)
  const ctx = getAudioContext();
  try {
    // superdough MUTA el value (le añade duration) → pasamos un objeto fresco.
    const base = synthToValue(syn, note, nodeId);
    const at = ctx.currentTime + 0.03;
    // MULTI-OSCILADOR: si hay capas, la audición dispara OSC A + cada capa como voz aparte
    // (misma cadena de filtro/envolvente que trae `base`), para que el preview del teclado
    // suene igual que el patrón. Sin capas: una sola voz (comportamiento de siempre).
    const layers = (Array.isArray(syn.oscLayers) ? syn.oscLayers : []).filter((l) => l && l.wave && num(l.level, 0) > 0.001);
    if (!layers.length) { await superdough(base, at, holdSec, 0.5, 0.5); return; }
    const baseGain = typeof base.gain === 'number' ? base.gain : 0.85;
    const baseNote = typeof base.note === 'number' ? base.note : (typeof note === 'number' ? note : null);
    await superdough({ ...base, gain: baseGain * num(syn.levelA, 1) }, at, holdSec, 0.5, 0.5);
    for (const l of layers) {
      const v: Record<string, unknown> = { ...base, s: l.wave, gain: baseGain * num(l.level, 0.6) };
      // capa = oscilador simple: quita lo específico de OSC A (unísono/morph/FM)
      delete v.unison; delete v.detune; delete v.spread; delete v.wt; delete v.fmi; delete v.fmh;
      if (baseNote != null) v.note = baseNote + Math.round(num(l.octave, 0)) * 12 + num(l.detune, 0);
      void superdough(v, at, holdSec, 0.5, 0.5);
    }
  } catch (err) {
    reportAudioErr('synth', err);
  }
}
