import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph, isSampleSource, applyMaster } from '../src/graph/compile.ts';
import { registerUserIr } from '../src/audio/irRegistry.ts';

// helpers de construcción de grafo (casts laxos: son fixtures de test)
type Any = Record<string, unknown>;
const out = (id = 'o'): Any => ({ id, type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } });
const src = (id: string, code: string, extra: Any = {}): Any => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', code, ...extra } });
const fx = (id: string, opId: string, params: Any = {}): Any => ({ id, type: 'fx', position: { x: 0, y: 0 }, data: { kind: 'fx', opId, params } });
const tr = (id: string, opId: string, params: Any = {}): Any => ({ id, type: 'transform', position: { x: 0, y: 0 }, data: { kind: 'transform', opId, params } });
const E = (s: string, t: string): Any => ({ id: `e_${s}_${t}`, source: s, target: t });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C = (nodes: Any[], edges: Any[], opts?: Any) => compileGraph(nodes as any, edges as any, opts as any);
const code = (r: { code: string | null }): string => { assert.ok(r.code, 'expected code, got null'); return r.code!; };

test('basic source → out compiles', () => {
  const r = C([src('s', 's("bd*4")'), out()], [E('s', 'o')]);
  assert.equal(r.error, null);
  assert.match(code(r), /s\("bd\*4"\)/);
});

test('no Out → error', () => {
  const r = C([src('s', 's("bd")')], []);
  assert.equal(r.code, null);
  assert.match(String(r.error), /Out/);
});

test('empty source → error', () => {
  const r = C([src('s', ''), out()], [E('s', 'o')]);
  assert.equal(r.code, null);
});

test('cycle → error', () => {
  const r = C([src('a', 's("bd")'), fx('b', 'gain'), out()], [E('a', 'b'), E('b', 'a'), E('b', 'o')]);
  assert.match(String(r.error), /ciclo/);
});

test('multiple Outs → stack()', () => {
  const r = C([src('a', 's("bd")'), src('b', 's("hh")'), out('o1'), out('o2')], [E('a', 'o1'), E('b', 'o2')]);
  assert.match(code(r), /^stack\(/);
});

test('mute → branch becomes silence', () => {
  const r = C([src('a', 's("bd")', { mute: true }), src('b', 's("hh")'), out()], [E('a', 'o'), E('b', 'o')]);
  assert.match(code(r), /silence/);
  assert.match(code(r), /hh/);
});

test('solo silences the non-soloed sources', () => {
  const r = C([src('a', 's("bd")', { solo: true }), src('b', 's("hh")'), out()], [E('a', 'o'), E('b', 'o')]);
  assert.match(code(r), /silence/);
  assert.match(code(r), /bd/);
});

test('fx lpf applies', () => {
  const r = C([src('s', 's("bd")'), fx('f', 'lpf', { cutoff: 900 }), out()], [E('s', 'f'), E('f', 'o')]);
  assert.match(code(r), /\.lpf\(900\)/);
});

test('transform ply applies', () => {
  const r = C([src('s', 's("bd")'), tr('t', 'ply', { n: 4 }), out()], [E('s', 't'), E('t', 'o')]);
  assert.match(code(r), /\.ply\(4\)/);
});

test('euclid uses euclid(p, s)', () => {
  const r = C([src('s', 's("bd")'), tr('t', 'euclid', { pulses: 3, steps: 8, rot: 0 }), out()], [E('s', 't'), E('t', 'o')]);
  assert.match(code(r), /\.euclid\(3, 8\)/);
});

test('synth oscillator emits the waveform', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'sawtooth' } }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.s\("sawtooth"\)/);
});

test('synth on a SAMPLE never overrides it with an oscillator (regression)', () => {
  const r = C([src('s', 's("kick")', { synthOn: true, synth: { wave: 'sawtooth', cutoff: 800 } }), out()], [E('s', 'o')]);
  assert.doesNotMatch(code(r), /\.s\("sawtooth"\)/);
  assert.doesNotMatch(code(r), /\.note\("c3"\)/);
  assert.match(code(r), /\.lpf\(800\)/);
});

