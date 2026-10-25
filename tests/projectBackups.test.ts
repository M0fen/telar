// Copias automáticas del proyecto: se guarda el proyecto que se va a REEMPLAZAR (ejemplo,
// Nod-IA, abrir archivo, galería, enlace, tutorial, limpiar todo), sin repetir la última,
// rotando las más viejas y sin bloquear nunca la carga si el almacenamiento no da.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// localStorage mínimo en memoria, con tope de tamaño para simular «no cabe»
const mem = new Map<string, string>();
let capBytes = Infinity;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => {
    if (v.length > capBytes) throw new Error('QuotaExceededError');
    mem.set(k, String(v));
  },
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { backupProject, listBackups, pushBackup, worthBackup, summarizeSnap, compactSnap, BACKUPS_KEY, BACKUPS_MAX } = await import('../src/lib/projectBackups.ts');

type Snap = Parameters<typeof backupProject>[0];
const src = (id: string, code: string, name?: string) => ({ id, type: 'source', position: { x: 10.4, y: 20.6 }, data: { kind: 'source', code, ...(name ? { name } : {}) } });
const out = { id: 'out_1', type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } };
const song = (codes: string[], cps = 0.55): Snap =>
  ({ nodes: [...codes.map((c, i) => src(`s${i}`, c, `pista ${i}`)), out], edges: [], cps, beatsPerCycle: 4 }) as unknown as Snap;

beforeEach(() => {
  mem.clear();
  capBytes = Infinity;
});

test('no vale la pena copiar un lienzo vacío ni el lienzo en blanco de «limpiar todo»', () => {
  assert.equal(worthBackup({ nodes: [out] } as unknown as Snap), false);
  assert.equal(worthBackup({ nodes: [src('a', 's("bd*4")'), out] } as unknown as Snap), false);
  assert.equal(worthBackup({ nodes: [src('a', 's("bd*4")', 'kick'), out] } as unknown as Snap), true); // con nombre: es del usuario
  assert.equal(worthBackup(song(['note("e1").s("sine")'])), true);
});

test('resumen: pistas, bpm y nombres', () => {
  assert.equal(summarizeSnap(song(['s("bd")', 's("hh")', 's("cp")', 's("rim")'])), '4 pistas · 132 bpm · pista 0, pista 1, pista 2…');
  assert.equal(summarizeSnap(song(['s("bd")'])), '1 pista · 132 bpm · pista 0');
});

test('la copia guarda solo lo esencial de cada nodo (sin measured/selected) y posiciones redondas', () => {
  const s = song(['s("bd")']);
  (s.nodes as unknown as Record<string, unknown>[])[0].measured = { width: 300 };
  const c = compactSnap(s);
  const n0 = (c.nodes as unknown as Record<string, unknown>[])[0];
  assert.deepEqual(Object.keys(n0).sort(), ['data', 'id', 'position', 'type']);
  assert.deepEqual(n0.position, { x: 10, y: 21 });
});

test('copiar → aparece primero en la lista; la misma canción dos veces no se repite', () => {
  assert.equal(backupProject(song(['s("bd*2")']), 'ejemplo · techno'), true);
  assert.equal(backupProject(song(['s("bd*2")']), 'ejemplo · dembow'), false); // igual a la última
  assert.equal(backupProject(song(['s("bd*4").gain(0.8)']), 'Nod-IA'), true);
  const l = listBackups();
  assert.equal(l.length, 2);
  assert.equal(l[0].reason, 'Nod-IA');
  assert.equal(l[1].reason, 'ejemplo · techno');
  assert.ok(l[0].at >= l[1].at);
});

test(`rota: guarda como máximo ${BACKUPS_MAX} y suelta las más viejas`, () => {
  for (let i = 0; i < BACKUPS_MAX + 5; i++) backupProject(song([`s("bd*${i + 1}")`]), `carga ${i}`);
  const l = listBackups();
  assert.equal(l.length, BACKUPS_MAX);
  assert.equal(l[0].reason, `carga ${BACKUPS_MAX + 4}`);
  assert.equal(l[BACKUPS_MAX - 1].reason, 'carga 5');
});

test('si no cabe, suelta las más viejas hasta que quepa; si ni sola cabe, no guarda y no lanza', () => {
  for (let i = 0; i < 6; i++) backupProject(song([`s("bd*${i + 1}")`]), `carga ${i}`);
  const before = (mem.get(BACKUPS_KEY) ?? '').length;
  capBytes = Math.floor(before * 0.6); // ya no caben las 7
  assert.equal(backupProject(song(['note("e1 g1").s("sine")']), 'abrir archivo'), true);
  const l = listBackups();
  assert.ok(l.length < 7 && l.length >= 1);
  assert.equal(l[0].reason, 'abrir archivo');
  capBytes = 10; // nada cabe
  assert.doesNotThrow(() => backupProject(song(['s("cp*3")']), 'galería · x'));
  assert.equal(backupProject(song(['s("cp*4")']), 'galería · y'), false);
});

test('pushBackup puro: más nueva primero, sin duplicar la última, con tope', () => {
  const e = (r: string, code: string) => ({ id: r, at: 1, reason: r, summary: '', snap: song([code]) });
  let l = pushBackup([], e('a', 's("a")'), 2);
  l = pushBackup(l, e('b', 's("b")'), 2);
  assert.deepEqual(l.map((x) => x.reason), ['b', 'a']);
  assert.equal(pushBackup(l, e('c', 's("b")'), 2), l); // mismo contenido que la última
  l = pushBackup(l, e('d', 's("d")'), 2);
  assert.deepEqual(l.map((x) => x.reason), ['d', 'b']);
});

test('una lista corrupta en el almacenamiento se ignora (no rompe nada)', () => {
  mem.set(BACKUPS_KEY, '{nope');
  assert.deepEqual(listBackups(), []);
  mem.set(BACKUPS_KEY, JSON.stringify([{ id: 'x' }, null, { id: 'y', snap: { nodes: [] } }]));
  assert.equal(listBackups().length, 1);
});
