import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSends, sendsActive, returnsFromMaster, delaySeconds, dbToGain, DEFAULT_RETURNS, DELAY_NOTES } from '../src/lib/returns.ts';
import { compileGraph, eqSourceIds, sanitizeMasterFx } from '../src/graph/compile.ts';
import { bakeSong } from '../src/lib/songBake.ts';
import { genIrChannel, genIrStereo, IR_SPACES } from '../src/lib/irGen.ts';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const out = { id: 'out_1', type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } };
const src = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', code: 's("bd*4")', ...extra } });

test('envíos: limpios y activos', () => {
  assert.deepEqual(cleanSends(undefined), { rev: 0, del: 0 });
  assert.deepEqual(cleanSends({ rev: 2, del: -1 }), { rev: 1, del: 0 });
  assert.deepEqual(cleanSends({ rev: NaN as unknown as number }), { rev: 0, del: 0 });
  assert.equal(sendsActive({ rev: 0.004 }), false);
  assert.equal(sendsActive({ del: 0.3 }), true);
});

test('retornos desde el máster: por defecto, acotados y a una división real', () => {
  assert.deepEqual(returnsFromMaster(undefined), DEFAULT_RETURNS);
  const r = returnsFromMaster({ rvLevel: 99, rvLow: 5, dlFb: 2, dlNote: 0.7, rvSpace: 'ir_plate' });
  assert.equal(r.rvLevel, 6);
  assert.equal(r.rvLow, 20);
  assert.equal(r.dlFb, 0.9);
  assert.equal(r.dlNote, 0.75); // la división más cercana
  assert.equal(r.rvSpace, 'ir_plate');
  assert.equal(returnsFromMaster({ rvSpace: 'javascript:alert(1)' }).rvSpace, DEFAULT_RETURNS.rvSpace);
  assert.equal(returnsFromMaster({ rvPre: null }).rvPre, DEFAULT_RETURNS.rvPre);
  assert.ok(DELAY_NOTES.some((n) => n.beats === DEFAULT_RETURNS.dlNote));
});

test('eco a tempo: pulsos × duración del pulso', () => {
  const beat = 60 / 132; // 132 BPM
  near(delaySeconds(0.75, beat), 0.75 * beat); // corchea con puntillo ≈ 0,341 s
  near(delaySeconds(1, 0.5), 0.5);
  near(delaySeconds(1, NaN), 0.5); // sin tempo: 120
  assert.equal(delaySeconds(2, 10), 4); // tope del retardo
  assert.equal(dbToGain(-80), 0);
  near(dbToGain(-6), 0.501187, 1e-5);
});

test('una pista que manda va a su propio bus con sus envíos en la ruta', () => {
  const nodes = [src('hat', { sends: { rev: 0.4 } }), src('kick'), out] as never[];
  const edges = [{ id: 'a', source: 'hat', target: 'out_1' }, { id: 'b', source: 'kick', target: 'out_1' }];
  const r = compileGraph(nodes, edges);
  assert.deepEqual(eqSourceIds(nodes), ['hat']);
  assert.equal(r.channelEqs.length, 1);
  assert.deepEqual(r.channelEqs[0].sends, { rev: 0.4, del: 0 });
  assert.equal(r.channelEqs[0].comp, null);
  assert.equal(r.channelEqs[0].low, 0); // EQ plano
  assert.ok(r.code!.includes(`.orbit(${r.channelEqs[0].orbit})`));
  // sin envíos (o en 0) → sin bus propio
  const none = compileGraph([src('hat', { sends: { rev: 0, del: 0 } }), out] as never[], [edges[0]]);
  assert.equal(none.channelEqs.length, 0);
});

test('canción: el envío de una escena entra en su sección y en las demás queda en 0, mismo bus', () => {
  const nodes = [src('hat'), out] as never[];
  const edges = [{ id: 'a', source: 'hat', target: 'out_1' }];
  const scenes = { 2: { slot: 2, name: 'break', state: { hat: { sends: { rev: 0.8, del: 0.3 } } }, savedAt: 0 }, 1: { slot: 1, name: 'drop', state: { hat: { sends: { rev: 0, del: 0 } } }, savedAt: 0 } };
  const M = { gain: 1, filter: 0, room: 0, drive: 0, delay: 0, crush: 0, swing: 0, humanize: 0, limit: 0, glue: 0, rvLevel: -3 };
  const b = bakeSong({ nodes, edges, steps: [{ scene: 1, bars: 4 }, { scene: 2, bars: 4 }], scenes: scenes as never, master: M });
  const s0 = b.sections[0].channelEqs[0];
  const s1 = b.sections[1].channelEqs[0];
  assert.equal(s0.orbit, s1.orbit);
  assert.deepEqual(s0.sends, { rev: 0, del: 0 });
  assert.deepEqual(s1.sends, { rev: 0.8, del: 0.3 });
  assert.equal(returnsFromMaster(b.sections[1].master).rvLevel, -3); // el máster de la sección lleva los retornos
});

test('un proyecto importado con retornos fuera de rango vuelve a neutro con aviso', () => {
  const { master, notes } = sanitizeMasterFx({ gain: 1, filter: 0, room: 0, rvLevel: 40, dlFb: 3 } as never);
  assert.equal(master.rvLevel, 0);
  assert.equal(master.dlFb, DEFAULT_RETURNS.dlFb);
  assert.equal(notes.length, 2);
});

test('IR sintético: la cola cae igual a 44,1 y a 48 kHz; estéreo decorrelacionado', () => {
  const hall = IR_SPACES.find((s) => s.name === 'ir_hall')!;
  const a = genIrChannel(hall, 1000, 44100);
  const b = genIrChannel(hall, 1000, 48000);
  assert.equal(a.length, Math.floor(hall.duration * 44100));
  assert.equal(b.length, Math.floor(hall.duration * 48000));
  // energía en la última décima: −50 dB o menos respecto de la primera (cola que cae)
  const e = (x: Float32Array, f0: number, f1: number) => { let s = 0; for (let i = Math.floor(x.length * f0); i < x.length * f1; i++) s += x[i] * x[i]; return s; };
  for (const x of [a, b]) assert.ok(10 * Math.log10(e(x, 0.9, 1) / e(x, 0, 0.1)) < -40);
  const lr = genIrStereo('ir_plate', 48000)!;
  assert.notDeepEqual(lr[0].slice(0, 2000), lr[1].slice(0, 2000)); // estéreo decorrelacionado
  assert.equal(genIrStereo('ir_nope'), null);
});
