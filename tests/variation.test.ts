import test from 'node:test';
import assert from 'node:assert/strict';
import { splitVariation, joinVariation, setVariation, fillFor } from '../src/lib/variation.ts';
import { splitArrange, muteArm, unmuteArm, isMutedArm } from '../src/nodes/stepseqCode.ts';
import { strudelCore } from './helpers/strudelNode.ts';

test('7.3 variación: unir y separar (compás entero y media)', () => {
  const v = { base: 's("bd*4, ~ hh")', fill: 's("bd*4, hh*8")', every: 8, half: false };
  const c = joinVariation(v);
  assert.equal(c, 's("bd*4, ~ hh").lastOf(8, () => s("bd*4, hh*8"))');
  assert.deepEqual(splitVariation(c), v);
  const h = { ...v, every: 4, half: true };
  assert.deepEqual(splitVariation(joinVariation(h)), h);
  assert.equal(splitVariation('s("bd").lastOf(4, x=>x.rev())'), null); // el lastOf propio de alguien: no es un fill
  assert.equal(splitVariation('s("bd*4")'), null);
  // fill con paréntesis y strings con paréntesis dentro
  const tricky = { base: 'note("c3 (3,8)").s("saw")', fill: 'note("[c3,eb3] ~").s("saw").lpf(sine.range(200,900))', every: 16, half: false };
  assert.deepEqual(splitVariation(joinVariation(tricky)), tricky);
});

test('7.3 poner, cambiar y quitar la variación', () => {
  const base = 's("bd*4")';
  const a = setVariation(base, 8);
  assert.equal(a, 's("bd*4").lastOf(8, () => s("bd*4"))'); // copia para editar
  assert.equal(setVariation(base, 4, 'cut'), 's("bd*4").lastOf(4, () => silence)');
  assert.equal(fillFor(base, 'roll'), 's("bd*2 bd*2 bd*2 bd*2")'); // roll en la rejilla: se sigue editando
  assert.equal(fillFor('s("<bd sd>")', 'roll'), '(s("<bd sd>")).ply(2)'); // sin rejilla: .ply(2)
  const b = setVariation(setVariation(base, 8, 'cut'), 16, 'copy', true); // cambia cada cuánto y la duración: el fill se queda
  assert.deepEqual(splitVariation(b), { base, fill: 'silence', every: 16, half: true });
  assert.equal(setVariation(b, 0), base);
  // apagar/encender una sección con variación no la rompe
  const m = muteArm(a);
  assert.ok(isMutedArm(m));
  assert.equal(unmuteArm(m), a);
});

test('7.3 suena donde toca (Strudel real): el último de cada N, contado desde la sección', async () => {
  const core: any = await strudelCore();
  const mini: any = await import('@strudel/mini');
  mini.miniAllStrings?.();
  const scope: Record<string, unknown> = { ...core, ...mini };
  const keys = Object.keys(scope).filter((k) => /^[a-z]\w*$/i.test(k));
  const ev = (code: string) => new Function(...keys, `return ${code}`)(...keys.map((k) => scope[k]));
  const snd = (P: any, c: number) => P.queryArc(c, c + 1).filter((h: any) => h.hasOnset()).map((h: any) => h.value.s).join(' ');
  const p = ev(joinVariation({ base: 's("bd*2")', fill: 's("sd*2")', every: 4, half: false }));
  assert.deepEqual([0, 1, 2, 3, 7].map((c) => snd(p, c)), ['bd bd', 'bd bd', 'bd bd', 'sd sd', 'sd sd']);
  // dentro de un arrange: la frase de la sección (no la del tema)
  const code = `arrange([8, ${joinVariation({ base: 's("bd")', fill: 's("cp")', every: 4, half: false })}], [4, s("hh")])`;
  assert.equal(splitArrange(code)!.length, 2); // sigue siendo un brazo por sección
  const a = ev(code);
  assert.deepEqual([0, 3, 4, 7, 8, 11, 12, 15, 19].map((c) => snd(a, c)), ['bd', 'cp', 'bd', 'cp', 'hh', 'hh', 'bd', 'cp', 'cp']);
  // media: la primera mitad del compás de la base, la segunda del fill
  const hp = ev(joinVariation({ base: 's("bd*4")', fill: 's("sd*4")', every: 2, half: true }));
  assert.equal(snd(hp, 0), 'bd bd bd bd');
  assert.equal(snd(hp, 1), 'bd bd sd sd');
});
