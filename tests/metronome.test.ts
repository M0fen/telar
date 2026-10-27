// Metrónomo y cuenta previa (Fase 8.3): el patrón del clic, la música corrida N ciclos y la línea
// de tiempo en negativo durante la cuenta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metronomeCode, withMetronome } from '../src/lib/metronome.ts';
import { timelinePos } from '../src/lib/songClock.ts';
import { applyTimeline } from '../src/graph/compile.ts';
import { fmtBarPos } from '../src/lib/dawGrid.ts';

test('clic: un golpe por pulso y acento en el 1', () => {
  assert.equal(metronomeCode(4, 0, true), 's("telar_click*4").n("1 0 0 0")');
  assert.equal(metronomeCode(3, 0, true), 's("telar_click*3").n("1 0 0")');
  assert.equal(metronomeCode(4, 0, false), ''); // apagado y sin cuenta: nada
  // apagado con cuenta previa: solo los compases de la cuenta
  assert.match(metronomeCode(4, 2, false), /filterHaps\(\(h\)=>!h\.whole\|\|h\.whole\.begin<2\)$/);
  // encendido: suena siempre (también en la cuenta)
  assert.doesNotMatch(metronomeCode(4, 2, true), /filterHaps/);
});

test('el clic va al lado de la música, no dentro', () => {
  assert.equal(withMetronome('s("bd*4")', { on: false, beats: 4, countIn: 0 }), 's("bd*4")');
  assert.equal(withMetronome('s("bd*4")', { on: true, beats: 4, countIn: 0 }), 'stack((s("bd*4")\n), s("telar_click*4").n("1 0 0 0"))');
});

test('cuenta previa: la música entra N ciclos después y lo de antes no suena', () => {
  const out = applyTimeline('s("bd*4")', { from: 0, region: null, regionOn: false, countIn: 1 });
  assert.equal(out, '(s("bd*4")\n).late(1).filterHaps((h)=>!h.whole||h.whole.begin>=1)');
  // sin cuenta el código queda igual que antes
  assert.equal(applyTimeline('s("bd*4")', { from: 0, region: null, regionOn: false, countIn: 0 }), 's("bd*4")');
  // con «tocar desde aquí» primero se adelanta y luego se corre
  assert.match(applyTimeline('x', { from: 8, region: null, regionOn: false, countIn: 2 }), /\.early\(8\)\n?\)?\n?\)\.late\(2\)/);
});

test('línea de tiempo: la cuenta va en negativo y luego el compás 1 (o el de arranque)', () => {
  const t = { from: 0, region: null, regionOn: false, countIn: 2 };
  assert.equal(timelinePos(0, t), -2);
  assert.equal(timelinePos(1.5, t), -0.5);
  assert.equal(timelinePos(2, t), 0);
  assert.equal(timelinePos(5.25, t), 3.25);
  // desde el compás 33 (from 32): la cuenta muestra 31 y 32, la música arranca en el 33
  assert.equal(timelinePos(1, { ...t, from: 32 }), 31);
  assert.equal(timelinePos(2, { ...t, from: 32 }), 32);
  // con la región en bucle: la cuenta antes de su inicio y después el bucle de siempre
  const r = { from: 0, region: { start: 16, bars: 4 }, regionOn: true, countIn: 1 };
  assert.equal(timelinePos(0.5, r), 15.5);
  assert.equal(timelinePos(1, r), 16);
  assert.equal(timelinePos(5.5, r), 16.5);
  assert.equal(fmtBarPos(-2, 4), '−2.1.1');
  assert.equal(fmtBarPos(-0.25, 4), '−1.4.1');
});
