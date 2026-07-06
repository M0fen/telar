import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeq, buildSeq, type Parsed } from '../src/nodes/stepseqCode.ts';

// Round-trip de la rejilla (P0.1d, auditoría dancehall): lo que la rejilla no modela
// se PRESERVA al reconstruir (bank/room/lpf por segmento), y los niveles escalares
// (.gain(0.35) de los kits) se re-emiten como .mul(gain(x)) para no pisar los acentos.

const parsed = (code: string): Parsed => {
  const p = parseSeq(code);
  assert.ok(p, `parseSeq devolvió null para: ${code}`);
  assert.equal(p!.complex, false, `patrón marcado complejo: ${code}`);
  return p!;
};
const rebuild = (code: string): string => {
  const p = parsed(code);
  return buildSeq(p, p.lanes, p.steps);
};

test('simple sin extras: round-trip idéntico en forma simple', () => {
  const out = rebuild('s("bd ~ bd ~, ~ sd ~ sd")');
  assert.equal(out, 's("bd ~ bd ~, ~ sd ~ sd")');
});

test('kit dembow: bank y gain POR SEGMENTO sobreviven a la reconstrucción', () => {
  // como el kit de instrumentKits.ts pero con segmentos de igual longitud (los dispares
  // siguen siendo "complejos" y no se tocan). Antes: la rejilla descartaba .bank y .gain.
  const kit = 'stack(s("bd ~ ~ ~ bd ~ ~ ~").bank("RolandTR808"), s("~ ~ ~ sd ~ ~ sd ~").bank("RolandTR808").gain(0.85), s("hh*8").bank("RolandTR808").gain(0.35))';
  const out = rebuild(kit);
  const banks = out.match(/\.bank\("RolandTR808"\)/g) ?? [];
  assert.equal(banks.length, 3, `banks por pista perdidos: ${out}`);
  assert.match(out, /\.mul\(gain\(0\.85\)\)/);
  assert.match(out, /\.mul\(gain\(0\.35\)\)/);
  // jamás un .gain escalar que pise acentos futuros
  assert.doesNotMatch(out, /\)\.gain\(0\.85\)/);
});

test('nivel de segmento + acentos: el .gain("…") de acentos convive con .mul(gain(nivel))', () => {
  const out = rebuild('stack(s("bd ~ bd ~").gain("1 1 1.4 1").gain(0.5))');
  assert.match(out, /\.gain\("1 1 1\.4 1"\)/); // acentos intactos
  assert.match(out, /\.mul\(gain\(0\.5\)\)/); // nivel multiplicativo
});

test('gain escalar en la COLA global → .mul(gain(x)) (no pisa las pistas)', () => {
  // la rejilla normaliza agrupando por sonido ("bd sd" → "bd ~, ~ sd"): preexistente.
  const out = rebuild('s("bd sd").gain(0.6)');
  assert.match(out, /^s\("bd ~, ~ sd"\)\.mul\(gain\(0\.6\)\)$/);
});

test('residuo por segmento (.room/.lpf) se preserva verbatim', () => {
  const out = rebuild('stack(s("~ sd ~ sd").room(0.2).lpf(1800))');
  assert.match(out, /\.room\(0\.2\)\.lpf\(1800\)/);
});

test('forma .mul(gain(x)) previa se re-parsea como nivel (round-trip estable)', () => {
  const once = rebuild('stack(s("hh*8").gain(0.35))');
  const twice = rebuild(once);
  assert.equal(once, twice, 'la reconstrucción no es estable');
  assert.match(twice, /\.mul\(gain\(0\.35\)\)/);
  assert.doesNotMatch(twice, /mul\(gain\(0\.35\)\).*mul\(gain\(0\.35\)\)/); // sin duplicar
});

test('pista afinada conserva su residuo y nivel', () => {
  const out = rebuild('stack(note("c2 ~ eb2 ~").s("cb").bank("RolandTR808").gain(0.6))');
  assert.match(out, /note\("c2 ~ eb2 ~"\)\.s\("cb"\)/);
  assert.match(out, /\.bank\("RolandTR808"\)/);
  assert.match(out, /\.mul\(gain\(0\.6\)\)/);
});

test('groove por pista se re-emite (no se duplica el velocity del humanize)', () => {
  const src = 'stack(s("hh ~ hh ~").swingBy(0.17, 4).late(rand.range(0,0.01)).velocity(rand.range(0.85,1)))';
  const out = rebuild(src);
  const vels = out.match(/\.velocity\(/g) ?? [];
  assert.equal(vels.length, 1, `velocity duplicado: ${out}`);
  assert.match(out, /\.swingBy\(/);
});

test('residuo irreconstruible → patrón avanzado (no se toca)', () => {
  const p = parseSeq('stack(s("bd") + algoRaro)');
  assert.ok(p);
  assert.equal(p!.complex, true);
});

test('editar un paso NO pierde los extras (flujo real de la rejilla)', () => {
  const kit = 'stack(s("bd ~ ~ ~").bank("RolandTR808").gain(0.9))';
  const p = parsed(kit);
  // enciende el paso 3 (como paint() en la UI)
  const lanes = p.lanes.map((l) => ({ ...l, steps: l.steps.map((v, i) => (i === 2 ? 1 : v)) }));
  const out = buildSeq(p, lanes, p.steps);
  assert.match(out, /s\("bd ~ bd ~"\)/);
  assert.match(out, /\.bank\("RolandTR808"\)/);
  assert.match(out, /\.mul\(gain\(0\.9\)\)/);
});
