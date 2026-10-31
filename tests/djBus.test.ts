import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGraph, busFaderOf, xfaderGain } from '../src/graph/compile.ts';
import { eqFrom01, eqTo01, KILL_DB } from '../src/lib/djEq.ts';

// MODO DJ (busMix): volumen, crossfader, filtro, mute y solo van a la tira del bus de cada deck
type Any = Record<string, unknown>;
const out = (id = 'o'): Any => ({ id, type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } });
const src = (id: string, code: string, extra: Any = {}): Any => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', code, ...extra } });
const fx = (id: string, opId: string, params: Any = {}): Any => ({ id, type: 'fx', position: { x: 0, y: 0 }, data: { kind: 'fx', opId, params } });
const E = (s: string, t: string): Any => ({ id: `e_${s}_${t}`, source: s, target: t });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C = (nodes: Any[], edges: Any[], opts?: Any) => compileGraph(nodes as any, edges as any, opts as any);

test('busMix: cada deck a su bus; el código no lleva volumen ni filtro; la ruta sí', () => {
  const r = C([src('a', 's("bd*4")', { gain: 0.5, chFilter: -0.4 }), src('b', 's("hh*8")', { xfa: 'b', gain: 1.2 }), out()], [E('a', 'o'), E('b', 'o')], { busMix: true, xfader: 0.25 });
  assert.equal(r.error, null);
  assert.doesNotMatch(r.code!, /velocity/);
  assert.doesNotMatch(r.code!, /cutoff|lpf\(/);
  const ra = r.channelEqs.find((x) => x.source === 'a')!;
  const rb = r.channelEqs.find((x) => x.source === 'b')!;
  assert.ok(ra && rb, 'los dos decks tienen tira');
  assert.notEqual(ra.orbit, rb.orbit);
  assert.match(r.code!, new RegExp(`\\.orbit\\(${ra.orbit}\\)`));
  assert.equal(ra.fader, 0.5);
  assert.equal(ra.filter, -0.4);
  assert.ok(Math.abs(rb.fader! - 1.2 * Math.sin(0.25 * Math.PI / 2)) < 1e-9);
});

test('busMix: un deck en mute sigue sonando en el código (fader 0) para entrar justo en el 1', () => {
  const r = C([src('a', 's("bd*4")', { mute: true }), src('b', 's("hh*8")'), out()], [E('a', 'o'), E('b', 'o')], { busMix: true });
  assert.match(r.code!, /bd\*4/);
  assert.equal(r.channelEqs.find((x) => x.source === 'a')!.fader, 0);
  // sin busMix, el mute calla el código como siempre
  const n = C([src('a', 's("bd*4")', { mute: true }), src('b', 's("hh*8")'), out()], [E('a', 'o'), E('b', 'o')]);
  assert.doesNotMatch(n.code!, /bd\*4/);
});

test('busMix: el sidechain duck baja las tiras de su rama y se apaga con el bombo en mute', () => {
  const nodes = (kickMute: boolean) => [
    src('kick', 's("bd*4")', { mute: kickMute }),
    src('bass', 'note("a1*8").s("square")'),
    fx('sc', 'sidechain', { mode: 'duck', trigger: 'kick', depth: 0.7, attack: 0.1 }),
    out(),
  ];
  const edges = [E('kick', 'o'), E('bass', 'sc'), E('sc', 'o')];
  const r = C(nodes(false), edges, { busMix: true });
  const bassOrbit = r.channelEqs.find((x) => x.source === 'bass')!.orbit;
  assert.match(r.code!, new RegExp(`\\.duck\\(${bassOrbit}\\)`));
  // la rama del bajo no se re-enruta a un orbit del sidechain (sería pisar su tira)
  assert.equal((r.code!.match(/\.orbit\(/g) ?? []).length, 2);
  const m = C(nodes(true), edges, { busMix: true });
  assert.doesNotMatch(m.code!, /\.duck\(/);
});

test('busMix no aplica con plan de orbits (render offline): ahí manda el código', () => {
  const plan = { sidechain: new Map(), eq: new Map([['a', 4]]) };
  const r = C([src('a', 's("bd*4")', { gain: 0.5 }), out()], [E('a', 'o')], { busMix: true, orbitPlan: plan });
  assert.match(r.code!, /velocity/);
});

test('fader de bus: mute, solo y crossfader', () => {
  assert.equal(busFaderOf({ gain: 0.8 }, 0.5, false), 0.8);
  assert.equal(busFaderOf({ gain: 0.8, mute: true }, 0.5, false), 0);
  assert.equal(busFaderOf({ gain: 0.8 }, 0.5, true), 0);
  assert.equal(busFaderOf({ gain: 0.8, solo: true }, 0.5, true), 0.8);
  assert.equal(busFaderOf({ gain: 1, xfa: 'a' }, 1, false), xfaderGain('a', 1));
  assert.ok(busFaderOf({ gain: 1, xfa: 'a' }, 1, false) < 1e-9);
});

test('EQ del deck por MIDI: tope izquierdo = kill, centro = 0 dB, derecha = +6', () => {
  assert.equal(eqFrom01(0), KILL_DB);
  assert.equal(eqFrom01(0.5), 0);
  assert.equal(eqFrom01(1), 6);
  assert.ok(Math.abs(eqFrom01(0.25) - -13) < 1e-9);
  for (const db of [-20, -6, 0, 3, 6]) assert.ok(Math.abs(eqFrom01(eqTo01(db)) - db) < 1e-9);
  assert.equal(eqTo01(KILL_DB), 0);
});
