import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph, isSampleSource, applyMaster, applyGlobalMaster, sanitizeMasterFx, releaseMomentary, withoutMomentary } from '../src/graph/compile.ts';
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

test('wavetable de morph emite .s(tabla).wt(posición estática)', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'telar_sweep', wtpos: 0.5 } }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.s\("telar_sweep"\)\.wt\(0\.500\)/);
});

test('wavetable de morph: el patrón de posición (wtpat) pisa al valor estático', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'telar_sweep', wtpos: 0.5, wtpat: '0 .5 <.25 1>' } }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.wt\("0 \.5 <\.25 1>"\)/);
  assert.doesNotMatch(code(r), /\.wt\(0\.500\)/);
});

test('wavetable de morph: unísono solo al engordar (voces>1); 1 voz = morph puro', () => {
  const puro = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'telar_sweep', unison: 1, detune: 0.18, spread: 0.4 } }), out()], [E('s', 'o')]);
  assert.doesNotMatch(code(puro), /\.unison\(|\.detune\(|\.spread\(/);
  const gordo = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'telar_sweep', unison: 5, detune: 0.2, spread: 0.5 } }), out()], [E('s', 'o')]);
  assert.match(code(gordo), /\.unison\(5\)\.detune\(0\.200\)\.spread\(0\.50\)/);
});

test('.wt solo en ondas de morph (una onda básica no lo emite)', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'sawtooth', wtpos: 0.5 } }), out()], [E('s', 'o')]);
  assert.doesNotMatch(code(r), /\.wt\(/);
});

test('onda PROPIA multi-cuadro (telar_user_*) emite .wt (morph); con 1 cuadro no', () => {
  const uw2 = [[{ x: 0, y: 0 }, { x: 0.5, y: 1 }], [{ x: 0, y: 1 }, { x: 0.5, y: -1 }]];
  const multi = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'telar_user_s', userWave: uw2, wtpos: 0.5 } }), out()], [E('s', 'o')]);
  assert.match(code(multi), /\.s\("telar_user_s"\)\.wt\(0\.500\)/);
  const uw1 = [[{ x: 0, y: 0 }, { x: 0.5, y: 1 }]];
  const single = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'telar_user_s', userWave: uw1, wtpos: 0.5 } }), out()], [E('s', 'o')]);
  assert.doesNotMatch(code(single), /\.wt\(/);
});

test('multi-oscilador: sin capas = una sola onda (sin stack, sin regresión)', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: { wave: 'sawtooth' } }), out()], [E('s', 'o')]);
  assert.match(code(r), /note\("c3"\)\.s\("sawtooth"\)/);
  assert.doesNotMatch(code(r), /stack\(/);
});

test('multi-oscilador: una capa extra → stack(OSC A.gain, capa) + filtro/envolvente compartidos', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: {
    wave: 'sawtooth', levelA: 0.8,
    oscLayers: [{ wave: 'square', level: 0.5, octave: -1 }],
    cutoff: 1000,
  } }), out()], [E('s', 'o')]);
  const c = code(r);
  assert.match(c, /stack\(/);
  assert.match(c, /note\("c3"\)\.s\("sawtooth"\)\.gain\(0\.80\)/);                       // OSC A con su nivel
  assert.match(c, /note\("c3"\)\.s\("square"\)\.add\(note\(-12\.000\)\)\.gain\(0\.50\)/); // capa -1 octava
  assert.match(c, /\.attack\(/);   // envolvente compartida, tras el stack
  assert.match(c, /\.lpf\(1000\)/); // filtro compartido, tras el stack
});

test('multi-oscilador: capa con detune fino suma semitonos fraccionarios', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: {
    wave: 'sawtooth', oscLayers: [{ wave: 'sawtooth', level: 0.6, detune: 0.1 }],
  } }), out()], [E('s', 'o')]);
  assert.match(code(r), /\.s\("sawtooth"\)\.add\(note\(0\.100\)\)\.gain\(0\.60\)/);
});

