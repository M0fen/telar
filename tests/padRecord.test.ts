import { test } from 'node:test';
import assert from 'node:assert/strict';
import { velToGain, scaleNote, drumPadMap, baseOctave, patternPeriod, stepAt, toGrid, locate, recordPadHit, midiName } from '../src/lib/padRecord.ts';
import { parseSeq, splitArrange } from '../src/nodes/stepseqCode.ts';

const AMIN = { root: 9, minor: true };

test('fuerza del pad → velocity del paso', () => {
  assert.equal(velToGain(100 / 127), 1);
  assert.equal(velToGain(1), 1.27);
  assert.equal(velToGain(40 / 127), 0.4);
  assert.equal(velToGain(0.05), 0.3);
});

test('pads en la escala del tema (dos octavas desde la tónica)', () => {
  assert.equal(scaleNote(0, AMIN, 2), 'a2');
  assert.equal(scaleNote(2, AMIN, 2), 'c3'); // la menor: a b c…
  assert.equal(scaleNote(7, AMIN, 2), 'a3');
  assert.equal(scaleNote(15, AMIN, 2), 'b4');
  assert.equal(scaleNote(2, { root: 0, minor: false }, 3), 'e3'); // do mayor
  assert.equal(scaleNote(2, null, 3), 'eb3'); // sin tonalidad: do menor
  assert.equal(midiName(60), 'c4');
});

test('pads de batería: mapa estable (sonidos propios, luego la batería en orden fijo)', () => {
  assert.deepEqual(drumPadMap('s("hh*8")').slice(0, 5), ['bd', 'sd', 'cp', 'hh', 'oh']);
  assert.deepEqual(drumPadMap('s("crate_conga ~ bd ~")').slice(0, 3), ['crate_conga', 'bd', 'sd']);
  assert.equal(drumPadMap('s("~ ~ ~ ~")')[15], null); // 12 de batería: los últimos pads, libres
  // con secciones: los propios de todas
  assert.deepEqual(drumPadMap('arrange([2, s("kick_a*4")], [2, s("perc_b ~ ~ ~")])').slice(0, 3), ['kick_a', 'perc_b', 'bd']);
});

test('octava de partida: la de la nota más grave', () => {
  assert.equal(baseOctave(parseSeq('note("c2 ~ eb2 ~ g1 ~ ~ ~").s("sawtooth")')!.lanes), 1);
  assert.equal(baseOctave(parseSeq('note("eb4 ~ c4 ~").s("square")')!.lanes), 4);
  assert.equal(baseOctave([]), 3);
});

test('cuantizado al paso más cercano, en el bucle de la pista', () => {
  assert.equal(stepAt(0.24, 1, 16), 4);
  assert.equal(stepAt(0.99, 1, 16), 0); // casi al final: al primer paso de la vuelta
  assert.equal(stepAt(7.26, 1, 16), 4); // cualquier vuelta
  assert.equal(stepAt(1.5, 2, 32), 24); // patrón de 2 compases
  assert.equal(patternPeriod('note("c3 ~").s("saw").slow(2)'), 2);
  assert.equal(patternPeriod('s("bd*4")'), 1);
});

test('rejilla gruesa → semicorcheas sin cambiar lo que suena', () => {
  const p = parseSeq('s("bd*4")')!;
  const g = toGrid(p.lanes, p.steps);
  assert.equal(g.steps, 16);
  assert.deepEqual(g.lanes[0].steps.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0), [0, 4, 8, 12]);
});

test('grabar un golpe: entra en su paso con su fuerza y suena igual lo demás', () => {
  const r = recordPadHit('s("bd*4").bank("RolandTR909")', { pad: 2, vel: 1, bar: 5.13, mode: 'drum', key: null, octave: 3 })!;
  assert.equal(r.sound, 'cp'); // pad 1 bombo, 2 caja, 3 clap…
  assert.equal(r.step, 2);
  const p = parseSeq(r.code)!;
  assert.equal(p.steps, 16);
  const bd = p.lanes.find((l) => l.sound === 'bd')!;
  const cp = p.lanes.find((l) => l.sound === 'cp')!;
  assert.deepEqual(bd.steps.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0), [0, 4, 8, 12]);
  assert.equal(cp.steps[2], 1.27);
  assert.equal(p.bank, 'RolandTR909');
  // un segundo golpe en otra vuelta (sobregrabación), con el mapa fijo de la toma
  const map = drumPadMap('s("bd*4").bank("RolandTR909")');
  assert.deepEqual(map.slice(0, 4), ['bd', 'sd', 'cp', 'hh']);
  assert.deepEqual(drumPadMap(r.code), map); // grabar no mueve los pads
  const r2 = recordPadHit(r.code, { pad: 2, sound: map[2], vel: 100 / 127, bar: 9.5, mode: 'drum', key: null, octave: 3 })!;
  const cp2 = parseSeq(r2.code)!.lanes.find((l) => l.sound === 'cp')!;
  assert.equal(cp2.steps[2], 1.27);
  assert.equal(cp2.steps[8], 1);
});

test('modo escala: la nota del pad en su paso (pista afinada)', () => {
  const r = recordPadHit('note("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~").s("sawtooth").lpf(800)', { pad: 4, vel: 0.8, bar: 0.5, mode: 'scale', key: AMIN, octave: 2 })!;
  assert.equal(r.note, 'e3');
  assert.equal(r.step, 8);
  assert.match(r.code, /^note\("~ ~ ~ ~ ~ ~ ~ ~ e3 ~ ~ ~ ~ ~ ~ ~"\)\.s\("sawtooth"\)/);
  assert.match(r.code, /\.lpf\(800\)/);
  // patrón de 2 compases (.slow(2)): la segunda mitad del segundo compás
  const r2 = recordPadHit('note("c3 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~").s("sawtooth").slow(2)', { pad: 0, vel: 0.8, bar: 3.5, mode: 'scale', key: AMIN, octave: 2 })!;
  assert.equal(r2.step, 24);
  const l = parseSeq(r2.code)!.lanes[0];
  assert.equal(l.steps.length, 32);
  assert.equal(l.notes[0], 'c3'); // lo que había se queda en su sitio
  assert.equal(l.notes[24], 'a2');
});

test('por secciones: el golpe entra en la sección que suena (una vacía toma la instrumentación de otra)', () => {
  const code = 'arrange([2, s("bd*4").bank("RolandTR909")], [2, silence])';
  assert.deepEqual(locate(code, 2.5), { pat: 'silence', pos: 0.5, arm: 1 });
  const r = recordPadHit(code, { pad: 0, vel: 0.8, bar: 6.75, mode: 'drum', key: null, octave: 3 })!; // vuelta 2, sección 2
  const arms = splitArrange(r.code)!;
  assert.match(arms[0].code, /bd\*4|bd ~ ~ ~/); // la primera sección intacta
  const p = parseSeq(arms[1].code)!;
  assert.deepEqual(p.lanes[0].steps.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0), [12]);
});

test('no graba encima de un loop ni de un patrón avanzado', () => {
  assert.equal(recordPadHit('s("wl_ab12_x").slow(4)', { pad: 0, vel: 0.8, bar: 0, mode: 'drum', key: null, octave: 3 }), null);
  assert.equal(recordPadHit('s("<bd sd> hh").fast(2)', { pad: 0, vel: 0.8, bar: 0, mode: 'drum', key: null, octave: 3 }), null);
});
