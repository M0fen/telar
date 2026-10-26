// Fase 4.1 · canción horneada: cada sección con la mezcla de SU escena, en un solo patrón.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeSong } from '../src/lib/songBake.ts';
import { compileGraph, applyGlobalMaster, type MasterFx } from '../src/graph/compile.ts';
import { strudelCore } from './helpers/strudelNode.ts';

const M: MasterFx = { gain: 1, filter: 0, room: 0, drive: 0, delay: 0, crush: 0, swing: 0, humanize: 0, limit: 0, glue: 0 };
const node = (id: string, code: string, extra: Record<string, unknown> = {}) => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', name: id, code, ...extra } });
const out = { id: 'out_1', type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } };
const graph = (srcs: ReturnType<typeof node>[]) => ({
  nodes: [...srcs, out] as never[],
  edges: srcs.map((s) => ({ id: `e_${s.id}`, source: s.id, target: 'out_1' })),
});
const scene = (slot: number, state: Record<string, Record<string, unknown>>, master?: Partial<MasterFx>) => ({ slot, name: `escena ${slot}`, state, master, savedAt: 0 });

async function evalPattern(code: string) {
  const core = await strudelCore();
  const mini = await import('@strudel/mini');
  (mini as { miniAllStrings?: () => void }).miniAllStrings?.();
  const scope: Record<string, unknown> = { ...core, ...mini };
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
  return new Function(...keys, `return (${code})`)(...keys.map((k) => scope[k]));
}
const onsets = (P: { queryArc: (a: number, b: number) => { hasOnset: () => boolean; value: Record<string, unknown>; whole: { begin: unknown } }[] }, a: number, b: number) =>
  P.queryArc(a, b).filter((h) => h.hasOnset());

test('4.1 sin canción: el mismo código que en vivo (sin recortes)', () => {
  const g = graph([node('kick', 's("bd*4")'), node('hats', 's("hh*8")')]);
  const r = bakeSong({ ...g, steps: [], scenes: {}, master: M });
  const live = compileGraph(g.nodes, g.edges, { songBars: 0, analyze: false });
  assert.equal(r.variants, 1);
  assert.equal(r.code, applyGlobalMaster(live.code!, M));
});

test('4.1 una escena silencia los hats en la 2.ª sección: no suenan ahí y el bombo sigue', async () => {
  const g = graph([node('kick', 's("bd*4")'), node('hats', 's("hh*8")')]);
  const scenes = { 1: scene(1, { kick: { mute: false, solo: false }, hats: { mute: false, solo: false } }), 2: scene(2, { kick: { mute: false, solo: false }, hats: { mute: true, solo: false } }) };
  const r = bakeSong({ ...g, steps: [{ scene: 1, bars: 4 }, { scene: 2, bars: 4 }], scenes, master: M });
  assert.equal(r.error, null);
  assert.equal(r.variants, 2);
  assert.deepEqual(r.sections.map((s) => [s.start, s.bars]), [[0, 4], [4, 4]]);
  const P = await evalPattern(r.code!);
  const by = (a: number, b: number, snd: string) => onsets(P, a, b).filter((h) => h.value.s === snd).length;
  assert.equal(by(0, 4, 'bd'), 16);
  assert.equal(by(4, 8, 'bd'), 16);
  assert.equal(by(0, 4, 'hh'), 32);
  assert.equal(by(4, 8, 'hh'), 0);
  // la canción se repite: la 2.ª vuelta igual que la 1.ª
  assert.equal(by(8, 12, 'hh'), 32);
  assert.equal(by(12, 16, 'hh'), 0);
});

test('4.1 lo que la escena no guarda sigue como venía; el máster de la escena va a su sección', async () => {
  const g = graph([node('kick', 's("bd*4")'), node('hats', 's("hh*8")')]);
  const scenes = {
    1: scene(1, { hats: { mute: true, solo: false } }),
    2: scene(2, { kick: { mute: false, solo: false } }, { crush: 0.5, filter: -0.5, glue: 0.3 }),
  };
  const r = bakeSong({ ...g, steps: [{ scene: 1, bars: 2 }, { scene: 2, bars: 2 }], scenes, master: M });
  const P = await evalPattern(r.code!);
  // los hats quedaron muteados por la escena 1 y la 2 no los toca → siguen muteados
  assert.equal(onsets(P, 0, 4).filter((h) => h.value.s === 'hh').length, 0);
  // crush (código) solo en la 2.ª sección; filtro y glue (bus) salen por sección
  assert.equal(onsets(P, 0, 2).every((h) => h.value.crush == null), true);
  assert.equal(onsets(P, 2, 4).every((h) => typeof h.value.crush === 'number'), true);
  assert.equal(r.sections[0].master.filter, 0);
  assert.equal(r.sections[1].master.filter, -0.5);
  assert.equal(r.sections[1].master.glue, 0.3);
});

test('4.1 EQ por canal solo en una sección: la pista conserva su bus en TODA la canción', () => {
  const g = graph([node('kick', 's("bd*4")'), node('hats', 's("hh*8")')]);
  const scenes = {
    1: scene(1, { hats: { mute: false, solo: false } }),
    2: scene(2, { hats: { mute: false, solo: false, eq: { on: true, low: -6, mid: 0, high: 3, midFreq: 1000 } } }),
  };
  const r = bakeSong({ ...g, steps: [{ scene: 1, bars: 4 }, { scene: 2, bars: 4 }], scenes, master: M });
  // el código de las dos secciones es el mismo (el EQ va en el bus): una sola mezcla, con su orbit
  assert.equal(r.variants, 1);
  assert.ok(r.code!.includes('.orbit(2)'));
  assert.deepEqual(r.sections[0].channelEqs.map((e) => [e.orbit, e.low, e.high]), [[2, 0, 0]]); // plano
  assert.deepEqual(r.sections[1].channelEqs.map((e) => [e.orbit, e.low, e.high]), [[2, -6, 3]]);
});

test('4.1 stem: solo la pista pedida, con lo que las escenas le hacen', async () => {
  const g = graph([node('kick', 's("bd*4")'), node('hats', 's("hh*8")')]);
  const scenes = { 1: scene(1, { hats: { mute: false, solo: false } }), 2: scene(2, { hats: { mute: true, solo: false } }) };
  const r = bakeSong({ ...g, steps: [{ scene: 1, bars: 2 }, { scene: 2, bars: 2 }], scenes, master: M, only: 'hats' });
  const P = await evalPattern(r.code!);
  assert.equal(onsets(P, 0, 4).filter((h) => h.value.s === 'bd').length, 0);
  assert.equal(onsets(P, 0, 2).filter((h) => h.value.s === 'hh').length, 16);
  assert.equal(onsets(P, 2, 4).filter((h) => h.value.s === 'hh').length, 0);
});
