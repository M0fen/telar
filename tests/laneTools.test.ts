// Herramientas de patrón de la rejilla (9.2): llenar cada N, rotar, euclidiano, invertir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euclid, euclidLane, fillEvery, invertLane, rotateLane, clearLane } from '../src/lib/laneTools.ts';
import type { Lane } from '../src/nodes/stepseqCode.ts';

const lane = (on: number[], n = 16): Lane => ({
  sound: 'hh',
  steps: Array.from({ length: n }, (_, i) => (on.includes(i) ? 1 : 0)),
  notes: Array(n).fill(null),
  ratchet: Array(n).fill(1),
  prob: Array(n).fill(1),
});
const hits = (l: Lane) => l.steps.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);

test('llenar cada N (con desplazamiento) borra lo demás', () => {
  assert.deepEqual(hits(fillEvery(lane([1, 5]), 16, 4)), [0, 4, 8, 12]);
  assert.deepEqual(hits(fillEvery(lane([]), 16, 4, 2)), [2, 6, 10, 14]); // los «off-beat» del hat
  assert.deepEqual(hits(fillEvery(lane([]), 8, 3)), [0, 3, 6]);
});

test('rotar corre todo y lo que sale entra por el otro lado', () => {
  const l = { ...lane([0, 15]), ratchet: [3, ...Array(15).fill(1)] };
  const r = rotateLane(l, 16, 1);
  assert.deepEqual(hits(r), [0, 1]);
  assert.equal(r.ratchet[1], 3); // el roll viaja con su golpe
  assert.deepEqual(hits(rotateLane(lane([0]), 16, -1)), [15]);
});

test('euclidiano: k golpes repartidos parejo, empezando en golpe', () => {
  assert.deepEqual(euclid(3, 8).map((x) => (x ? 'x' : '.')).join(''), 'x..x..x.'); // el tresillo del dembow/tumbao
  assert.equal(euclid(5, 16).filter(Boolean).length, 5);
  assert.equal(euclid(5, 16)[0], true);
  assert.deepEqual(hits(euclidLane(lane([]), 16, 4)), [0, 4, 8, 12]);
  assert.deepEqual(hits(euclidLane(lane([]), 8, 3, 1)), [1, 4, 7]);
});

test('invertir y borrar', () => {
  assert.deepEqual(hits(invertLane(lane([0, 1, 2, 3, 4, 5, 6, 7]), 8)), []);
  assert.deepEqual(hits(invertLane(lane([0, 2, 4, 6], 8), 8)), [1, 3, 5, 7]);
  assert.deepEqual(hits(clearLane(lane([1, 2]), 16)), []);
});