test('sample loop natural = .slow, beat = .loopAt', () => {
  const nat = C([src('s', 's("g")', { synthOn: true, synth: { loop: 3, loopMode: 'natural' } }), out()], [E('s', 'o')]);
  assert.match(code(nat), /\.slow\(3\)/);
  const beat = C([src('s', 's("g")', { synthOn: true, synth: { loop: 2, loopMode: 'beat' } }), out()], [E('s', 'o')]);
  assert.match(code(beat), /\.loopAt\(2\)/);
});

test('sample reverse = negative speed', () => {
  const r = C([src('s', 's("g")', { synthOn: true, synth: { reverse: true, speed: 1.5 } }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.speed\(-1\.50\)/);
});

test('begin/end trim injected right after s()', () => {
  const r = C([src('s', 's("g")', { begin: 0.1, end: 0.8 }), out()], [E('s', 'o')]);
  assert.match(code(r), /s\("g"\)\.begin\(0\.100\)\.end\(0\.800\)/);
});

test('FM operator + filter slope + tuning', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: { fm: 3, fmwave: 'triangle', fmattack: 0.02, cutoff: 1000, ftype: 1, octave: 1 } }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.fmwave\("triangle"\)/);
  assert.match(code(r), /\.fmattack\(0\.020\)/);
  assert.match(code(r), /\.ftype\("ladder"\)/);
  assert.match(code(r), /\.add\(note\(12\)\)/);
});

