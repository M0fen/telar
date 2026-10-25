// Grabar el jam en la canción (Modo DAW, Fase 2.5): de una toma (muestras cada ¼ de compás)
// a secciones de canción + un brazo por sección en cada pista plana.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFromTake, barState, type JamTake, type JamSample } from '../src/lib/jamRecorder.ts';
import { splitArrange } from '../src/nodes/stepseqCode.ts';

const tr = (kick: boolean, hats: boolean) => ({ kick: { audible: kick, gain: 1, filt: 0 }, hats: { audible: hats, gain: 1, filt: 0 } });
// toma sintética: compases 0–3 solo bombo (escena 1), 4–5 bombo+hats (escena 2), 6–7 bombo+hats con
// la escena 2 pero hats silenciados a mano en el final del compás 5 (cuenta desde el 6)
function makeTake(): JamTake {
  const samples: JamSample[] = [];
  for (let q = 0; q < 8 * 4; q++) {
    const t = q / 4;
    let s: JamSample;
    if (t < 4) s = { t, scene: 1, tracks: tr(true, false) };
    else if (t < 5.75) s = { t, scene: 2, tracks: tr(true, true) };
    else s = { t, scene: 2, tracks: tr(true, false) };
    samples.push(s);
  }
  return { samples, bars: 8 };
}
const CODES = { kick: 's("bd*4")', hats: 's("~ hh ~ hh").gain(0.4)', pad: 'arrange([4, note("c3")], [4, silence])', vacio: '' };
let k = 0;
const id = () => `j${k++}`;

test('2.5 el estado de cada compás es el del final de su primer tiempo (un disparo tardío cuenta)', () => {
  const take = makeTake();
  assert.equal(barState(take, 4)!.scene, 2);
  assert.equal(barState(take, 3)!.scene, 1);
  assert.equal(barState(take, 6)!.tracks.hats.audible, false);
});

test('2.5 compases iguales seguidos → una sección; la canción toma la escena de cada tramo', () => {
  const r = buildFromTake(makeTake(), CODES, { freeScene: 9, makeId: id })!;
  assert.deepEqual(r.steps.map((s) => [s.scene, s.bars]), [[1, 4], [2, 2], [2, 2]]);
});

test('2.5 cada pista plana suena donde sonaba y queda apagada (.mask(0), sin perder el patrón) donde no', () => {
  const r = buildFromTake(makeTake(), CODES, { freeScene: 9, makeId: id })!;
  const hats = splitArrange(r.codes.hats)!;
  assert.deepEqual(hats.map((a) => [a.bars, a.code]), [
    [4, 's("~ hh ~ hh").gain(0.4).mask(0)'],
    [2, 's("~ hh ~ hh").gain(0.4)'],
    [2, 's("~ hh ~ hh").gain(0.4).mask(0)'],
  ]);
  assert.equal(r.codes.kick, 'arrange([4, s("bd*4")], [2, s("bd*4")], [2, s("bd*4")])');
  assert.deepEqual(r.patches.hats, { mute: false, solo: false }); // la mezcla en vivo queda neutra
});

test('2.5 pistas con secciones propias no se tocan; vacías se ignoran; sin escena → ranura libre y «parte N»', () => {
  const r = buildFromTake(makeTake(), CODES, { freeScene: 9, makeId: id })!;
  assert.deepEqual(r.skipped, ['pad']);
  assert.equal(r.codes.pad, undefined);
  assert.equal(r.codes.vacio, undefined);
  const noScene: JamTake = { samples: [{ t: 0, scene: null, tracks: tr(true, true) }], bars: 3 };
  const r2 = buildFromTake(noScene, { kick: 's("bd")' }, { freeScene: 7, makeId: id })!;
  assert.deepEqual(r2.steps.map((s) => [s.scene, s.bars, s.name]), [[7, 3, 'parte 1']]);
});

test('2.5 una sección de más de 64 compases se parte; menos de un compás no arma nada', () => {
  const long: JamTake = { samples: [{ t: 0, scene: 1, tracks: tr(true, true) }], bars: 70 };
  const r = buildFromTake(long, { kick: 's("bd")' }, { freeScene: 9, makeId: id })!;
  assert.deepEqual(r.steps.map((s) => s.bars), [64, 6]);
  assert.equal(buildFromTake({ samples: [], bars: 0 }, { kick: 's("bd")' }, { freeScene: 1 }), null);
});
