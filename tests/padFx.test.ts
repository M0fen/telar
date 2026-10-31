import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePadFx, buildPadFx, padFxValues, hatPair, PAD_FX_DEFAULT } from '../src/lib/padFx.ts';

test('sufijo vacío = sin efectos; y vuelve vacío', () => {
  assert.deepEqual(parsePadFx(''), PAD_FX_DEFAULT);
  assert.equal(buildPadFx(PAD_FX_DEFAULT), '');
});

test('ida y vuelta: tono, decaimiento, filtro, paneo, reverb y corte; lo demás se conserva', () => {
  const sfx = '.bank("RolandTR808").speed(1.122).decay(0.2).sustain(0).lpf(800).pan(0.3).room(0.25).cut(1)';
  const fx = parsePadFx(sfx);
  assert.equal(fx.semis, 2);
  assert.equal(fx.decay, 0.2);
  assert.ok(fx.filter < -0.3);
  assert.equal(fx.pan, 0.3);
  assert.equal(fx.room, 0.25);
  assert.equal(fx.cut, 1);
  assert.equal(fx.rest, '.bank("RolandTR808")');
  const out = buildPadFx(fx);
  assert.match(out, /^\.bank\("RolandTR808"\)\.speed\(1\.122\)\.decay\(0\.2\)\.sustain\(0\)\.lpf\(8\d\d\)\.pan\(0\.3\)\.room\(0\.25\)\.cut\(1\)$/);
  assert.deepEqual(parsePadFx(out), { ...fx, filter: parsePadFx(out).filter });
});

test('un .decay sin sustain(0) no es el decaimiento del pad: se conserva tal cual', () => {
  const fx = parsePadFx('.decay(0.3)');
  assert.equal(fx.decay, null);
  assert.equal(buildPadFx(fx), '.decay(0.3)');
});

test('filtro: pasa-altos a la derecha; audición con los mismos controles', () => {
  const out = buildPadFx({ ...PAD_FX_DEFAULT, filter: 0.5, cut: 2 });
  assert.match(out, /^\.hpf\(316\)\.cut\(2\)$/);
  const v = padFxValues(parsePadFx(out));
  assert.ok(Math.abs(v.hcutoff - 316) < 2);
  assert.equal(v.cut, 2);
});

test('el cerrado corta al abierto: encuentra el par de hats', () => {
  assert.deepEqual(hatPair(['bd', 'hh', 'oh', 'cp']), { closed: 'hh', open: 'oh' });
  assert.deepEqual(hatPair(['bd', 'hh:2', 'oh:1']), { closed: 'hh:2', open: 'oh:1' });
  assert.equal(hatPair(['bd', 'hh']), null);
});
