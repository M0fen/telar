// Piano roll (9.4): código de una melodía, acordes en la escala del tema, notas largas y filas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMel, buildMel, melState, placeAt, removeNote, moveStep, setGate, snapGate, regrid, setBarsTo, setPerBar, chordShape, scalePcs, rollRows, shiftByRows, chordMidis } from '../src/nodes/melCode.ts';

const AMIN = { root: 9, minor: true };
const names = (ms: number[]) => ms.map((m) => ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'][m % 12] + (Math.floor(m / 12) - 1)).join(' ');

test('round-trip: notas, acordes, fuerza, duración, slide y compases', () => {
  const src = 'note("a2 ~ [a2,c3,e3] ~").s("sawtooth").lpf(650).gain("1 1 0.6 1").clip("1 1 3 1").slow(2)';
  const p = parseMel(src)!;
  assert.deepEqual(p.tokens, ['a2', '~', '[a2,c3,e3]', '~']);
  assert.equal(p.cycles, 2);
  const st = melState(p, 4);
  assert.equal(buildMel(p, st.cells, st.vels, st.gates, p.slide), src);
});

test('acorde escrito con espacios es UN paso', () => {
  const p = parseMel('note("[a2, c3, e3] ~ ~ ~").s("square")')!;
  assert.equal(p.tokens.length, 4);
  assert.deepEqual(chordMidis(p.tokens[0]), [45, 48, 52]);
});

test('poner, sumar al acorde, quitar y mover notas', () => {
  let st = melState(parseMel('note("~ ~ ~ ~").s("sawtooth")')!, 4);
  st = placeAt(st, 0, [45]);
  st = placeAt(st, 0, [52], true);
  assert.equal(st.cells[0], '[a2,e3]');
  st = removeNote(st, 0, 45);
  assert.equal(st.cells[0], 'e3');
  st = setGate(st, 0, 3);
  st = moveStep(st, 0, 1, (m) => m + 2);
  assert.deepEqual(st.cells, ['~', 'gb3', '~', '~']);
  assert.equal(st.gates[1], 3); // la nota larga viaja con su duración (cabe: 3 pasos desde el 2)
  assert.equal(st.gates[0], 1);
});

test('nota larga: el borde se pega a pasos enteros (y a cuartos por debajo de uno)', () => {
  assert.equal(snapGate(3.4), 3);
  assert.equal(snapGate(0.9), 1);
  assert.equal(snapGate(0.6), 0.5);
  assert.equal(snapGate(0.1), 0.25);
  const st = setGate(melState(parseMel('note("a2 ~ ~ ~").s("sine")')!, 4), 2, 9);
  assert.equal(st.gates[2], 2); // no pasa del final del patrón
});

test('resolución y compases: suena igual al multiplicar los pasos', () => {
  const st = melState(parseMel('note("a2 c3").s("sine")')!, 2);
  const up = regrid(st, 16);
  assert.equal(up.cells[0], 'a2');
  assert.equal(up.cells[8], 'c3');
  assert.equal(up.gates[8], 8); // cada nota sigue durando medio compás
  const two = setBarsTo(up, 1, 2);
  assert.equal(two.cells.length, 32);
  assert.equal(two.cells[24], 'c3');
  const per = setPerBar(two, 2, 8);
  assert.equal(per.cells.length, 16);
  assert.equal(per.cells[8], 'a2'); // el compás 2 empieza en el paso 9
});

test('acordes en la escala del tema: tríada y séptima diatónicas en La menor', () => {
  assert.deepEqual(scalePcs(AMIN), [9, 11, 0, 2, 4, 5, 7]);
  assert.equal(names(chordShape(45, 'tríada', AMIN)), 'a2 c3 e3'); // Am
  assert.equal(names(chordShape(48, 'tríada', AMIN)), 'c3 e3 g3'); // C
  assert.equal(names(chordShape(47, 'tríada', AMIN)), 'b2 d3 f3'); // B° (en tono)
  assert.equal(names(chordShape(53, '7ª', AMIN)), 'f3 a3 c4 e4'); // Fmaj7
  assert.equal(names(chordShape(50, 'sus4', AMIN)), 'd3 g3 a3');
  // fuera de la escala o sin tonalidad: tríada menor
  assert.equal(names(chordShape(46, 'tríada', AMIN)), 'bb2 db3 f3');
  assert.equal(names(chordShape(48, 'tríada', null)), 'c3 eb3 g3');
});

test('filas: plegar a la escala sin esconder notas usadas; subir grados en la vista plegada', () => {
  const pcs = scalePcs(AMIN);
  const rows = rollRows(45, 57, 'escala', pcs, [46]);
  assert.deepEqual(rows, [57, 55, 53, 52, 50, 48, 47, 46, 45]); // a3 g3 f3 e3 d3 c3 b2 (bb2 usada) a2
  assert.equal(shiftByRows(45, rows, 2), 47); // a2 sube 2 filas: bb2 (usada) y b2
  assert.equal(shiftByRows(48, rows.filter((m) => m !== 46), 2), 52); // c3 + 2 grados = e3
  assert.deepEqual(rollRows(40, 44, 'usadas', pcs, [43]), [43]);
  assert.equal(shiftByRows(60, [], 3), 63); // fuera de las filas: semitonos
});
