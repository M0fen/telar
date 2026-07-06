import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeq, buildSeq, splitArrange, spliceArm, isMelodicCode, seedSilent, type Parsed } from '../src/nodes/stepseqCode.ts';
import { URBAN_KITS } from '../src/graph/instrumentKits.ts';

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

test('kit dembow: bank y gain por segmento sobreviven a la reconstrucción', () => {
  // como el kit de instrumentKits.ts pero con segmentos de igual longitud (los dispares
  // siguen siendo "complejos" y no se tocan). Antes: la rejilla descartaba .bank y .gain.
  // Los bancos por segmento COHERENTES se unifican como banco de la rejilla (selector
  // «caja») y se re-emiten global — mismo sonido, un solo .bank.
  const kit = 'stack(s("bd ~ ~ ~ bd ~ ~ ~").bank("RolandTR808"), s("~ ~ ~ sd ~ ~ sd ~").bank("RolandTR808").gain(0.85), s("hh*8").bank("RolandTR808").gain(0.35))';
  const p = parsed(kit);
  assert.equal(p.bank, 'RolandTR808'); // el selector «caja» ya lo ve
  const out = buildSeq(p, p.lanes, p.steps);
  assert.match(out, /\.bank\("RolandTR808"\)/);
  assert.match(out, /\.mul\(gain\(0\.85\)\)/);
  assert.match(out, /\.mul\(gain\(0\.35\)\)/);
  // jamás un .gain escalar que pise acentos futuros
  assert.doesNotMatch(out, /\)\.gain\(0\.85\)/);
});

test('percusión de pack EXENTA del banco: el banco no la prefija (la silenciaría)', () => {
  // mezcla caja de ritmos + conga de pack: el banco va POR SEGMENTO en las bancables.
  const out = rebuild('stack(s("bd ~ bd ~").bank("RolandTR808"), s("~ crate_conga ~ crate_conga"))');
  assert.match(out, /s\("bd ~ bd ~"\)\.bank\("RolandTR808"\)/);
  assert.doesNotMatch(out, /crate_conga[^)]*"\)\.bank\(/); // la conga queda SIN banco
  assert.equal(rebuild(out), out, 'round-trip inestable');
});

