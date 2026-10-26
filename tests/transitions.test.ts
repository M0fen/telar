import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTransitions, transSpan, transitionsCode, sweepCurve, autoTransitions, packTransitions, SWEEP_TOP } from '../src/lib/transitions.ts';
import { engineAutomation, curveAt } from '../src/lib/automation.ts';
import { compileGraph } from '../src/graph/compile.ts';
import { strudelCore } from './helpers/strudelNode.ts';

test('7.4 elementos limpios, ordenados y en su sitio', () => {
  const items = cleanTransitions([{ kind: 'impact', at: 16, bars: 9 }, { kind: 'riser', at: 16, bars: 4 }, { kind: 'nada', at: 1, bars: 1 }, { kind: 'reverse', at: -2, bars: 1 }, { kind: 'sweep', at: 8, bars: 99 }]);
  assert.deepEqual(items, [{ kind: 'riser', at: 16, bars: 4 }, { kind: 'impact', at: 16, bars: 1 }]);
  assert.deepEqual(transSpan(items[0]), { start: 12, bars: 4 }); // termina en el compás
  assert.deepEqual(transSpan(items[1]), { start: 16, bars: 1 }); // empieza en el compás
});

test('7.4 «en cada sección»: riser que termina en cada cambio e impacto en su primer compás', () => {
  assert.deepEqual(autoTransitions([{ bars: 8 }, { bars: 16 }, { bars: 2 }]), [
    { kind: 'riser', at: 8, bars: 4 }, { kind: 'impact', at: 8, bars: 1 },
    { kind: 'riser', at: 24, bars: 4 }, { kind: 'impact', at: 24, bars: 1 },
  ]);
});

test('7.4 el código: cada elemento en su compás, un evento que dura lo que el elemento (Strudel real)', async () => {
  const code = transitionsCode([{ kind: 'riser', at: 8, bars: 4 }, { kind: 'impact', at: 8, bars: 1 }], 16);
  const core: any = await strudelCore();
  const mini: any = await import('@strudel/mini');
  mini.miniAllStrings?.();
  const scope: Record<string, unknown> = { ...core, ...mini };
  const keys = Object.keys(scope).filter((k) => /^[a-z]\w*$/i.test(k));
  const pat = new Function(...keys, `return ${code}`)(...keys.map((k) => scope[k]));
  const ons = (a: number, b: number) => pat.queryArc(a, b).filter((h: any) => h.hasOnset()).map((h: any) => [Number(h.whole.begin), Number(h.whole.end), h.value.s]);
  assert.deepEqual(ons(0, 4), []);
  assert.deepEqual(ons(4, 8), [[4, 8, 'telar_riser']]); // el riser: compases 4–8, UN evento de 4 (sus envolventes leen la duración)
  assert.deepEqual(ons(8, 9).sort(), [[8, 9, 'telar_boom'], [8, 9, 'telar_crash']]); // el impacto en el 8
  assert.deepEqual(ons(16 + 4, 16 + 5).length, 1); // se repite con la canción
  assert.equal(transitionsCode([{ kind: 'sweep', at: 8, bars: 4 }], 16), 'silence'); // el barrido no suena: es automatización
  assert.equal(transitionsCode([{ kind: 'riser', at: 8, bars: 4 }], 0), 'silence'); // sin canción, nada
  // un riser que empezaría antes del compás 1 se acorta (sigue terminando en su compás)
  assert.match(transitionsCode([{ kind: 'riser', at: 2, bars: 4 }], 8), /^arrange\(\[2, s\("telar_riser"\)\.note\(48\)\.slow\(2\)\], \[6, silence\]\)$/);
});

