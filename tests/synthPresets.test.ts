import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNTH_PRESETS, PRESET_GENRES, presetByName, macroPatch } from '../src/graph/synthPresets.ts';
import { DEFAULT_SYNTH } from '../src/graph/types.ts';

test('every preset declares a known genre', () => {
  const genres = new Set(PRESET_GENRES as readonly string[]);
  for (const p of SYNTH_PRESETS) assert.equal(genres.has(p.genre), true, `${p.name} → ${p.genre}`);
});

test('preset names are unique', () => {
  const names = SYNTH_PRESETS.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('macroPatch at v=0 returns the preset base values (no morph yet)', () => {
  const acid = presetByName('acid 303')!;
  const p = macroPatch(acid, 0);
  assert.equal(p.macro, 0);
  assert.equal(p.macroPreset, 'acid 303');
  // base = preset.params.cutoff (500), no el objetivo (1400)
  assert.equal(p.cutoff, acid.params.cutoff);
});

test('macroPatch at v=1 reaches the macro targets', () => {
  const acid = presetByName('acid 303')!;
  const p = macroPatch(acid, 1);
  assert.equal(p.cutoff, acid.macro!.targets.cutoff);
  assert.equal(p.lpq, acid.macro!.targets.lpq);
  assert.equal(p.drive, acid.macro!.targets.drive);
});

test('macroPatch at v=0.5 interpolates linearly between base and target', () => {
  const acid = presetByName('acid 303')!;
  const p = macroPatch(acid, 0.5);
  const base = acid.params.cutoff!; // 500
  const target = acid.macro!.targets.cutoff!; // 1400
  assert.equal(p.cutoff, base + (target - base) * 0.5); // 950
});

test('macroPatch only touches macro-target keys (preserves other params)', () => {
  const acid = presetByName('acid 303')!;
  const p = macroPatch(acid, 1);
  // release no está en los targets → no debe aparecer en el patch
  assert.equal('release' in p, false);
});

test('macroPatch uses DEFAULT_SYNTH as base when the preset omits a target key', () => {
  // reese base no fija cutoff-alto pero SÍ fija los del macro; probamos una clave que
  // el preset no declara para asegurar el fallback al DEFAULT.
  const fake = { name: 'x', genre: 'techno / EBM', params: {}, macro: { label: 'm', targets: { room: 0.8 } } };
  const p = macroPatch(fake, 1);
  assert.equal(p.room, 0.8);
  const half = macroPatch(fake, 0.5);
  assert.equal(half.room, (DEFAULT_SYNTH.room! + 0.8) / 2); // (0 + 0.8)/2 = 0.4
});

test('macroPatch clamps v to 0..1', () => {
  const acid = presetByName('acid 303')!;
  assert.equal(macroPatch(acid, 2).cutoff, acid.macro!.targets.cutoff);
  assert.equal(macroPatch(acid, -1).cutoff, acid.params.cutoff);
});

test('a preset without a macro still returns macro/macroPreset markers', () => {
  const sub = presetByName('sub')!;
  assert.equal(sub.macro, undefined);
  const p = macroPatch(sub, 0.5);
  assert.equal(p.macro, 0.5);
  assert.equal(p.macroPreset, 'sub');
});
