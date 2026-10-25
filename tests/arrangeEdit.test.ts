// Motor de edición de la estructura (Modo DAW, Fase 2.1): toda operación deja canción y
// pistas con las mismas secciones, en el mismo orden y con los mismos compases.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignAll, duplicateSection, insertEmptySection, deleteSection, resizeSection, moveSection,
  renameSection, setSectionScene, createStructure, setArmExpr, canFollow, reorderArms, type ArrangeState, type EditResult,
} from '../src/lib/arrangeEdit.ts';
import { splitArrange } from '../src/nodes/stepseqCode.ts';

let k = 0;
const id = () => `t${k++}`;
const STEPS = [
  { id: 'a', scene: 1, bars: 8, name: 'intro' },
  { id: 'b', scene: 2, bars: 8 },
  { id: 'c', scene: 3, bars: 16, name: 'drop' },
];
const KICK = 'arrange([8, s("bd*4")], [8, s("bd*4").mask(0)], [16, s("bd*4").sometimesBy(0.2, x=>x.ply(2))])';
const HATS = 's("~ hh ~ hh").gain(0.4)'; // plana
const PAD = 'arrange([8, note("c3").s("sawtooth")])'; // corta (1 brazo)
const state = (): ArrangeState => ({ steps: STEPS.map((s) => ({ ...s })), codes: { kick: KICK, hats: HATS, pad: PAD, vacio: '' } });

// todas las pistas alineadas: mismos compases que la canción, brazo a brazo
function assertAligned(r: EditResult) {
  const bars = r.steps.map((s) => s.bars);
  for (const [tid, code] of Object.entries(r.codes)) {
    if (!code.trim() || r.skipped.includes(tid)) continue;
    const arms = splitArrange(code);
    assert.ok(arms, `${tid} debería tener arrange`);
    assert.deepEqual(arms!.map((a) => a.bars), bars, `${tid} desalineada`);
  }
}

test('2.1 alinear: la plana se envuelve (suena igual), la corta se completa, la vacía no se toca', () => {
  const r = alignAll(state());
  assertAligned(r);
  assert.equal(r.codes.kick, KICK); // ya alineada: idéntica
  assert.equal(r.codes.hats, `arrange([8, ${HATS}], [8, ${HATS}], [16, ${HATS}])`);
  assert.equal(r.codes.pad, 'arrange([8, note("c3").s("sawtooth")], [8, silence], [16, silence])');
  assert.equal(r.codes.vacio, '');
  assert.deepEqual(r.skipped, []);
});

test('2.1 alinear: una pista con MÁS secciones que la canción no se toca y se informa', () => {
  const st = state();
  st.codes.largo = 'arrange([4, s("cp")], [4, s("cp")], [4, s("cp")], [4, s("cp")])';
  const r = alignAll(st);
  assert.deepEqual(r.skipped, ['largo']);
  assert.equal(r.codes.largo, st.codes.largo);
});

test('2.1 duplicar: la copia va justo después, en la canción y en cada pista', () => {
  const r = duplicateSection(state(), 1, id)!;
  assertAligned(r);
  assert.deepEqual(r.steps.map((s) => [s.scene, s.bars]), [[1, 8], [2, 8], [2, 8], [3, 16]]);
  assert.equal(splitArrange(r.codes.kick)![2].code, 's("bd*4").mask(0)'); // el apagado sigue apagado
  assert.notEqual(r.steps[2].id, r.steps[1].id);
});

test('2.1 sección vacía: en medio y al principio, todas las pistas en silencio ahí', () => {
  const r = insertEmptySection(state(), 0, 4, id)!;
  assertAligned(r);
  assert.deepEqual(r.steps.map((s) => s.bars), [8, 4, 8, 16]);
  assert.equal(splitArrange(r.codes.kick)![1].code, 'silence');
  const r0 = insertEmptySection(state(), -1, 2, id)!;
  assertAligned(r0);
  assert.deepEqual(r0.steps.map((s) => s.bars), [2, 8, 8, 16]);
  assert.equal(splitArrange(r0.codes.hats)![0].code, 'silence');
});

test('2.1 borrar: quita la sección en la canción y en cada pista; la única no se borra', () => {
  const r = deleteSection(state(), 1)!;
  assertAligned(r);
  assert.deepEqual(r.steps.map((s) => s.id), ['a', 'c']);
  assert.equal(r.codes.kick, 'arrange([8, s("bd*4")], [16, s("bd*4").sometimesBy(0.2, x=>x.ply(2))])');
  assert.equal(deleteSection({ steps: [STEPS[0]], codes: { k: 's("bd")' } }, 0), null);
});

test('2.1 compases: la sección y su brazo en cada pista cambian juntos (1–64)', () => {
  const r = resizeSection(state(), 2, 32)!;
  assertAligned(r);
  assert.equal(r.steps[2].bars, 32);
  assert.equal(resizeSection(state(), 0, 999)!.steps[0].bars, 64);
});

test('2.1 mover: ida y vuelta deja todo IDÉNTICO y respeta lo que va fuera del arrange', () => {
  const st = state();
  st.codes.fx = 'arrange([8, s("rim")], [8, s("rim*2")], [16, s("rim*4")]).room(0.3) // fin';
  const a = alignAll(st);
  const r = moveSection(a, 0, 2)!;
  assertAligned(r);
  assert.deepEqual(r.steps.map((s) => s.id), ['b', 'c', 'a']);
  assert.equal(r.codes.fx, 'arrange([8, s("rim*2")], [16, s("rim*4")], [8, s("rim")]).room(0.3) // fin');
  const back = moveSection(r, 2, 0)!;
  assert.deepEqual(back.steps, a.steps);
  assert.deepEqual(back.codes, a.codes);
});

test('2.1 nombre y escena: solo la canción', () => {
  const r = renameSection(state(), 1, '  subida  ')!;
  assert.equal(r.steps[1].name, 'subida');
  assert.equal(r.codes.kick, KICK);
  assert.equal(renameSection(state(), 0, '')!.steps[0].name, undefined);
  assert.equal(setSectionScene(state(), 0, 12)!.steps[0].scene, 9);
});

test('2.1 crear estructura sobre un jam de bucles: todo suena igual en cada sección', () => {
  const r = createStructure({ hats: HATS, bass: 'note("e1*4").s("sine")' }, [{ bars: 16, scene: 1, name: 'intro' }, { bars: 8, scene: 2 }], id)!;
  assertAligned(r);
  assert.equal(r.steps[0].name, 'intro');
  assert.equal(r.codes.bass, 'arrange([16, note("e1*4").s("sine")], [8, note("e1*4").s("sine")])');
});

test('2.1 utilidades: pegar en un brazo, ¿puede seguir la estructura?, reordenar brazos', () => {
  assert.equal(setArmExpr(KICK, 1, 's("hh*8")'), 'arrange([8, s("bd*4")], [8, s("hh*8")], [16, s("bd*4").sometimesBy(0.2, x=>x.ply(2))])');
  assert.equal(setArmExpr('s("bd")', 0, 's("hh")'), null);
  assert.equal(canFollow(HATS, STEPS), true);
  assert.equal(canFollow('arrange([1, a], [1, b], [1, c], [1, d])', STEPS), false);
  const arms = splitArrange(KICK)!;
  assert.equal(reorderArms(KICK, arms, 2, 0).startsWith('arrange([16, s("bd*4").sometimesBy'), true);
});
