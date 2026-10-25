import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDawModel, playheadAt, DAW_DEFAULT_BARS } from '../src/lib/dawModel.ts';

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

test('DAW 1.2: la línea de reproducción es el ciclo del scheduler dentro de la canción (cíclica) y marca su sección', () => {
  const { sections, total } = buildDawModel([{ id: 'k', code: 's("bd")' }], SONG, sceneName); // 8 · 8 · 16
  assert.deepEqual(playheadAt(0, total, sections), { pos: 0, section: 0 });
  assert.deepEqual(playheadAt(7.99, total, sections).section, 0);
  assert.deepEqual(playheadAt(8, total, sections).section, 1);     // el 1 de la sección 2
  assert.deepEqual(playheadAt(20, total, sections), { pos: 20, section: 2 });
  assert.deepEqual(playheadAt(33.5, total, sections), { pos: 1.5, section: 0 }); // segunda vuelta
  assert.deepEqual(playheadAt(5, 8, []), { pos: 5, section: -1 });  // sin secciones
  assert.deepEqual(playheadAt(Number.NaN, total, sections).pos, 0); // reloj sin arrancar
});

// --- Fase 1.3: encender / apagar bloques --------------------------------------------------
import { toggleBlockCode, seedArm } from '../src/lib/dawModel.ts';
import { splitArrange } from '../src/nodes/stepseqCode.ts';

test('DAW 1.3: apagar y volver a encender un bloque deja el código IDÉNTICO (ida y vuelta)', () => {
  const code = 'arrange([8, s("bd*4").bank("RolandTR909")], [8, note("c2 eb2").s("sawtooth").sometimesBy(0.3, x=>x.ply(2))], [16, s("bd*4")])';
  const off = toggleBlockCode(code, 1);
  assert.ok(off && off !== code);
  const m = buildDawModel([{ id: 'b', code: off! }], SONG, sceneName).tracks[0];
  assert.deepEqual(m.blocks.map((b) => b.state), ['on', 'off', 'on']); // solo ese brazo
  assert.equal(toggleBlockCode(off!, 1), code);
  // el primero y el último también, sin tocar a los demás
  const off0 = toggleBlockCode(code, 0)!;
  assert.deepEqual(buildDawModel([{ id: 'b', code: off0 }], SONG, sceneName).tracks[0].blocks.map((b) => b.state), ['off', 'on', 'on']);
  assert.equal(toggleBlockCode(off0, 0), code);
});

test('DAW 1.3: un bloque VACÍO entra con el patrón de la primera sección que suena', () => {
  const code = 'arrange([8, silence], [8, s("hh*8").mask(0)], [16, s("hh*16").gain(0.7)])';
  assert.equal(seedArm(splitArrange(code)!), 2);
  const next = toggleBlockCode(code, 0)!;
  assert.equal(next, 'arrange([8, s("hh*16").gain(0.7)], [8, s("hh*8").mask(0)], [16, s("hh*16").gain(0.7)])');
  assert.equal(buildDawModel([{ id: 'h', code }], SONG, sceneName).tracks[0].seed, 2);
});

test('DAW 1.3: si nada suena, el vacío se siembra con la primera APAGADA (sin su .mask(0)); sin patrón → no se puede', () => {
  const code = 'arrange([8, s("hh*8").mask(0)], [8, silence], [16, silence])';
  assert.equal(toggleBlockCode(code, 1), 'arrange([8, s("hh*8").mask(0)], [8, s("hh*8")], [16, silence])');
  assert.equal(toggleBlockCode('arrange([8, silence], [24, silence])', 0), null);
  assert.equal(buildDawModel([{ id: 'x', code: 'arrange([8, silence], [24, silence])' }], SONG, sceneName).tracks[0].seed, -1);
});

test('DAW 1.3: pista plana o brazo inexistente → no hace nada', () => {
  assert.equal(toggleBlockCode('s("bd*4")', 0), null);
  assert.equal(toggleBlockCode('arrange([8, s("bd*4")], [8, silence])', 2), null);
  assert.equal(toggleBlockCode('arrange([8, s("bd*4")], [8, silence])', -1), null);
  assert.equal(buildDawModel([{ id: 'p', code: 's("bd*4")' }], SONG, sceneName).tracks[0].seed, -1);
});

