// Orden del grafo (Fase 8.7): columnas fuentes → efectos → salida, cadenas en línea y nodos que no
// se montan al crecer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layeredLayout, pushApart, type LayoutNode } from '../src/lib/graphLayout.ts';

const N = (id: string, kind: string, x: number, y: number, h = 60, w = 180): LayoutNode => ({ id, kind, x, y, w, h });

test('ordenar: columnas por profundidad, la salida al final y las cadenas en línea', () => {
  const nodes = [N('bombo', 'source', 500, 300), N('bajo', 'source', 100, 100), N('sc', 'fx', 0, 0), N('out', 'out', 50, 500)];
  const edges = [{ source: 'bajo', target: 'sc' }, { source: 'sc', target: 'out' }, { source: 'bombo', target: 'out' }];
  const p = layeredLayout(nodes, edges);
  // fuentes en la columna 0, en el orden que tenían (bajo estaba más arriba)
  assert.equal(p.bajo.x, p.bombo.x);
  assert.ok(p.bajo.y < p.bombo.y);
  // el sidechain a la derecha de su fuente y a su altura
  assert.ok(p.sc.x > p.bajo.x);
  assert.equal(p.sc.y, p.bajo.y);
  // la salida a la derecha de todo
  assert.ok(p.out.x > p.sc.x);
  // nadie se pisa dentro de una columna
  assert.ok(p.bombo.y >= p.bajo.y + 60);
});

test('un nodo que crece empuja hacia abajo a los que tapa (en cascada)', () => {
  const nodes = [N('a', 'source', 0, 0, 300), N('b', 'source', 0, 80), N('c', 'source', 0, 160), N('lejos', 'fx', 600, 100)];
  const m = pushApart(nodes, ['a']);
  assert.equal(m.b.y, 314); // 0 + 300 + 14
  assert.equal(m.c.y, 314 + 60 + 14); // empujado por b
  assert.equal(m.lejos, undefined); // en otra columna: no se toca
  assert.equal(m.a, undefined); // el que creció se queda
});

test('un nodo nuevo encima de otro lo empuja; si no se tocan, nada se mueve', () => {
  const nodes = [N('viejo', 'source', 0, 100), N('nuevo', 'source', 20, 100)];
  const m = pushApart(nodes, ['nuevo']);
  assert.equal(Object.keys(m).length, 1);
  const free = pushApart([N('x', 'source', 0, 0), N('y', 'source', 0, 200)], ['x']);
  assert.deepEqual(free, {});
});
