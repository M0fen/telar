import test from 'node:test';
import assert from 'node:assert/strict';
import { compactSnapshot, projectExtras, type ProjectSnapshot } from '../src/lib/projectStore.ts';

const full = {
  nodes: [{ id: 'src_1', type: 'source', position: { x: 10.4, y: 20.6 }, selected: true, measured: { width: 1, height: 1 }, data: { kind: 'source', code: 's("bd*4")' } }],
  edges: [{ id: 'e1', source: 'src_1', target: 'out_1', selected: true }],
  cps: 0.6, beatsPerCycle: 4, transpose: -2,
  master: { gain: 1 }, mode: 'daw', djOrientation: 'vertical',
  vizMode: 1, vizHeight: 200, vizVisible: true, vizHeadless: false, vizMilkStyle: 'telar',
  title: 'mi tema', songKey: { root: 'F#', mode: 'minor' },
  song: { steps: [{ id: 's1', scene: 1, bars: 8, name: 'intro' }], loop: false, markers: [{ id: 'm1', bar: 8, name: 'drop' }] },
  scenes: {},
  foreign: 'un enlace compartido',
} as unknown as ProjectSnapshot;

test('exportar/compartir = autoguardado: título, tonalidad y marcadores viajan', () => {
  const out = JSON.parse(JSON.stringify(compactSnapshot(full))) as Partial<ProjectSnapshot>;
  assert.equal(out.title, 'mi tema');
  assert.deepEqual(out.songKey, { root: 'F#', mode: 'minor' });
  assert.equal(out.transpose, -2);
  assert.equal(out.mode, 'daw');
  const x = projectExtras(out);
  assert.deepEqual(x.song.markers, [{ id: 'm1', bar: 8, name: 'drop' }]);
  assert.equal(x.song.steps.length, 1);
  assert.equal(x.song.loop, false);
  // compacto: sin estado de React Flow, posiciones redondeadas, sin escenas vacías ni marca de ajeno
  assert.deepEqual(out.nodes![0], { id: 'src_1', type: 'source', position: { x: 10, y: 21 }, data: { kind: 'source', code: 's("bd*4")' } });
  assert.deepEqual(out.edges![0], { id: 'e1', source: 'src_1', target: 'out_1' });
  assert.equal('scenes' in out, false);
  assert.equal('foreign' in out, false);
});

test('la galería conserva la marca de ajeno', () => {
  assert.equal(compactSnapshot(full, { keepForeign: true }).foreign, 'un enlace compartido');
});
