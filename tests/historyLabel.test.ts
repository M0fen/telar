import test from 'node:test';
import assert from 'node:assert/strict';
import { describeChange } from '../src/lib/historyLabel.ts';

const n = (id: string, data: Record<string, unknown>) => ({ id, data: { kind: 'source', ...data } });
const S = (nodes: ReturnType<typeof n>[], song?: unknown) => ({ nodes, edges: [], song });

test('historial: qué cambió en cada paso', () => {
  assert.equal(describeChange(S([n('a', { name: 'bombo', mute: false })]), S([n('a', { name: 'bombo', mute: true })])), 'bombo: mute');
  assert.equal(describeChange(S([n('a', { name: 'bombo' })]), S([n('a', { name: 'bombo' }), n('b', { name: 'hats' })])), 'nueva: hats');
  assert.equal(describeChange(S([n('a', { name: 'bombo' }), n('b', { name: 'hats' })]), S([n('a', { name: 'bombo' })])), 'quitó: hats');
  assert.equal(describeChange(S([n('a', { code: 'x' }), n('b', { code: 'y' })], { s: 1 }), S([n('a', { code: 'x2' }), n('b', { code: 'y2' })], { s: 2 })), 'estructura de la canción (2 pistas)');
  assert.equal(describeChange(S([n('a', { gain: 1 }), n('b', { gain: 1 })]), S([n('a', { gain: 0.5 }), n('b', { gain: 0.5 })])), 'volumen de 2 pistas');
  assert.equal(describeChange(S([n('a', { name: 'x', eq: { low: 0 } })]), S([n('a', { name: 'x', eq: { low: 3 } })])), 'x: EQ');
});