test('sidechain duck: trigger emits .duck and the ducked branch gets its own orbit', () => {
  const r = C([
    src('kick', 's("bd*4")'),
    src('bass', 'note("c1").s("sawtooth")'),
    fx('sc', 'sidechain', { mode: 'duck', trigger: 'kick' }),
    out(),
  ], [E('kick', 'o'), E('bass', 'sc'), E('sc', 'o')]);
  assert.match(code(r), /\.duck\(/);      // el kick duckea
  assert.match(code(r), /\.orbit\(\d+\)/); // el bajo va a su orbit para ser duckeado
});

test('channel pan emits .pan() (mix), centre = no pan', () => {
  const left = C([src('s', 's("hh*8")', { chPan: 0.2 }), out()], [E('s', 'o')]);
  assert.match(code(left), /\.pan\(0\.20\)/);
  const centre = C([src('s', 's("bd")', { chPan: 0.5 }), out()], [E('s', 'o')]);
  assert.doesNotMatch(code(centre), /\.pan\(/);
});

test('channel EQ routes the source to its own orbit', () => {
  const r = C([src('s', 's("bd")', { eq: { on: true, low: 3, mid: 0, high: 0, midFreq: 1000 } }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.orbit\(\d+\)/);
  assert.equal(r.channelEqs.length, 1);
});

test('crossfader: deck A quiet, deck B loud at pos=1', () => {
  const r = C([src('a', 's("bd")', { xfa: 'a' }), src('b', 's("hh")', { xfa: 'b' }), out()], [E('a', 'o'), E('b', 'o')], { xfader: 1 });
  // A = cos(pi/2) ≈ 0 → mul(gain(0.00)); B = sin(pi/2) = 1 → sin side loud
  assert.match(code(r), /\.mul\(gain\(0\.00\)\)/);
});

// --- P0.1 (auditoría dancehall): la ganancia de MEZCLA compone, no pisa ---------
// Dos `.gain()` encadenados en Strudel se combinan con `set` (el 2º gana), así que
// el fader/humanize/gate deben emitirse con `.mul(gain|velocity)` para multiplicar
// los acentos/velocity internos en vez de borrarlos. (verificado contra @strudel/core)

test('P0.1a fader de canal: .mul(gain) — los acentos del patrón sobreviven', () => {
  const r = C([src('s', 's("bd sd").gain("1 1.4")', { gain: 0.5 }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.mul\(gain\(0\.50\)\)/);
  assert.match(code(r), /\.gain\("1 1\.4"\)/); // los acentos siguen intactos
});

test('P0.1b humanize del máster: .mul(velocity(rand…)) — no borra el balance de canales', () => {
  const m = applyMaster('stack(s("bd").gain(0.9), s("hh").gain(0.2))', { gain: 1, filter: 0, room: 0, humanize: 0.5 });
  assert.match(m, /\.mul\(velocity\(rand\.range\(0\.82, 1\)\)\)/);
  assert.doesNotMatch(m, /\.gain\(rand/);
});

test('P0.1c gain del máster: .mul(gain(x)) multiplicativo', () => {
  const m = applyMaster('s("bd")', { gain: 1.3, filter: 0, room: 0 });
  assert.match(m, /\.mul\(gain\(1\.30\)\)/);
});

test('P1.3 delay del synth: delaysync solo se emite si difiere del 3/16 del motor', () => {
  const base = { kind: 'source', code: 'note("c3").s("sawtooth")', synthOn: true } as Record<string, unknown>;
  const dub = C([src('s', 'note("c3").s("sawtooth")', { ...base, synth: { delay: 0.3, delayfb: 0.5 } }), out()], [E('s', 'o')]);
  assert.match(code(dub), /\.delay\(0\.30\)\.delayfeedback\(0\.50\)/);
  assert.doesNotMatch(code(dub), /\.delaysync\(/); // 3/16 es el default del motor → no ensucia
  const negra = C([src('s', 'note("c3").s("sawtooth")', { ...base, synth: { delay: 0.3, delaysync: 0.25 } }), out()], [E('s', 'o')]);
  assert.match(code(negra), /\.delaysync\(0\.25\)/);
});

test('AUDICIÓN DE SECCIÓN: con solo + seqPreviewCode se compila el brazo (en loop)', () => {
  const arrange = 'arrange([4, s("hh*8")], [12, s("hh*16")])';
  const r = C([src('s', arrange, { solo: true, seqPreviewCode: 's("hh*8")' }), out()], [E('s', 'o')]);
  assert.match(code(r), /s\("hh\*8"\)/);
  assert.doesNotMatch(code(r), /arrange/); // suena la sección, no el arreglo entero
});

test('AUDICIÓN DE SECCIÓN: sin solo, un seqPreviewCode rancio NO altera nada', () => {
  const arrange = 'arrange([4, s("hh*8")], [12, s("hh*16")])';
  const r = C([src('s', arrange, { seqPreviewCode: 's("hh*8")' }), out()], [E('s', 'o')]);
  assert.match(code(r), /arrange/);
});

test('eco vocal al tempo: delaysync solo se emite si difiere del 3/16 del motor', () => {
  const base = C([src('s', 's("voz_1")', { voice: { delay: 0.3 } }), out()], [E('s', 'o')]);
  assert.match(code(base), /\.delay\(0\.30\)/);
  assert.doesNotMatch(code(base), /\.delaysync\(/); // 3/16 = default del motor
  const negra = C([src('s', 's("voz_1")', { voice: { delay: 0.3, delaysync: 0.25 } }), out()], [E('s', 'o')]);
  assert.match(code(negra), /\.delaysync\(0\.25\)/);
});

test('P0.2 swing del máster: semicorcheas (n=8) — el tumbao del dembow', () => {
  const m = applyMaster('s("hh*16")', { gain: 1, filter: 0, room: 0, swing: 0.3 });
  assert.match(m, /\.swingBy\(0\.30, 8\)/);
});

test('P0.1 gate del máster: corte multiplicativo (mantiene el balance mientras corta)', () => {
  const m = applyMaster('s("bd")', { gain: 1, filter: 0, room: 0, gate: 4 });
  assert.match(m, /\.mul\(gain\(square\.range\(0, 1\)\.fast\(4\)\)\)/);
});

test('U · perf por source: roll/rev/gate(mul, P0.1)/echo/wash emitidos por ESTE source', () => {
  const r = C([src('s', 's("bd*4")', { perf: { roll: 4, rev: true, gate: 8, echo: 0.55, wash: 0.7 } }), out()], [E('s', 'o')]);
  const c = code(r);
  // gate: JAMÁS `.gain(square` (pisaría los acentos del patrón) → SIEMPRE `.mul(gain(square`
  assert.ok(!/\.gain\(square/.test(c), 'el gate por-source no debe usar .gain(square (PISA los acentos)');
  assert.match(c, /\.mul\(gain\(square\.range\(0, 1\)\.fast\(8\)\)\)/);
  assert.match(c, /\.ply\(4\)/); // roll (patrón)
  assert.match(c, /\.rev\(\)/); // reverse (patrón)
  assert.match(c, /\.delay\(0\.55\)/); // echo (audio)
  assert.match(c, /\.room\(0\.70\)/); // wash (audio) — unificado en el send del canal
});

test('V3 · reverb del canal: chRoom y wash se unifican en UN solo .room (max), sin pisado', () => {
  const r = C([src('s', 's("bd*4")', { chRoom: 0.3, perf: { wash: 0.7 } }), out()], [E('s', 'o')]);
  const c = code(r);
  assert.equal((c.match(/\.room\(/g) ?? []).length, 1, 'un solo .room() por source (no se pisan)');
  assert.match(c, /\.room\(0\.70\)/); // max(chRoom 0.3, wash 0.7)
});

test('V3 · chRoom sin wash → .room(chRoom)', () => {
  const r = C([src('s', 's("bd")', { chRoom: 0.4 }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.room\(0\.40\)/);
});

test('P0.1 invariante: la mezcla nunca emite un .gain( escalar que pise', () => {
  const r = C([src('s', 's("bd sd").gain("1 1.4 0.5 1")', { gain: 0.7 }), out()], [E('s', 'o')]);
  const m = applyMaster(code(r), { gain: 1.2, filter: 0, room: 0, humanize: 0.3 });
  // .gain( sin comilla tras el paréntesis = escalar/señal de mezcla → prohibido.
  // (el .gain("…") de acentos del propio patrón sí es legítimo)
  const scalar = m.match(/\.gain\((?!")[^)]*\)/g) ?? [];
  assert.equal(scalar.length, 0, `emisiones que pisan: ${scalar.join(' · ')}`);
});

test('isSampleSource distinguishes samples from oscillators', () => {
  assert.equal(isSampleSource('s("kick")'), true);
  assert.equal(isSampleSource('note("c3").s("sawtooth")'), false);
  assert.equal(isSampleSource('note("c3")'), false);
  assert.equal(isSampleSource('s("sawtooth")'), false);
});

test('master reverb: built-in space emits .ir with its EXACT roomsize (no loop/truncate)', () => {
  const out = applyMaster('s("bd")', { gain: 1, filter: 0, room: 0.4, space: 'ir_hall' });
  assert.match(out, /\.room\(0\.40\)/);
  assert.match(out, /\.ir\("ir_hall"\)\.roomsize\(2\.2\)/);
});

test('master reverb: a real (user) IR uses its MEASURED duration', () => {
  registerUserIr({ name: 'ir_u_bricasti', label: 'bricasti', duration: 3.47 });
  const out = applyMaster('s("bd")', { gain: 1, filter: 0, room: 0.5, space: 'ir_u_bricasti' });
  assert.match(out, /\.ir\("ir_u_bricasti"\)\.roomsize\(3\.5\)/);
});

test('master reverb: unknown IR falls back to algorithmic (no .ir emitted)', () => {
  const out = applyMaster('s("bd")', { gain: 1, filter: 0, room: 0.4, space: 'ir_missing' });
  assert.match(out, /\.room\(0\.40\)/);
  assert.doesNotMatch(out, /\.ir\(/);
});

test('master reverb: space with no room send emits nothing (room gates the IR)', () => {
  const out = applyMaster('s("bd")', { gain: 1, filter: 0, room: 0, space: 'ir_hall' });
  assert.doesNotMatch(out, /\.ir\(/);
  assert.doesNotMatch(out, /\.room\(/);
});
