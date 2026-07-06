// V2 — tests de la lógica pura del mapa de energía del arreglo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionEnergy, type SceneLike } from '../src/lib/arrangeEnergy';

const ids = ['a', 'b', 'c', 'd'];

test('escena sin capturar → sin datos (captured false, frac 0)', () => {
  const e = sectionEnergy(undefined, ids);
  assert.equal(e.captured, false);
  assert.equal(e.active, 0);
  assert.equal(e.total, 4);
  assert.equal(e.frac, 0);
});

test('cuenta pistas audibles (no muteadas, gain > 0)', () => {
  const sc: SceneLike = { state: { a: {}, b: { mute: true }, c: { gain: 0 }, d: { gain: 1 } } };
  const e = sectionEnergy(sc, ids);
  assert.equal(e.captured, true);
  assert.equal(e.active, 2); // a (default audible) + d; b muteada, c gain 0
  assert.equal(e.total, 4);
  assert.ok(Math.abs(e.frac - 0.5) < 1e-9);
});

test('respeta el SOLO: solo suenan los soloed', () => {
  const sc: SceneLike = { state: { a: { solo: true }, b: {}, c: {}, d: {} } };
  const e = sectionEnergy(sc, ids);
  assert.equal(e.active, 1); // solo 'a'
  assert.ok(Math.abs(e.frac - 0.25) < 1e-9);
});

test('source no capturado en la escena → audible por defecto', () => {
  const sc: SceneLike = { state: { a: { mute: true } } }; // b/c/d no están
  const e = sectionEnergy(sc, ids);
  assert.equal(e.active, 3); // b, c, d por defecto audibles; a muteada
});

test('intro (poco) vs drop (lleno): frac distingue la densidad', () => {
  const intro: SceneLike = { state: { a: {}, b: { mute: true }, c: { mute: true }, d: { mute: true } } };
  const drop: SceneLike = { state: { a: {}, b: {}, c: {}, d: {} } };
  assert.ok(sectionEnergy(intro, ids).frac < sectionEnergy(drop, ids).frac);
  assert.equal(sectionEnergy(drop, ids).frac, 1);
});

test('sin sources → frac 0 sin dividir por cero', () => {
  const e = sectionEnergy({ state: {} }, []);
  assert.equal(e.total, 0);
  assert.equal(e.frac, 0);
});
