// Fase 7.2: automatizar cualquier perilla (pista, máster, motor) y grabarla en el jam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { automationSuffix, masterAutomationSuffix, isActive, cleanAuto, curveAt, engineAutomation, hasEngineAuto, curveSamples, type AutoPoint } from '../src/lib/automation.ts';
import { compileGraph, eqSourceIds } from '../src/graph/compile.ts';
import { buildFromTake, masterCurves, type JamTake } from '../src/lib/jamRecorder.ts';
import { strudelCore } from './helpers/strudelNode.ts';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const out = (extra: Record<string, unknown> = {}) => ({ id: 'out_1', type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out', ...extra } });
const src = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', code: 's("bd*4")', ...extra } });

test('7.2 curvas que FIJAN un valor: activas con un punto; las que componen, solo fuera del neutro', () => {
  assert.equal(isActive([[0, 0.5]], 'pan'), true); // el centro también es un valor fijado
  assert.equal(isActive([[0, 0]], 'rev'), true);
  assert.equal(isActive([[0, 0]], 'mroom'), false); // reverb del máster en 0 = no hace nada
  assert.equal(isActive([[0, 1]], 'vol'), false);
  assert.deepEqual(cleanAuto({ mfilt: [[0, -3]], rv: [[2, -50]], nada: [[0, 1]] }), { mfilt: [[0, -1]], rv: [[2, -30]] });
});

test('7.2 valor en el compás, repitiendo con la canción', () => {
  const p: AutoPoint[] = [[0, 0], [8, 1]];
  assert.equal(curveAt(p, 4, 16), 0.5);
  assert.equal(curveAt(p, 20, 16), 0.5);
  assert.equal(curveAt(p, 20, 0), 1);
  const smp = curveSamples(p, 0, 0, 8, 0.5, 10, (v) => v * 100); // 16 s a 10 por segundo
  assert.equal(smp.length, 161);
  near(smp[0], 0);
  near(smp[80], 50);
  near(smp[160], 100);
});

test('7.2 paneo por compás (Strudel real)', async () => {
  const core = await strudelCore();
  const sfx = automationSuffix({ pan: [[0, 0], [4, 1]] }, 8);
  const pat = new Function('p', 'return p' + sfx)((core as any).s('bd').fast(4));
  const at = (c: number) => pat.queryArc(c, c + 0.01).filter((h: any) => h.hasOnset())[0].value;
  assert.equal(at(0).pan, 0);
  assert.equal(at(2).pan, 0.5);
  assert.equal(at(8 + 2).pan, 0.5); // se repite con la canción
});

test('7.2 reverb/eco/crush del máster: componen con la voz (Strudel real)', async () => {
  const core = await strudelCore();
  const sfx = masterAutomationSuffix({ mroom: [[0, 0], [4, 0.5]], mcrush: [[0, 1]], mdelay: [[0, 0]] }, 0);
  assert.ok(!sfx.includes('D(t)') || sfx.includes('null,')); // eco en 0: inactivo
  const pat = new Function('p', 'return p' + sfx)((core as any).s('bd').room(0.2).fast(4));
  const at = (c: number) => pat.queryArc(c, c + 0.01).filter((h: any) => h.hasOnset())[0].value;
  near(at(0).room, 0.2); // la curva en 0 no toca la voz
  near(at(4).room, 1 - 0.8 * 0.5); // 1−(1−0,2)(1−0,5)
  assert.equal(at(0).crush, 4); // 16 − 12
  assert.equal(masterAutomationSuffix(undefined, 8), '');
});

test('7.2 el máster automatizado envuelve la mezcla y corre los spans del resaltado', () => {
  const plain = compileGraph([src('a'), out()] as never[], [{ id: 'e', source: 'a', target: 'out_1' }], { songBars: 8 });
  const r = compileGraph([src('a'), out({ auto: { mroom: [[0, 0], [4, 0.6]] } })] as never[], [{ id: 'e', source: 'a', target: 'out_1' }], { songBars: 8 });
  assert.ok(r.code!.startsWith('(') && r.code!.includes('.withHap('));
  assert.equal(r.spans[0].start, plain.spans[0].start + 1);
  assert.equal(r.code!.slice(r.spans[0].start, r.spans[0].end), plain.code!.slice(plain.spans[0].start, plain.spans[0].end));
});

test('7.2 curvas del motor: envíos de las pistas y filtro DJ/drive/retornos del máster', () => {
  const nodes = [src('a', { auto: { rev: [[0, 0], [8, 1]], vol: [[0, 0.5]] } }), src('b'), out({ auto: { mfilt: [[0, -1], [16, 0]], mroom: [[0, 0.3]] } })];
  const e = engineAutomation(nodes as never[], 32);
  assert.equal(e.bars, 32);
  assert.deepEqual(Object.keys(e.sends), ['a']);
  assert.ok(e.sends.a.rev && !e.sends.a.del);
  assert.deepEqual(Object.keys(e.master), ['mfilt']); // la reverb del máster va en el código
  assert.equal(hasEngineAuto(engineAutomation([src('b'), out()] as never[], 8)), false);
  // una pista con curva de envío pero la perilla en 0: igual recibe su tira (y los retornos)
  const r = compileGraph(nodes as never[], [{ id: 'e1', source: 'a', target: 'out_1' }, { id: 'e2', source: 'b', target: 'out_1' }], { songBars: 32 });
  assert.deepEqual(eqSourceIds(nodes as never[]), ['a']);
  assert.equal(r.channelEqs[0].source, 'a');
  assert.equal(r.channelEqs[0].autoSends, true);
});

test('7.2 jam: las perillas del máster y los envíos que moviste quedan como curvas', () => {
  const take: JamTake = { bars: 4, samples: [] };
  for (let q = 0; q < 16; q++) {
    const t = q / 4;
    take.samples.push({
      t,
      scene: null,
      tracks: { a: { audible: true, gain: 1, filt: 0, rev: t < 2 ? 0 : 0.5, del: 0 } },
      master: { filter: -t / 4, drive: 0.2, room: 0, delay: 0, crush: 0, rv: 0, dl: 0 },
    });
  }
  const m = masterCurves(take, 4)!;
  assert.deepEqual(Object.keys(m.auto), ['mfilt']); // el drive no se movió
  assert.equal(m.reset.filter, 0);
  assert.equal(m.auto.mfilt![0][1], 0);
  near(m.auto.mfilt![m.auto.mfilt!.length - 1][1], -0.938, 1e-3);
  const b = buildFromTake(take, { a: 's("bd*4")' }, { freeScene: 1, makeId: () => 'x' })!;
  assert.ok(b.master?.auto.mfilt);
  assert.ok(b.patches.a.auto?.rev);
  assert.equal(b.patches.a.auto?.del, undefined);
});
