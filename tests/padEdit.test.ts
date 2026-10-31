import test from 'node:test';
import assert from 'node:assert/strict';
import { editLaneEverywhere, laneOf } from '../src/lib/padEdit.ts';
import { drumPadMap } from '../src/lib/padRecord.ts';

const pat = (hh: string) => `stack(s("bd ~ ~ ~ bd ~ ~ ~"), s("${hh}")).bank("RolandTR909")`;

test('un pad se edita en todas las secciones (también la apagada)', () => {
  const code = `arrange([4, ${pat('hh hh hh hh hh hh hh hh')}], [4, ${pat('~ hh ~ hh ~ hh ~ hh')}.mask(0)], [2, silence])`;
  const out = editLaneEverywhere(code, 'hh', (l) => ({ ...l, sfx: '.cut(1)' }));
  assert.equal((out.match(/\.cut\(1\)/g) ?? []).length, 2);
  assert.match(out, /\.mask\(0\)/);
  assert.match(out, /\[2, silence\]/);
  assert.equal(laneOf(out, 'hh')?.sfx, '.cut(1)');
  assert.equal(laneOf(out, 'bd')?.sfx, undefined);
});

test('sin arrange: se edita el patrón; un sonido que no está no cambia nada', () => {
  const code = pat('hh*8');
  assert.equal(editLaneEverywhere(code, 'oh', (l) => ({ ...l, sfx: '.cut(1)' })), code);
  const out = editLaneEverywhere(code, 'bd', (l) => ({ ...l, sound: 'bd:3' }));
  assert.match(out, /bd:3/);
});

test('una variante (bd:3) se queda en el pad del bombo', () => {
  const m = drumPadMap(pat('hh*8').replace('"bd ~ ~ ~ bd ~ ~ ~"', '"bd:3 ~ ~ ~ bd:3 ~ ~ ~"'));
  assert.equal(m[0], 'bd:3');
  assert.equal(m[3], 'hh');
});
