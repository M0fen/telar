// Automatización de volumen y filtro por pista (Modo DAW, Fase 3.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { addPoint, movePoint, removePoint, valueAt, simplify, automationSuffix, isActive, type AutoPoint } from '../src/lib/automation.ts';
import { strudelCore } from './helpers/strudelNode.ts';

test('3.1 puntos: añadir (reemplaza en el mismo compás), mover, quitar, ordenados y acotados', () => {
  let p = addPoint(undefined, 'vol', 8, 0.5);
  p = addPoint(p, 'vol', 0, 1);
  p = addPoint(p, 'vol', 8, 2); // mismo compás → reemplaza; 2 > 1.5 → 1.5
  assert.deepEqual(p, [[0, 1], [8, 1.5]]);
  p = movePoint(p, 1, 'vol', 4, 0.25);
  assert.deepEqual(p, [[0, 1], [4, 0.25]]);
  assert.deepEqual(removePoint(p, 0), [[4, 0.25]]);
  assert.deepEqual(addPoint([], 'filt', 2, -3), [[2, -1]]);
});

test('3.1 valor: antes del primero = el primero, rampas lineales, después del último = el último', () => {
  const p: AutoPoint[] = [[4, 0], [8, 1]];
  assert.equal(valueAt(p, 0), 0);
  assert.equal(valueAt(p, 6), 0.5);
  assert.equal(valueAt(p, 20), 1);
});

test('3.1 sin curva (o solo neutra) → no se emite nada: el código queda idéntico', () => {
  assert.equal(automationSuffix(undefined, 32), '');
  assert.equal(automationSuffix({ vol: [[0, 1], [8, 1]] }, 32), '');
  assert.equal(automationSuffix({ filt: [] }, 32), '');
  assert.equal(isActive([[0, 0.5]], 'vol'), true);
});

test('3.1 semántica con Strudel real: volumen por compás, filtro compuesto con la voz, con .early y repitiendo', async () => {
  const core = await strudelCore();
  const sfx = automationSuffix({ vol: [[0, 1], [8, 0]], filt: [[0, 0], [16, -0.9]] }, 32);
  const apply = (p: unknown) => new Function('p', 'return p' + sfx)(p);
  const pat = apply((core as any).s('bd').cutoff(500).fast(4));
  const at = (P: any, c: number) => P.queryArc(c, c + 0.01).filter((h: any) => h.hasOnset())[0].value;
  assert.equal(at(pat, 0).velocity, 1);
  assert.equal(at(pat, 4).velocity, 0.5);
  assert.equal(at(pat, 8).velocity, 0);
  assert.equal(at(pat, 0).cutoff, 500); // filtro neutro: la voz manda
  assert.ok(Math.abs(at(pat, 16).cutoff - 18000 * Math.pow(100 / 18000, 0.9)) < 1e-6); // más oscuro que la voz → baja
  assert.equal(at(pat, 32 + 4).velocity, 0.5); // se repite con la canción (32 compases)
  assert.equal(at(apply((core as any).s('bd').fast(4)).early(4), 0).velocity, 0.5); // «tocar desde el 5»: lee el compás de la canción
});

test('3.1 simplificar (curvas grabadas): quita los puntos que caen en la recta', () => {
  const pts: AutoPoint[] = [[0, 0], [1, 0.25], [2, 0.5], [3, 0.75], [4, 1], [5, 1], [6, 0.2]];
  assert.deepEqual(simplify(pts, 0.01), [[0, 0], [4, 1], [5, 1], [6, 0.2]]);
});
