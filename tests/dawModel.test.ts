import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDawModel, DAW_DEFAULT_BARS } from '../src/lib/dawModel.ts';

const SONG = [
  { scene: 1, bars: 8 },
  { scene: 2, bars: 8 },
  { scene: 3, bars: 16 },
];
const names: Record<number, string> = { 1: 'intro', 2: 'build', 3: 'drop' };
const sceneName = (n: number) => names[n] ?? `escena ${n}`;

test('DAW: secciones de la canción con el nombre de su escena y total de compases', () => {
  const m = buildDawModel([{ id: 'k', code: 's("bd*4")' }], SONG, sceneName);
  assert.equal(m.fromSong, true);
  assert.equal(m.total, 32);
  assert.deepEqual(m.sections.map((s) => [s.label, s.start, s.bars, s.scene]), [['intro', 0, 8, 1], ['build', 8, 8, 2], ['drop', 16, 16, 3]]);
});

test('DAW: pista alineada → un bloque por brazo, en su compás, con su estado (suena · apagada · vacía)', () => {
  const code = 'arrange([8, silence], [8, s("hh*8").mask(0)], [16, s("hh*16")])';
  const t = buildDawModel([{ id: 'h', name: 'hats', code }], SONG, sceneName).tracks[0];
  assert.equal(t.plain, false);
  assert.equal(t.mismatch, false);
  assert.deepEqual(t.blocks.map((b) => [b.arm, b.start, b.bars, b.state, b.ghost]), [
    [0, 0, 8, 'empty', false],
    [1, 8, 8, 'off', false],
    [2, 16, 16, 'on', false],
  ]);
});

test('DAW: pista sin arrange = un bloque continuo «suena siempre» a lo largo de toda la canción', () => {
  const t = buildDawModel([{ id: 'p', code: 'note("c2 eb2").s("sawtooth")' }], SONG, sceneName).tracks[0];
  assert.equal(t.plain, true);
  assert.deepEqual(t.blocks.map((b) => [b.start, b.bars, b.state]), [[0, 32, 'on']]);
});

test('DAW: un arrange más CORTO que la canción se repite (fantasmas) y se marca desfasado', () => {
  const t = buildDawModel([{ id: 'b', code: 'arrange([8, s("bd*4")], [4, silence])' }], SONG, sceneName).tracks[0];
  assert.equal(t.bars, 12);
  assert.equal(t.mismatch, true);
  // 0–8, 8–12 · 12–20, 20–24 (vuelta 2) · 24–32 (vuelta 3, recortada a la línea de tiempo)
  assert.deepEqual(t.blocks.map((b) => [b.start, b.bars, b.ghost]), [[0, 8, false], [8, 4, false], [12, 8, true], [20, 4, true], [24, 8, true]]);
});

test('DAW: un arrange más LARGO que la canción se recorta al total y se marca', () => {
  const t = buildDawModel([{ id: 'l', code: 'arrange([16, s("bd")], [32, s("sd")])' }], SONG, sceneName).tracks[0];
  assert.equal(t.mismatch, true);
  assert.deepEqual(t.blocks.map((b) => [b.start, b.bars]), [[0, 16], [16, 16]]);
});

test('DAW: sin canción, las secciones salen del PRIMER arrange («sección N»)', () => {
  const m = buildDawModel(
    [
      { id: 'p', code: 's("hh*8")' },
      { id: 'a', code: 'arrange([4, s("bd*4")], [12, s("bd*2")])' },
      { id: 'c', code: 'arrange([4, s("sd")], [4, silence])' },
    ],
    [],
  );
  assert.equal(m.fromSong, false);
  assert.equal(m.total, 16);
  assert.deepEqual(m.sections.map((s) => [s.label, s.start, s.bars, s.scene]), [['sección 1', 0, 4, null], ['sección 2', 4, 12, null]]);
  assert.equal(m.tracks[2].mismatch, true); // 8 compases frente a 16
});

test('DAW: sin canción ni arrange → 8 compases de bucles', () => {
  const m = buildDawModel([{ id: 'p', code: 's("bd*4")' }], []);
  assert.equal(m.total, DAW_DEFAULT_BARS);
  assert.equal(m.sections.length, 0);
  assert.deepEqual(m.tracks[0].blocks.map((b) => [b.start, b.bars]), [[0, DAW_DEFAULT_BARS]]);
});

test('DAW: mute y solo — qué pistas se oyen', () => {
  const m = buildDawModel(
    [
      { id: 'a', code: 's("bd")', solo: true },
      { id: 'b', code: 's("sd")' },
      { id: 'c', code: 's("hh")', mute: true, solo: true },
    ],
    SONG,
  );
  assert.deepEqual(m.tracks.map((t) => t.audible), [true, false, false]);
});

test('DAW: nombre de la pista (o su id) y brazo con flecha no rompen el modelo', () => {
  const t = buildDawModel([{ id: 'src_9', name: '  ', code: 'arrange([16, s("hh*8").sometimesBy(0.3, x=>x.ply(2))], [16, silence])' }], SONG).tracks[0];
  assert.equal(t.name, 'src_9');
  assert.deepEqual(t.blocks.map((b) => [b.start, b.bars, b.state]), [[0, 16, 'on'], [16, 16, 'empty']]);
});
