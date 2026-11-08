import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeEdges, wouldCycle, reachesOut } from '../src/lib/graphEdges';

const N = (id: string, kind: string) => ({ id, data: { kind } });
const E = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

test('quitar un FX del medio reconecta su entrada con su salida', () => {
  const nodes = [N('s', 'source'), N('f', 'fx'), N('o', 'out')];
  const edges = [E('s', 'f'), E('f', 'o')];
  const out = bridgeEdges(nodes, edges, new Set(['f'])).filter((e) => e.source !== 'f' && e.target !== 'f');
  assert.deepEqual(out.map((e) => `${e.source}>${e.target}`), ['s>o']);
});

test('quitar un Source no inventa cables', () => {
  const nodes = [N('s', 'source'), N('o', 'out')];
  const out = bridgeEdges(nodes, [E('s', 'o')], new Set(['s']));
  assert.equal(out.length, 1);
});

test('no duplica un cable que ya existe', () => {
  const nodes = [N('s', 'source'), N('f', 'fx'), N('o', 'out')];
  const out = bridgeEdges(nodes, [E('s', 'f'), E('f', 'o'), E('s', 'o')], new Set(['f']));
  assert.equal(out.filter((e) => e.source === 's' && e.target === 'o').length, 1);
});

test('dos FX seguidos borrados juntos: la cadena se cierra igual', () => {
  const nodes = [N('s', 'source'), N('a', 'fx'), N('b', 'transform'), N('o', 'out')];
  const edges = [E('s', 'a'), E('a', 'b'), E('b', 'o')];
  // se borran de a uno (como hace la tecla con cada cambio): primero a, luego b
  const one = bridgeEdges(nodes, edges, new Set(['a'])).filter((e) => e.source !== 'a' && e.target !== 'a');
  const two = bridgeEdges(nodes, one, new Set(['b'])).filter((e) => e.source !== 'b' && e.target !== 'b');
  assert.deepEqual(two.map((e) => `${e.source}>${e.target}`), ['s>o']);
});

test('ciclos: rechaza el lazo y el cierre, acepta lo nuevo', () => {
  const edges = [E('a', 'b'), E('b', 'c')];
  assert.equal(wouldCycle(edges, 'a', 'a'), true);
  assert.equal(wouldCycle(edges, 'c', 'a'), true);
  assert.equal(wouldCycle(edges, 'a', 'c'), false);
  assert.equal(wouldCycle(edges, 'd', 'a'), false);
});

test('reachesOut: solo cuenta un camino completo de un Source al Out', () => {
  const nodes = [N('s', 'source'), N('f', 'fx'), N('o', 'out')];
  assert.equal(reachesOut(nodes, [E('s', 'f'), E('f', 'o')]), true);
  assert.equal(reachesOut(nodes, [E('s', 'f')]), false);
  assert.equal(reachesOut(nodes, [E('f', 'o')]), false);
});
