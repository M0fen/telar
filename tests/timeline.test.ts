import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readTimeline, writeTimeline, normalize, sliceClips, shiftExpr, remapClips, remapCurve, remapTransitions, curveAt,
  opInsert, opRemove, opDuplicate, opReorder, placeClip, moveClip, resizeClip, splitClip, joinClips, duplicateClip, clearClip, SILENCE,
} from '../src/lib/timeline.ts';
import { parseSeq } from '../src/nodes/stepseqCode.ts';

const K = 's("bd ~ ~ ~ bd ~ ~ ~").bank("RolandTR909")';
const show = (cs: { start: number; bars: number; expr: string }[]) => cs.map((c) => `${c.start}+${c.bars}:${c.expr === SILENCE ? '_' : c.expr === K ? 'K' : c.expr}`).join(' ');

test('leer y escribir: los brazos son clips; lo que rodea al arrange se conserva', () => {
  const code = `arrange([8, ${K}], [8, silence]).gain(0.9)`;
  const tl = readTimeline(code, 24);
  assert.equal(show(tl.clips), '0+8:K 8+8:_ 16+8:_');
  assert.equal(writeTimeline(tl, tl.clips), `arrange([8, ${K}], [8, silence], [8, silence]).gain(0.9)`);
  const plain = readTimeline(K, 16);
  assert.equal(show(plain.clips), '0+16:K');
  assert.equal(writeTimeline(plain, plain.clips), `arrange([16, ${K}])`);
});

test('un clip de 2 compases dentro de una sección de 16 suena donde está (10.1)', () => {
  const tl = readTimeline(`arrange([16, silence], [16, ${K}])`, 32);
  const placed = normalize(placeClip(tl.clips, 6, 2, 's("cp*4")'), [16]);
  assert.equal(show(placed), '0+6:_ 6+2:s("cp*4") 8+8:_ 16+16:K');
  const code = writeTimeline(tl, placed);
  assert.equal(code, `arrange([6, silence], [2, s("cp*4")], [8, silence], [16, ${K}])`);
});

test('partir rota la rejilla (sigue editable) y unir la devuelve', () => {
  const two = 's("bd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~").slow(2)';
  const r = shiftExpr(two, 1);
  const p = parseSeq(r)!;
  assert.ok(p && !p.complex, r);
  const sd = p.lanes.find((l) => l.sound === 'sd')!;
  const bd = p.lanes.find((l) => l.sound === 'bd')!;
  assert.ok(sd.steps[0] > 0 && bd.steps[8] > 0 && !(bd.steps[0] > 0), r);
  assert.equal(shiftExpr(two, 2), two);
  assert.equal(shiftExpr(K, 3), K); // 1 compás: partir en cualquier compás no cambia nada
  // un patrón que no es rejilla y dura 4 (.slow(4)): se adelanta con .early
  assert.equal(shiftExpr('note("a1 e1 c2 g1").slow(4)', 2), '(note("a1 e1 c2 g1").slow(4)).early(2)');
  const tl = readTimeline(`arrange([8, ${two}])`, 8);
  const sp = splitClip(tl.clips, 3);
  assert.equal(sp.length, 2);
  assert.equal(sp[1].start, 3);
  assert.notEqual(sp[1].expr, two);
  const jn = joinClips(sp, 0);
  assert.equal(jn.length, 1);
  assert.equal(jn[0].bars, 8);
  assert.equal(jn[0].expr, two);
});

test('una sección apagada se parte apagada', () => {
  const two = 's("bd ~ sd ~").slow(2).mask(0)';
  assert.match(shiftExpr(two, 1), /\.mask\(0\)$/);
});

test('mover, estirar, duplicar y vaciar clips', () => {
  const base = normalize([{ start: 0, bars: 4, expr: K }, { start: 4, bars: 12, expr: SILENCE }]);
  assert.equal(show(normalize(moveClip(base, 0, 8))), '0+8:_ 8+4:K 12+4:_');
  assert.equal(show(normalize(resizeClip(base, 0, 10))), '0+10:K 10+6:_');
  assert.equal(show(normalize(resizeClip(base, 0, 2))), '0+2:K 2+14:_');
  assert.equal(show(normalize(duplicateClip(base, 0))), '0+4:K 4+4:K 8+8:_');
  assert.equal(show(normalize(clearClip(base, 0))), '0+16:_');
});

test('tramos: insertar (vacío o continuando), borrar, duplicar y reordenar', () => {
  const cs = [{ start: 0, bars: 8, expr: 'A' }, { start: 8, bars: 8, expr: 'B' }];
  assert.equal(show(normalize(remapClips(cs, opInsert(8, 4)))), '0+8:A 8+4:_ 12+8:B');
  assert.equal(show(normalize(remapClips(cs, opInsert(8, 4, true)))), '0+12:A 12+8:B');
  assert.equal(show(normalize(remapClips(cs, opRemove(0, 8)))), '0+8:B');
  assert.equal(show(normalize(remapClips(cs, opDuplicate(0, 8)))), '0+8:A 8+8:A 16+8:B');
  assert.equal(show(normalize(remapClips(cs, opReorder([[8, 8], [0, 8]], 16)))), '0+8:B 8+8:A');
});

test('las curvas siguen a su tramo (10.3)', () => {
  const pts: [number, number][] = [[0, 0], [8, 1], [16, 0]];
  const moved = remapCurve(pts, opReorder([[8, 8], [0, 8]], 16));
  // la bajada (8→16) va primero y la subida (0→8) después
  assert.ok(Math.abs(curveAt(moved, 0) - 1) < 1e-6);
  assert.ok(Math.abs(curveAt(moved, 4) - 0.5) < 1e-3);
  assert.ok(Math.abs(curveAt(moved, 12) - 0.5) < 1e-3);
  const ins = remapCurve(pts, opInsert(8, 4));
  assert.ok(Math.abs(curveAt(ins, 10) - 1) < 1e-3); // el tramo nuevo mantiene el valor
  assert.ok(Math.abs(curveAt(ins, 16) - 0.5) < 1e-3);
  const del = remapCurve(pts, opRemove(0, 8));
  assert.ok(Math.abs(curveAt(del, 0) - 1) < 1e-6);
  assert.ok(Math.abs(curveAt(del, 8) - 0) < 1e-6);
});

test('las transiciones siguen a su sección (y se duplican con ella)', () => {
  const items = [{ kind: 'riser' as const, at: 16, bars: 4 }, { kind: 'impact' as const, at: 16, bars: 1 }, { kind: 'reverse' as const, at: 8, bars: 1 }];
  const moved = remapTransitions(items, opReorder([[16, 16], [0, 16]], 32));
  assert.deepEqual(moved.map((x) => `${x.kind}@${x.at}`).sort(), ['impact@0', 'reverse@24', 'riser@0']);
  const dup = remapTransitions(items, opDuplicate(16, 32));
  assert.equal(dup.filter((x) => x.kind === 'impact').map((x) => x.at).join(), '16,32');
  const ins = remapTransitions(items, opInsert(0, 8));
  assert.equal(ins.find((x) => x.kind === 'riser')!.at, 24);
});

test('silencios: uno por sección', () => {
  assert.equal(show(normalize([{ start: 0, bars: 24, expr: SILENCE }], [8, 16])), '0+8:_ 8+8:_ 16+8:_');
  assert.equal(show(normalize([{ start: 0, bars: 4, expr: SILENCE }, { start: 4, bars: 4, expr: SILENCE }], [8])), '0+8:_');
  assert.equal(show(sliceClips([{ start: 0, bars: 8, expr: 'A' }], 2, 6)), '0+4:A');
});
