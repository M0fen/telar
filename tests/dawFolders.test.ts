import test from 'node:test';
import assert from 'node:assert/strict';
import { folderOf, groupRows, folderToggle, laneH, LANE_H, gainToDb, dbToGain, fmtDbShort, fmtPan } from '../src/lib/dawFolders.ts';

test('carpeta por lo que suena, o la elegida', () => {
  assert.equal(folderOf({ name: 'bombo', code: 's("bd*4")' }), 'drums');
  assert.equal(folderOf({ name: 'hats', code: 's("hh*8")' }), 'drums');
  assert.equal(folderOf({ name: 'rumble', code: 'note("a1")' }), 'bass');
  assert.equal(folderOf({ name: 'pad', code: 'note("a3 c4").s("sawtooth")' }), 'synth');
  assert.equal(folderOf({ name: 'pad', code: 'note("a3").s("sawtooth")', folder: 'fx' }), 'fx');
  assert.equal(folderOf({ name: 'pad', code: 'note("a3").s("sawtooth")', folder: 'nada' }), 'synth');
});

test('filas con carpetas: orden de aparición, plegadas sin sus pistas', () => {
  const ts = [{ id: 'k' }, { id: 'b' }, { id: 'h' }, { id: 'p' }];
  const f = (id: string) => (id === 'b' ? 'bass' : id === 'p' ? 'synth' : 'drums') as 'bass' | 'synth' | 'drums';
  const off = groupRows(ts, f, false, new Set());
  assert.deepEqual(off.map((r) => (r.kind === 'track' ? r.t.id : r.id)), ['k', 'b', 'h', 'p']);
  const on = groupRows(ts, f, true, new Set());
  assert.deepEqual(on.map((r) => (r.kind === 'track' ? r.t.id : `[${r.id}]`)), ['[drums]', 'k', 'h', '[bass]', 'b', '[synth]', 'p']);
  const closed = groupRows(ts, f, true, new Set(['drums']));
  assert.deepEqual(closed.map((r) => (r.kind === 'track' ? r.t.id : `[${r.id}]`)), ['[drums]', '[bass]', 'b', '[synth]', 'p']);
  const fr = closed[0];
  assert.ok(fr.kind === 'folder' && fr.ids.join() === 'k,h' && !fr.open);
});

test('mute de carpeta: todas → quitar; alguna sin → poner en todas', () => {
  assert.equal(folderToggle(['a', 'b'], (id) => id === 'a'), true);
  assert.equal(folderToggle(['a', 'b'], () => true), false);
  assert.equal(folderToggle([], () => true), true);
});

test('alto de fila acotado y volumen en dB', () => {
  assert.equal(laneH(undefined), LANE_H.compact);
  assert.equal(laneH(5), LANE_H.min);
  assert.equal(laneH(999), LANE_H.max);
  assert.ok(Math.abs(gainToDb(0.5) - -6.0206) < 1e-3);
  assert.equal(gainToDb(0), -60);
  assert.ok(Math.abs(dbToGain(gainToDb(0.28)) - 0.28) < 1e-9);
  assert.equal(dbToGain(-60), 0);
  assert.equal(fmtDbShort(-60), '−∞');
  assert.equal(fmtDbShort(0), '0.0');
  assert.equal(fmtDbShort(-6.02), '−6.0');
  assert.equal(fmtDbShort(3), '+3.0');
  assert.equal(fmtPan(0.5), 'C');
  assert.equal(fmtPan(0.2), 'I 60');
  assert.equal(fmtPan(0.85), 'D 70');
});