test('multi-oscilador: una capa de nivel ~0 se ignora (no genera stack)', () => {
  const r = C([src('s', 'note("c3")', { synthOn: true, synth: {
    wave: 'sawtooth', oscLayers: [{ wave: 'square', level: 0 }],
  } }), out()], [E('s', 'o')]);
  assert.doesNotMatch(code(r), /stack\(/);
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

// --- CLAMP DEFENSIVO del máster (proyectos importados de otra IA / JSON a mano) -----
// Un valor fuera de rango que la UI jamás produce no debe silenciar/romper la salida.
test('filtro de canal fuera de rango (filter:-2) se clampea a −1 → paso-bajo 100 Hz, COMPUESTO', () => {
  const bad = applyMaster('s("bd*4")', { gain: 1, filter: -2, room: 0 });
  assert.match(bad, /cutoff:Math\.min\(\+v\.cutoff\|\|20000,100\)/); // −1 → 100 Hz (no 1 Hz = mudo)
  assert.doesNotMatch(bad, /\.lpf\(/);          // nunca `.lpf(x)` suelto: pisaría el filtro propio de la voz
});

// ejecuta en JS el `.fmap(...)` emitido sobre el valor de UN evento → semántica real
const runFmap = (emitted: string, value: Record<string, unknown>): Record<string, unknown> => {
  const i = emitted.indexOf('.fmap(');
  assert.ok(i >= 0, `esperaba un .fmap( compuesto en: ${emitted}`);
  let d = 0;
  let j = i + 5;
  for (; j < emitted.length; j++) {
    if (emitted[j] === '(') d++;
    else if (emitted[j] === ')') { d--; if (!d) break; }
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (${emitted.slice(i + 6, j)})`)() as (v: Record<string, unknown>) => Record<string, unknown>;
  return fn(value);
};

test('filtro de canal COMPONE: nunca abre una voz ya oscura ni baja unos hats ya finos (antes los pisaba)', () => {
  const lp = applyMaster('s("x")', { gain: 1, filter: -0.2, room: 0 }); // paso-bajo ≈ 6371 Hz
  assert.equal(runFmap(lp, { s: 'sawtooth', cutoff: 300 }).cutoff, 300); // bajo oscuro: sigue en 300
  assert.equal(runFmap(lp, { s: 'bd' }).cutoff, 6371);                   // voz sin filtro: lo recibe
  const hp = applyMaster('s("x")', { gain: 1, filter: 0.2, room: 0 }); // paso-alto ≈ 60 Hz
  assert.equal(runFmap(hp, { s: 'sine', hcutoff: 1400 }).hcutoff, 1400); // silbido fino: no baja a 60
  assert.equal(runFmap(hp, { s: 'bd' }).hcutoff, 60);
});

test('REGRESIÓN c08aaf5: el filtro de cada pista (chFilter) vuelve a emitirse — deck DJ, nodo, escenas, MIDI', () => {
  const r = C(
    [src('a', 's("bd*4")', { chFilter: -0.5 }), src('b', 's("hh*8")', { chFilter: 0.5 }), src('c', 's("sd")'), out()],
    [E('a', 'o'), E('b', 'o'), E('c', 'o')],
  );
  const c = code(r);
  assert.match(c, /cutoff:Math\.min\(\+v\.cutoff\|\|20000,1342\)/);
  assert.match(c, /hcutoff:Math\.max\(\+v\.hcutoff\|\|0,316\)/);
  assert.equal((c.match(/\.fmap\(/g) ?? []).length, 2, 'solo las pistas con filtro');
});

test('máster GLOBAL: su filtro y su drive NO van en código (viven en el bus Web Audio)', () => {
  const g = applyGlobalMaster('s("bd")', { gain: 1, filter: -1, drive: 1, room: 0 });
  assert.doesNotMatch(g, /cutoff|\.lpf\(|\.hpf\(|\.shape\(/);
  const g2 = applyGlobalMaster('s("bd")', { gain: 1, filter: 1, room: 0 });
  assert.doesNotMatch(g2, /hcutoff|\.hpf\(/);
});

test('máster GLOBAL: reverb/eco/crush COMPONEN — subir la reverb nunca seca una voz que ya tenía', () => {
  const g = applyGlobalMaster('s("x")', { gain: 1, filter: 0, room: 0.3, delay: 0.4, crush: 0.25 });
  assert.doesNotMatch(g, /\.room\(|\.delay\(|\.crush\(/); // ningún sufijo que pise
  const wet = runFmap(g, { s: 'sine', room: 0.6, delay: 0.5, crush: 8 });
  assert.ok((wet.room as number) > 0.6, `room ${wet.room}`);   // 1-(0.4)(0.7) = 0.72 (antes: 0.3)
  assert.ok((wet.delay as number) > 0.5, `delay ${wet.delay}`); // 1-(0.5)(0.6) = 0.70 (antes: 0.4)
  assert.equal(wet.crush, 8);                                    // ya más crujiente que 13 bits: se queda
  const dry = runFmap(g, { s: 'bd' });
  assert.equal(Number((dry.room as number).toFixed(2)), 0.3);    // voz seca: recibe el envío exacto
  assert.equal(Number((dry.delay as number).toFixed(2)), 0.4);
  assert.equal(dry.crush, 13);
});

test('½ TIEMPO: desde el ancla todo a media velocidad sin salto (p.early(A/2).slow(2)), antes normal', () => {
  const g = applyGlobalMaster('s("bd sd")', { gain: 1, filter: 0, room: 0, half: 42.75 });
  assert.match(g, /^\(\(p\)=>stack\(/);                                   // envuelve el stack entero
  assert.match(g, /p\.filterHaps\(\(h\)=>!h\.whole\|\|h\.whole\.begin<42\.75\)/);   // antes del ancla: normal
  assert.match(g, /p\.early\(21\.375\)\.slow\(2\)\.filterHaps\(\(h\)=>!h\.whole\|\|h\.whole\.begin>=42\.75\)/);
  assert.doesNotMatch(applyGlobalMaster('s("bd")', { gain: 1, filter: 0, room: 0, half: 0 }), /slow\(2\)/);
  // el ancla se fuerza a la rejilla de pulsos (1/4 de ciclo)
  assert.match(applyGlobalMaster('s("bd")', { gain: 1, filter: 0, room: 0, half: 10.1 }), /begin<10\)/);
});

test('½ TIEMPO va PRIMERO: roll/gate actúan encima a tempo real', () => {
  const g = applyGlobalMaster('s("bd")', { gain: 1, filter: 0, room: 0, half: 4, roll: 2 });
  assert.ok(g.indexOf('slow(2)') < g.indexOf('.ply(2)'), g);
});

test('releaseMomentary: roll/gate/rev/½ tiempo nunca sobreviven a una carga; lo demás intacto', () => {
  const m = releaseMomentary({ gain: 0.8, filter: -0.3, room: 0.2, roll: 4, gate: 8, rev: true, half: 33 });
  assert.deepEqual([m.roll, m.gate, m.rev, m.half], [0, 0, false, 0]);
  assert.deepEqual([m.gain, m.filter, m.room], [0.8, -0.3, 0.2]);
});

test('withoutMomentary: una ESCENA no guarda ni aplica pads sostenidos (roll/gate/rev/½ tiempo)', () => {
  const m = withoutMomentary({ gain: 1.1, filter: 0.2, room: 0.3, roll: 8, gate: 4, rev: true, half: 12 });
  assert.deepEqual(Object.keys(m).sort(), ['filter', 'gain', 'room']);
});

test('máster GLOBAL con espacio IR: la reverb compuesta conserva .ir(...).roomsize(...)', () => {
  const g = applyGlobalMaster('s("bd")', { gain: 1, filter: 0, room: 0.4, space: 'ir_hall' });
  assert.match(g, /room:1-\(1-\(\+v\.room\|\|0\)\)\*0\.60/);
  assert.match(g, /\.ir\("ir_hall"\)\.roomsize\(2\.2\)/);
});

test('máster fuera de rango se CLAMPEA: crush:2 no emite crush(-8) (inválido) sino crush(4.0)', () => {
  const bad = applyMaster('s("bd*4")', { gain: 1, filter: 0, room: 0, crush: 2 });
  assert.doesNotMatch(bad, /\.crush\(-/);       // crush negativo = basura
  assert.match(bad, /\.crush\(4\.0\)/);         // clampeado a crush 1 → 4 bits
});

test('fuera de rango: room/gain/filtro acotados (no rompen ni silencian)', () => {
  const bad = applyMaster('s("bd*4")', { gain: 99, filter: 5, room: 9 });
  assert.doesNotMatch(bad, /\.mul\(gain\(99/);  // gain clampeado a 4
  assert.match(bad, /\.mul\(gain\(4\.00\)\)/);
  assert.match(bad, /\.room\(0\.95\)/);          // room clampeado a 0.95
  assert.match(bad, /hcutoff:Math\.max\(\+v\.hcutoff\|\|0,5000\)/); // filter 5 → 1 → paso-alto 5000
});

test('EN rango: crush/room en código; filtro de canal −0.5 → paso-bajo 1342 compuesto', () => {
  const ok = applyMaster('s("bd*4")', { gain: 1, filter: -0.5, room: 0.2, crush: 0.5 });
  assert.match(ok, /\.crush\(10\.0\)/);         // 16 - 0.5*12 = 10
  assert.match(ok, /\.room\(0\.20\)/);
  assert.match(ok, /cutoff:Math\.min\(\+v\.cutoff\|\|20000,1342\)/);
});

// --- sanitizeMasterFx: normaliza el máster al importar + describe qué cambió ----------
test('sanitizeMasterFx resetea a NEUTRO los valores de test111 y los reporta', () => {
  const { master, notes } = sanitizeMasterFx({ gain: 1, filter: -2, room: 0.18, crush: 2 } as any);
  assert.equal((master as any).filter, 0);     // -2 fuera de [-1,1] → 0 (sin filtro, SUENA)
  assert.equal((master as any).crush, 0);      // 2 fuera de [0,1] → 0 (sin crush)
  assert.equal((master as any).room, 0.18);    // en rango → intacto
  assert.ok(notes.some((n) => n.includes('filtro')));
  assert.ok(notes.some((n) => n.includes('crush')));
});

test('sanitizeMasterFx es NO-OP para un máster normal (notes vacío)', () => {
  const { master, notes } = sanitizeMasterFx({ gain: 1, filter: -0.3, room: 0.2, crush: 0.4, swing: 0.1 } as any);
  assert.deepEqual(notes, []);
  assert.equal((master as any).filter, -0.3);
  assert.equal((master as any).swing, 0.1);
});

// --- AISLAMIENTO de fuentes rotas (una fuente rota no silencia el stack entero) -------
test('fuente con sintaxis rota se AÍSLA (silence) y el resto sigue sonando', () => {
  const r = C([
    src('ok', 's("bd*4")', { name: 'bombo' }),
    src('bad', 's("hh*8").lpf(800', { name: 'roto' }), // paréntesis sin cerrar
    out(),
  ], [E('ok', 'o'), E('bad', 'o')]);
  assert.equal(r.error, null);            // compila igual (no tumba todo)
  assert.match(code(r), /s\("bd\*4"\)/);  // el bueno suena
  assert.deepEqual(r.dropped, ['roto']);  // el roto se reporta por nombre
  assert.doesNotMatch(code(r), /hh\*8\)\.lpf\(800/); // el código roto NO se emite
});

test('función flecha en una fuente NO se descarta (es Strudel válido)', () => {
  const r = C([src('a', 's("bd*4").every(4, x => x.rev())', { name: 'arrow' }), out()], [E('a', 'o')]);
  assert.equal(r.error, null);
  assert.deepEqual(r.dropped, []);
  assert.match(code(r), /every\(4, x => x\.rev\(\)\)/);
});

test('token peligroso (fetch) en una fuente se aísla', () => {
  const r = C([src('ok', 's("bd*4")'), src('x', 's("bd").speed(fetch("x"))', { name: 'malo' }), out()], [E('ok', 'o'), E('x', 'o')]);
  assert.deepEqual(r.dropped, ['malo']);
  assert.match(code(r), /s\("bd\*4"\)/);
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

test('voz glide: emite penv/pdecay (antes .slide, INERTE en samples); sin glide no', () => {
  const g = C([src('s', 's("voz_1")', { voice: { melody: 'c d e', glide: 0.5 } }), out()], [E('s', 'o')]);
  assert.match(code(g), /\.penv\(-2\.50\)\.pdecay\(0\.090\)/); // scoop que decae
  assert.doesNotMatch(code(g), /\.slide\(/);                   // ya no se emite el no-op
  const noGlide = C([src('s', 's("voz_1")', { voice: { melody: 'c d e' } }), out()], [E('s', 'o')]);
  assert.doesNotMatch(code(noGlide), /\.penv\(/);
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
