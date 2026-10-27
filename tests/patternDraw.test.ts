// Dibujo de un patrón (8.7 / 9.1): batería por filas, notas por altura y loops como barra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternFigure, noteNumber } from '../src/lib/patternDraw.ts';

const ev = (t: number, snd: string, note: number | null = null, d = 1 / 16, gain = 1) => ({ t, d, snd, note, gain });

test('batería: una fila por sonido, los más usados arriba', () => {
  const f = patternFigure([ev(0, 'bd'), ev(0.25, 'bd'), ev(0.5, 'bd'), ev(0.125, 'hh'), ev(0.375, 'hh'), ev(0.75, 'cp')], 1);
  assert.equal(f.kind, 'drums');
  assert.deepEqual(f.rows, ['bd', 'hh', 'cp']);
  const cp = f.shapes[5];
  assert.equal(cp.x, 0.75);
  assert.ok(Math.abs(cp.y - 2 / 3) < 1e-9);
});

test('notas: piano roll mínimo con la altura de cada nota', () => {
  const f = patternFigure([ev(0, 'sawtooth', 45, 0.1), ev(0.5, 'sawtooth', 52, 0.1)], 1);
  assert.equal(f.kind, 'notes');
  assert.deepEqual(f.range, [45, 52]);
  assert.ok(f.shapes[0].y > f.shapes[1].y); // la más grave más abajo
});

test('loop: un sample largo es una barra; nada es vacío', () => {
  assert.equal(patternFigure([ev(0, 'wl_shaker', null, 2)], 1).kind, 'loop');
  assert.equal(patternFigure([], 1).kind, 'empty');
});

test('nombres de nota a MIDI', () => {
  assert.equal(noteNumber('c4'), 60);
  assert.equal(noteNumber('a2'), 45);
  assert.equal(noteNumber('eb3'), 51);
  assert.equal(noteNumber('c#1'), 25);
  assert.equal(noteNumber(52), 52);
  assert.equal(noteNumber('hola'), null);
});

test('vueltas del patrón: cada cuántos compases se repite', async () => {
  const { patternPeriod } = await import('../src/lib/patternDraw.ts');
  const kick = Array.from({ length: 16 }, (_, b) => [0, 0.25, 0.5, 0.75].map((x) => ev(b + x, 'bd'))).flat();
  assert.equal(patternPeriod(kick, 16), 1);
  // fill en el último compás de cada 8
  const fill = Array.from({ length: 16 }, (_, b) => (b % 8 === 7 ? [0, 0.5, 0.625, 0.75, 0.875] : [0, 0.5]).map((x) => ev(b + x, 'sd'))).flat();
  assert.equal(patternPeriod(fill, 16), 8);
  // nada se repite dentro del tramo
  assert.equal(patternPeriod([ev(0, 'bd'), ev(1.5, 'bd'), ev(2.25, 'sd')], 3), 3);
});