test('7.4 barrido: el filtro DJ sube y se abre en el compás, encima de la curva que hubiera', () => {
  const alone = sweepCurve([{ kind: 'sweep', at: 16, bars: 8 }], undefined, 32)!;
  assert.equal(curveAt(alone, 4, 32), 0);
  assert.equal(curveAt(alone, 8, 32), 0);
  assert.ok(Math.abs(curveAt(alone, 12, 32) - SWEEP_TOP / 2) < 0.01);
  assert.equal(curveAt(alone, 16, 32), 0);
  const user: [number, number][] = [[0, -0.5], [32, -0.5]];
  const merged = sweepCurve([{ kind: 'sweep', at: 16, bars: 4 }], user, 32)!;
  assert.equal(curveAt(merged, 2, 32), -0.5); // fuera del barrido, la curva del usuario
  assert.ok(curveAt(merged, 15.9, 32) > 0.6);
  assert.equal(curveAt(merged, 20, 32), -0.5);
  // la automatización del motor la recoge del nodo de transiciones
  const nodes = [{ id: 't', data: { kind: 'source', transitions: [{ kind: 'sweep', at: 8, bars: 4 }] } }, { id: 'o', data: { kind: 'out' } }];
  const e = engineAutomation(nodes as never[], 16);
  assert.ok(e.master.mfilt && e.master.mfilt.length >= 3);
});

test('7.4 la pista de transiciones compila desde sus elementos (no desde su código)', () => {
  const nodes = [
    { id: 't', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', name: 'transiciones', code: 'silence', transitions: [{ kind: 'reverse', at: 4, bars: 1 }] } },
    { id: 'out_1', type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } },
  ];
  const r = compileGraph(nodes as never[], [{ id: 'e', source: 't', target: 'out_1' }] as never[], { songBars: 8 });
  assert.match(r.code!, /arrange\(\[3, silence\], \[1, s\("telar_reverse"\)\.slow\(1\)\], \[4, silence\]\)/);
});

test('7.4 lo afinado sigue a la tónica; la pista no gasta orbit propio; en M no barre', () => {
  const code = transitionsCode([{ kind: 'riser', at: 4, bars: 4 }, { kind: 'impact', at: 4, bars: 1 }], 8, 9); // La
  assert.match(code, /s\("telar_riser"\)\.note\(57\)/); // A3 → sube a A5
  assert.match(code, /s\("telar_boom"\)\.note\(33\)/); // el grave cae hasta A1
  assert.doesNotMatch(code, /room\(/); // seco: la reverb de superdough no llega a tiempo en el render
  const nodes = [
    { id: 't', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', name: 'transiciones', code: 'silence', transitions: [{ kind: 'impact', at: 4, bars: 1 }] } },
    { id: 'a', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', name: 'hat', code: 's("hh*4").room(0.3)' } },
    { id: 'out_1', type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } },
  ];
  const edges = [{ id: 'e1', source: 't', target: 'out_1' }, { id: 'e2', source: 'a', target: 'out_1' }];
  const r = compileGraph(nodes as never[], edges as never[], { songBars: 8, keyRoot: 5 });
  assert.equal(r.channelEqs.length, 0); // sin EQ/compresor/envíos, ninguna pista usa orbit propio
  assert.match(r.code!, /s\("telar_boom"\)\.note\(29\)/); // Fa
  const sw = [{ id: 't', data: { kind: 'source', mute: true, transitions: [{ kind: 'sweep', at: 8, bars: 4 }] } }];
  assert.equal(engineAutomation(sw as never[], 16).master.mfilt, undefined);
});

test('7.4 en la fila del DAW lo que se pisa va en otra sub-fila; lo de fuera no se dibuja', () => {
  const { placed, rows } = packTransitions([
    { kind: 'riser', at: 4, bars: 4 }, { kind: 'impact', at: 4, bars: 1 }, { kind: 'riser', at: 8, bars: 4 },
    { kind: 'sweep', at: 8, bars: 4 }, { kind: 'impact', at: 8, bars: 1 }, { kind: 'reverse', at: 30, bars: 1 },
  ], 12);
  assert.equal(rows, 3); // riser + barrido + impacto a la vez entre los compases 4 y 5
  for (const a of placed) for (const b of placed) {
    if (a !== b && a.row === b.row) assert.ok(a.end <= b.start || b.end <= a.start, `se pisan ${a.it.kind}@${a.it.at} y ${b.it.kind}@${b.it.at}`);
  }
  assert.equal(placed.find((p) => p.it.kind === 'riser' && p.it.at === 4)!.row, 0);
  assert.equal(placed.length, 5); // el reverso del compás 30 cae fuera de 12
});
