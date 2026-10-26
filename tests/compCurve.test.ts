// Fase 6.1 · compresor por pista: curva, tiempos y ruta del compilador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compGainDb, compressBlock, smoothCoef, COMP_PRESETS } from '../src/lib/compCurve.ts';
import { compileGraph, eqSourceIds } from '../src/graph/compile.ts';
import { bakeSong } from '../src/lib/songBake.ts';

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('6.1 curva: nada bajo el umbral, ratio encima, rodilla suave en medio', () => {
  near(compGainDb(-40, -18, 4), 0, 1e-9, 'bajo el umbral');
  near(compGainDb(-6, -18, 4), -9, 1e-9, '12 dB encima a 4:1 → 3 dB encima'); // −6 → −15
  near(compGainDb(0, -18, 1), 0, 1e-9, 'ratio 1');
  // la rodilla es continua en sus bordes
  near(compGainDb(-21 - 1e-6, -18, 4), compGainDb(-21 + 1e-6, -18, 4), 1e-4, 'borde bajo');
  near(compGainDb(-15 - 1e-6, -18, 4), compGainDb(-15 + 1e-6, -18, 4), 1e-4, 'borde alto');
  assert.ok(compGainDb(-18, -18, 4) < 0 && compGainDb(-18, -18, 4) > -1, 'en el umbral ya comprime un poco');
});

test('6.1 tiempos: llega al 63 % en el ataque, se recupera con el release, makeup exacto', () => {
  const sr = 48000;
  // seno a 0 dBFS (pico 1) durante 200 ms → reducción estática: −18 + 18/4 − 0 = −13,5 dB
  const n = Math.round(sr * 0.2);
  const L = new Float32Array(n).fill(1);
  const R = new Float32Array(n).fill(1);
  const st = { gs: 0 };
  compressBlock(L, R, { thr: -18, ratio: 4, att: 10, rel: 100, makeup: 0 }, sr, st);
  near(st.gs, -13.5, 0.01, 'reducción estática');
  // en el ataque (10 ms) va por el 63 %
  const a = new Float32Array(Math.round(sr * 0.01)).fill(1);
  const s2 = { gs: 0 };
  compressBlock(a, a.slice(), { thr: -18, ratio: 4, att: 10, rel: 100, makeup: 0 }, sr, s2);
  near(s2.gs, -13.5 * (1 - Math.exp(-1)), 0.1, 'ataque');
  // silencio después: release
  const z = new Float32Array(Math.round(sr * 0.1));
  const s3 = { gs: -13.5 };
  compressBlock(z, z.slice(), { thr: -18, ratio: 4, att: 10, rel: 100, makeup: 0 }, sr, s3);
  near(s3.gs, -13.5 * Math.exp(-1), 0.1, 'release');
  // makeup: bajo el umbral, la señal sube exactamente eso
  const q = new Float32Array(100).fill(0.01);
  compressBlock(q, q.slice(), { thr: -18, ratio: 4, att: 10, rel: 100, makeup: 6 }, sr, { gs: 0 });
  near(q[99], 0.01 * Math.pow(10, 6 / 20), 1e-6, 'makeup');
  near(smoothCoef(10, sr), Math.exp(-1 / 480), 1e-12, 'coef');
  assert.equal(COMP_PRESETS.length, 4);
});

const src = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', name: id, code: 's("bd*4")', ...extra } });
const out = { id: 'out_1', type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } };

test('6.1 compilador: el compresor da a la pista su bus (orbit) y viaja en la ruta', () => {
  const comp = { on: true, thr: -20, ratio: 4, att: 10, rel: 120, makeup: 4 };
  const nodes = [src('kick', { comp }), src('hats'), out] as never[];
  const edges = [{ id: 'a', source: 'kick', target: 'out_1' }, { id: 'b', source: 'hats', target: 'out_1' }];
  const r = compileGraph(nodes, edges);
  assert.deepEqual(eqSourceIds(nodes), ['kick']);
  assert.equal(r.channelEqs.length, 1);
  assert.equal(r.channelEqs[0].source, 'kick');
  assert.deepEqual(r.channelEqs[0].comp, comp && { thr: -20, ratio: 4, att: 10, rel: 120, makeup: 4 });
  assert.equal(r.channelEqs[0].low, 0);
  assert.ok(r.code!.includes(`.orbit(${r.channelEqs[0].orbit})`));
  // apagado → sin ruta
  const off = compileGraph([src('kick', { comp: { ...comp, on: false } }), out] as never[], [edges[0]]);
  assert.equal(off.channelEqs.length, 0);
});

test('6.1 canción: el compresor de una escena entra en su sección y en las demás queda en bypass', () => {
  const comp = { on: true, thr: -20, ratio: 4, att: 10, rel: 120, makeup: 4 };
  const nodes = [src('kick'), out] as never[];
  const edges = [{ id: 'a', source: 'kick', target: 'out_1' }];
  const scenes = { 2: { slot: 2, name: 'drop', state: { kick: { comp } }, savedAt: 0 } };
  const M = { gain: 1, filter: 0, room: 0, drive: 0, delay: 0, crush: 0, swing: 0, humanize: 0, limit: 0, glue: 0 };
  const b = bakeSong({ nodes, edges, steps: [{ scene: 1, bars: 4 }, { scene: 2, bars: 4 }], scenes: scenes as never, master: M });
  assert.equal(b.sections.length, 2);
  const o0 = b.sections[0].channelEqs[0];
  const o1 = b.sections[1].channelEqs[0];
  assert.equal(o0.orbit, o1.orbit); // el mismo bus toda la canción
  assert.equal(o0.comp, null);
  assert.equal(o1.comp?.ratio, 4);
});
