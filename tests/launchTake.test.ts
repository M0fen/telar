import test from 'node:test';
import assert from 'node:assert/strict';
import { trackVariations, buildTake, stepsForTake } from '../src/lib/launchTake.ts';
import { splitArrange } from '../src/nodes/stepseqCode.ts';

test('variaciones: patrones distintos del arreglo (el apagado cuenta, el silencio no)', () => {
  const v = trackVariations('arrange([8, s("bd*4")], [8, s("bd*4").mask(0)], [8, silence], [8, s("bd*2")])');
  assert.deepEqual(v.map((x) => `${x.code}@${x.arms.join(',')}`), ['s("bd*4")@0,1', 's("bd*2")@3']);
  assert.deepEqual(trackVariations('s("hh*8")').map((x) => x.code), ['s("hh*8")']);
});

test('la toma pasa al arreglo: cada lanzamiento suena hasta el siguiente', () => {
  let k = 0;
  const id = () => `n${k++}`;
  const steps = [{ id: 'a', scene: 1, bars: 8 }];
  const codes = { k: 'arrange([8, s("bd*4")])', h: 'arrange([8, s("hh*8")])' };
  const log = [
    { bar: 4, track: 'k', code: 's("bd*2")' },
    { bar: 4, track: 'h', code: 'silence' },
    { bar: 10, track: 'k', code: null }, // volver al arreglo (ahí ya no hay nada: silencio)
    { bar: 12, track: 'h', code: 's("oh*4")' },
  ];
  const r = buildTake(codes, steps, log, 4, 16, id)!;
  assert.deepEqual(r.steps.map((s) => `${s.name ?? s.id}:${s.bars}`), ['a:8', 'toma:8']);
  assert.deepEqual(splitArrange(r.codes.k)!.map((a) => `${a.bars}:${a.code}`), ['4:s("bd*4")', '6:s("bd*2")', '6:silence']);
  assert.deepEqual(splitArrange(r.codes.h)!.map((a) => `${a.bars}:${a.code}`), ['4:s("hh*8")', '4:silence', '4:silence', '4:s("oh*4")']);
});

test('secciones de la toma en tramos de 64 como máximo', () => {
  const s = stepsForTake([], 100, () => 'x');
  assert.deepEqual(s.map((x) => x.bars), [64, 36]);
});
