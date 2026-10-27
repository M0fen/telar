// Editor de loops y samples (9.5): el código de un clip de audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClip, buildClip, isClipCode, fadeClip, snapFrac, moveCut, addCut, removeCut, tempoFromMarker } from '../src/lib/clipCode.ts';

test('un loop al tempo es un clip; una rejilla no', () => {
  assert.equal(isClipCode('s("wl_top_ab12").slow(4)'), true);
  assert.equal(isClipCode('s("vox")'), true);
  assert.equal(isClipCode('s("bd*4")'), false);
  assert.equal(isClipCode('s("bd sd")'), false);
  assert.equal(isClipCode('note("c3").s("sine")'), false);
  assert.equal(isClipCode('stack(s("bd"))'), false);
});

test('round-trip: tramo, al revés, fundidos y vuelta', () => {
  const p = parseClip('s("wl_top_ab12").slow(4)')!;
  assert.deepEqual([p.begin, p.end, p.rev, p.cycles], [0, 1, false, 4]);
  const st = { ...p, begin: 0.5, end: 1, cycles: 2, fadeIn: 0.01 };
  const out = buildClip(st);
  assert.equal(out, 's("wl_top_ab12").begin(0.5).attack(0.01).slow(2)');
  const back = parseClip(out)!;
  assert.deepEqual([back.begin, back.end, back.fadeIn, back.cycles], [0.5, 1, 0.01, 2]);
});

test('al revés: el tramo del original se escribe en espejo (superdough voltea antes de recortar)', () => {
  const p = parseClip('s("wl_x").slow(4)')!;
  const out = buildClip({ ...p, rev: true, begin: 0.25, end: 0.5 });
  assert.equal(out, 's("wl_x").begin(0.5).end(0.75).speed(-1).slow(4)');
  const back = parseClip(out)!;
  assert.deepEqual([back.begin, back.end, back.rev], [0.25, 0.5, true]);
});

test('fundido de salida: suelta antes del final para que el release termine con el tramo', () => {
  const p = parseClip('s("wl_x").slow(2)')!;
  const st = { ...p, fadeOut: 0.1 };
  // vuelta de 2 compases a 0,5 ciclos/s = 4 s; tramo entero = 4 s → clip = (4 − 0,1)/4
  assert.equal(fadeClip(st, { regionSec: 4, eventSec: 4 }), 0.975);
  assert.equal(buildClip(st, { regionSec: 4, eventSec: 4 }), 's("wl_x").release(0.1).clip(0.975).slow(2)');
  // un one-shot de 0,8 s en una vuelta de 2 s: suelta a los 0,7 s
  assert.equal(fadeClip({ ...st, cycles: 1 }, { regionSec: 0.8, eventSec: 2 }), 0.35);
  // lee el fundido aunque el clip cambie
  assert.equal(parseClip('s("wl_x").release(0.1).clip(0.9).slow(2)')!.fadeOut, 0.1);
});

test('tono por varispeed y lo demás se conserva', () => {
  const p = parseClip('s("vox").speed(1.5).room(0.3).slow(2)')!;
  assert.equal(p.semis, 7.02);
  assert.equal(p.fx, '.room(0.3)');
  const out = buildClip({ ...p, semis: 12 });
  assert.equal(out, 's("vox").speed(2).room(0.3).slow(2)');
});

test('rebanadas: el .slice del rebanador queda tal cual (y sin tramo)', () => {
  const src = 's("wl_top").slice([0, 0.25, 0.5, 1], "0@2500 1@2500 2@5000").slow(4)';
  const p = parseClip(src)!;
  assert.ok(p.slice);
  assert.equal(buildClip(p), src);
});

test('rejilla del tramo, cortes que se mueven y marcador de tempo', () => {
  assert.equal(snapFrac(0.49, 16), 0.5);
  assert.equal(snapFrac(0.49, 16, true), 0.49);
  assert.deepEqual(moveCut([0, 0.25, 0.5, 1], 1, 0.6), [0, 0.495, 0.5, 1]);
  assert.deepEqual(addCut([0, 0.5, 1], 0.75), [0, 0.5, 0.75, 1]);
  assert.deepEqual(removeCut([0, 0.5, 0.75, 1], 2), [0, 0.5, 1]);
  assert.deepEqual(removeCut([0, 0.5, 1], 0), [0, 0.5, 1]);
  // el compás 2 cae a los 3,6 s de un loop de 14,4 s → 133,33 bpm y 32 tiempos
  assert.deepEqual(tempoFromMarker(2, 3.6, 14.4), { bpm: 133.33, beats: 32 });
  assert.equal(tempoFromMarker(1, 0.01, 4), null);
});