test('rejilla SOLO de packs con banco heredado: el banco se descarta (antes: pista muda)', () => {
  const out = rebuild('s("crate_sh*8").bank("RolandTR808")');
  assert.doesNotMatch(out, /\.bank\(/);
  assert.match(out, /crate_sh/);
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

test('P0.2 swing por pista: n sigue la resolución de la rejilla (16 pasos → semicorcheas)', () => {
  const p16 = parsed('stack(s("hh*16"))');
  const l16 = p16.lanes.map((l) => ({ ...l, swing: 0.5 }));
  assert.match(buildSeq(p16, l16, 16), /\.swingBy\(0\.17, 8\)/); // 16 pasos → n=8 (pares de semicorcheas)
  const p8 = parsed('stack(s("hh*8"))');
  const l8 = p8.lanes.map((l) => ({ ...l, swing: 0.5 }));
  assert.match(buildSeq(p8, l8, 8), /\.swingBy\(0\.17, 4\)/); // 8 pasos → n=4
});

test('P0.2 swing: round-trip conserva el amount con cualquier n', () => {
  const out = rebuild('stack(s("hh ~ hh ~ hh ~ hh ~").swingBy(0.17, 8))');
  assert.match(out, /\.swingBy\(0\.17, 4\)/); // 8 pasos → re-emite con su n correcto
});

test('residuo irreconstruible → patrón avanzado (no se toca)', () => {
  const p = parseSeq('stack(s("bd") + algoRaro)');
  assert.ok(p);
  assert.equal(p!.complex, true);
});

// --- RED DE SEGURIDAD: la rejilla no se ofrece a editar lo que va a romper ---------
// (bug real: las demos usan arrange(...) por secciones; la rejilla mostraba solo el
// primer brazo como editable y el PRIMER clic rompía el patrón con error de sintaxis)

test('SEGURIDAD: source arrange() de las demos → avanzado (antes: 1 clic lo silenciaba)', () => {
  const hats = 'arrange([4, s("hh*8").bank("RolandTR808").gain(0.2)], [12, s("hh*16").bank("RolandTR808").gain(saw.range(0.1,0.3))], [12, s("hh*16").bank("RolandTR808").gain(saw.range(0.1,0.35))])';
  const p = parseSeq(hats);
  assert.ok(p);
  assert.equal(p!.complex, true);
});

test('SEGURIDAD: stack que es un brazo de arrange (cola con "], [") → avanzado', () => {
  const p = parseSeq('stack(s("bd ~ bd ~"))], [4, stack(s("bd*4"))]');
  assert.ok(p);
  assert.equal(p!.complex, true);
});

test('SEGURIDAD: melodía note("…").s("sine") → avanzado (antes: editar descartaba la melodía)', () => {
  const p = parseSeq('note("c1 ~ c1 ~ g0 ~ c1 ~").s("sine").lpf(480).shape(0.25)');
  assert.ok(p);
  assert.equal(p!.complex, true);
});

test('SEGURIDAD: los patrones normales con cola de FX siguen siendo editables', () => {
  for (const c of ['s("bd*4")', 's("bd ~ bd ~, hh*4").room(0.2).lpf(1800)', 's("hh*8").bank("RolandTR808").gain(0.35)']) {
    const p = parseSeq(c);
    assert.ok(p, c);
    assert.equal(p!.complex, false, `se volvió avanzado sin razón: ${c}`);
  }
});

test('kit "latin dancehall": sus patrones de percusión son 100% editables en rejilla', () => {
  const g = URBAN_KITS.find((k) => k.genre === 'latin dancehall');
  assert.ok(g, 'falta el grupo latin dancehall en URBAN_KITS');
  for (const it of g!.items.filter((i) => /^stack\s*\(/.test(i.code))) {
    const p = parseSeq(it.code);
    assert.ok(p, it.label);
    assert.equal(p!.complex, false, `"${it.label}" no es editable en rejilla`);
    assert.equal(p!.steps, 16, `"${it.label}" no es de 16 pasos`);
    const once = buildSeq(p!, p!.lanes, p!.steps);
    const p2 = parseSeq(once)!;
    assert.equal(buildSeq(p2, p2.lanes, p2.steps), once, `"${it.label}" round-trip inestable`);
  }
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

// --- SECCIONES (P0.3): el secuenciador edita cada brazo de un arrange ----------------

const DEMO_ARRANGE = 'arrange([4, s("hh*8").bank("RolandTR808").gain(0.2)], [12, silence], [12, s("hh*16").bank("RolandTR808").gain(saw.range(0.1,0.35))])';

test('SECCIONES: splitArrange parte los brazos con compases y spans correctos', () => {
  const arms = splitArrange(DEMO_ARRANGE);
  assert.ok(arms);
  assert.equal(arms!.length, 3);
  assert.deepEqual(arms!.map((a) => a.bars), [4, 12, 12]);
  assert.equal(arms![1].code, 'silence');
  // los spans apuntan EXACTAMENTE al expr dentro del código completo
  for (const a of arms!) assert.equal(DEMO_ARRANGE.slice(a.start, a.end), a.code);
});

test('SECCIONES: cada brazo con patrón es editable por la rejilla', () => {
  const arms = splitArrange(DEMO_ARRANGE)!;
  for (const a of arms.filter((x) => x.code !== 'silence')) {
    const p = parseSeq(a.code);
    assert.ok(p, a.code);
    assert.equal(p!.complex, false, `brazo no editable: ${a.code}`);
  }
});

test('SECCIONES: spliceArm reemplaza SOLO el brazo editado (el resto, byte a byte)', () => {
  const arms = splitArrange(DEMO_ARRANGE)!;
  const nuevo = 's("hh ~ hh ~ hh ~ hh ~")';
  const out = spliceArm(DEMO_ARRANGE, arms[0], nuevo);
  assert.ok(out.includes(nuevo));
  // las otras secciones y la estructura quedan intactas
  assert.ok(out.includes('[12, silence]'));
  assert.ok(out.includes('gain(saw.range(0.1,0.35))'));
  assert.match(out, /^arrange\(\[4, /);
  // y el resultado se vuelve a partir igual (round-trip del modo secciones)
  const arms2 = splitArrange(out)!;
  assert.equal(arms2.length, 3);
  assert.equal(arms2[0].code, nuevo);
  assert.equal(arms2[2].code, arms[2].code);
});

test('SECCIONES: flujo completo — editar la rejilla de un brazo no rompe el arrange', () => {
  const arms = splitArrange(DEMO_ARRANGE)!;
  const p = parseSeq(arms[0].code)!;
  const lanes = p.lanes.map((l) => ({ ...l, steps: l.steps.map((v, i) => (i === 0 ? 1.4 : v)) })); // acento en el paso 1
  const out = spliceArm(DEMO_ARRANGE, arms[0], buildSeq(p, lanes, p.steps));
  // sintaxis JS válida (lo que antes moría con "Unexpected token ]")
  new Function(`return 0 && (${out})`);
  const arms2 = splitArrange(out)!;
  assert.match(arms2[0].code, /\.gain\("1\.4/);
});

test('SECCIONES: arrange no estándar → null (la rejilla cae al modo protegido)', () => {
  assert.equal(splitArrange('arrange(algoRaro)'), null);
  assert.equal(splitArrange('s("bd*4")'), null);
});

test('isMelodicCode: melodías sí, rejillas/loops/arranges no', () => {
  assert.equal(isMelodicCode('note("c1 ~ c1 ~").s("sine").lpf(480)'), true);
  assert.equal(isMelodicCode('stack(note("c2 ~").s("cb"))'), false);
  assert.equal(isMelodicCode('s("bd*4")'), false);
  assert.equal(isMelodicCode('note("c2").s("x").loopAt(4)'), false);
});

// --- SIEMBRA de secciones en silencio (fix UX reportado: "no aparecen los pasos") ----

test('seedSilent melódico: piano roll vacío de 16 con el MISMO instrumento/FX', () => {
  const ref = 'note("c5 eb5 g5 ~ f5 eb5 ~ c5").s("triangle").decay(0.22).sustain(0).room(0.25).gain("1 0.8 1 1 1 1 1 1").mul(gain(0.45))';
  const seed = seedSilent(ref);
  assert.ok(seed);
  assert.equal(seed!.seedFrom, undefined); // melódico: el piano roll no necesita siembra aparte
  assert.match(seed!.code, /note\("(?:~ ){15}~"\)/); // 16 silencios
  assert.match(seed!.code, /\.s\("triangle"\)\.decay\(0\.22\)/); // instrumento y FX intactos
  assert.match(seed!.code, /\.mul\(gain\(0\.45\)\)/); // nivel de la sección conservado
  assert.doesNotMatch(seed!.code, /\.gain\("1 0\.8/); // la lane de vel de la ref NO se arrastra
});

test('seedSilent de rejilla: base sin golpes con banco/cola + pistas sembradas de la referencia', () => {
  const ref = 'stack(s("bd ~ ~ ~ bd ~ ~ ~").bank("RolandTR808"), s("~ ~ ~ sd ~ ~ sd ~").bank("RolandTR808").mul(gain(0.85)))';
  const seed = seedSilent(ref);
  assert.ok(seed);
  assert.equal(seed!.seedFrom, ref);
  assert.match(seed!.code, /^s\("~"\)\.bank\("RolandTR808"\)/); // suena a nada, banco conservado
  // la UI siembra las pistas desde seedFrom con cero pasos:
  const p = parseSeq(seed!.seedFrom!)!;
  assert.deepEqual(p.lanes.map((l) => l.sound), ['bd', 'sd']);
});

test('seedSilent: referencia inservible → null (cae al mensaje protegido)', () => {
  assert.equal(seedSilent('arrange([4, s("bd")])'), null); // anidado raro
});

test('flujo sección callada COMPLETO: sembrar, pintar una nota y empalmar sin romper', () => {
  const codeFull = 'arrange([4, silence], [12, note("c5 eb5 g5 ~").s("triangle").decay(0.22).sustain(0)])';
  const arms = splitArrange(codeFull)!;
  const ref = arms.find((a) => a.code.trim() !== 'silence')!;
  const seed = seedSilent(ref.code)!;
  // "pinta" la primera nota del piano roll sembrado (equivale a place() en la UI)
  const painted = seed.code.replace(/^note\("~/, 'note("c5');
  const out = spliceArm(codeFull, arms[0], painted);
  new Function(`return 0 && (${out})`); // sintaxis válida
  const arms2 = splitArrange(out)!;
  assert.match(arms2[0].code, /^note\("c5 (?:~ ){14}~"\)\.s\("triangle"\)/); // el instrumento ENTRÓ en la sección
  assert.equal(arms2[1].code, ref.code); // la sección original quedó intacta
});
