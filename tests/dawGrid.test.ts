// Regla y rejilla del DAW (Fase 8.1): compás.pulso.semicorchea, rejilla magnética y qué se dibuja
// con cada zoom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoGrid, effectiveGrid, fmtBarPos, fmtBarShort, gridBars, laneBackground, rulerPlan, snapTo } from '../src/lib/dawGrid.ts';
import { cleanTransitions } from '../src/lib/transitions.ts';

test('posición musical: compás.pulso.semicorchea desde 1', () => {
  assert.equal(fmtBarPos(0, 4), '1.1.1');
  assert.equal(fmtBarPos(24.375, 4), '25.2.3'); // compás 25, 1,5 pulsos dentro
  assert.equal(fmtBarPos(24.999999, 4), '25.4.4');
  assert.equal(fmtBarPos(3 + 2 / 3, 3), '4.3.1'); // 3/4: el tercer pulso
  assert.equal(fmtBarShort(24, 4), '25');
  assert.equal(fmtBarShort(24.5, 4), '25.3');
  assert.equal(fmtBarShort(24.0625, 4), '25.1.2');
});

test('rejilla fija en compases según el compás del tema', () => {
  assert.equal(gridBars('bar', 4), 1);
  assert.equal(gridBars('1/4', 4), 0.25);
  assert.equal(gridBars('1/16', 4), 1 / 16);
  assert.equal(gridBars('1/8T', 4), 1 / 12);
  assert.equal(gridBars('1/16T', 4), 1 / 24);
  assert.equal(gridBars('1/4', 3), 1 / 3); // en 3/4 un pulso es un tercio de compás
  assert.equal(gridBars('off', 4), 0);
});

test('rejilla automática: la más fina que mide al menos 12 px', () => {
  assert.equal(autoGrid(28, 4).label, '1/2'); // 14 px por medio compás
  assert.equal(autoGrid(10, 4).label, '2 compases');
  assert.equal(autoGrid(60, 4).label, '1/4');
  assert.equal(autoGrid(400, 4).label, '1/16');
  assert.equal(effectiveGrid('off', 100, 4).bars, 0);
  assert.equal(effectiveGrid('1/8', 100, 4).bars, 0.125);
});

test('imán: ajusta a la rejilla y sin imán deja la posición casi libre', () => {
  assert.equal(snapTo(24.4, 1), 24);
  assert.equal(snapTo(24.4, 0.25), 24.5);
  assert.equal(snapTo(24.3, 1 / 12), 24.333333);
  assert.equal(snapTo(24.3011, 0), Math.round(Math.round(24.3011 * 192) / 192 * 1e6) / 1e6);
});

test('la regla se adapta al zoom sin amontonarse', () => {
  assert.deepEqual(rulerPlan(10, 4), { labelEvery: 4, beatTicks: false, beatLabels: false, sixTicks: false });
  assert.deepEqual(rulerPlan(28, 4), { labelEvery: 1, beatTicks: true, beatLabels: false, sixTicks: false });
  assert.deepEqual(rulerPlan(130, 4), { labelEvery: 1, beatTicks: true, beatLabels: true, sixTicks: true });
  // líneas de las pistas: con poco zoom solo compás y frase; con mucho también pulsos y semicorcheas
  assert.equal(laneBackground(10, 4).backgroundImage.split('linear-gradient').length - 1, 3);
  assert.equal(laneBackground(200, 4).backgroundImage.split('linear-gradient').length - 1, 5);
});

test('transiciones: el compás puede caer en la rejilla fina (hasta tresillos)', () => {
  const [it] = cleanTransitions([{ kind: 'impact', at: 24.5, bars: 1 }]);
  assert.equal(it.at, 24.5);
  const [tr] = cleanTransitions([{ kind: 'riser', at: 24 + 1 / 3, bars: 4 }]);
  assert.ok(Math.abs(tr.at - (24 + 1 / 3)) < 1e-9);
});
