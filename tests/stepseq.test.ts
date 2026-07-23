import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeq, buildSeq, splitArrange, spliceArm, isMelodicCode, seedSilent, NORMAL, type Parsed } from '../src/nodes/stepseqCode.ts';
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

// --- FORMA MELÓDICA en la rejilla (pedido del usuario: "el secuenciador en todas ---
// partes"): una melodía suelta es UNA pista afinada — pasos + afinar arrastrando.

test('MELODÍA: note("…").s("sine") es editable en la rejilla como pista afinada', () => {
  const p = parsed('note("c1 ~ c1 ~ g0 ~ c1 ~").s("sine").lpf(480).shape(0.25)');
  assert.equal(p.melodic, true);
  assert.equal(p.lanes.length, 1);
  assert.equal(p.lanes[0].sound, 'sine');
  assert.deepEqual(p.lanes[0].notes.slice(0, 3), ['c1', null, 'c1']);
  assert.equal(p.lanes[0].sfx, '.lpf(480).shape(0.25)'); // FX preservados verbatim
});

test('MELODÍA: round-trip bare (sin stack) — compatible con el piano roll', () => {
  const src = 'note("c1 ~ c1 ~ g0 ~ c1 ~").s("sine").lpf(480).shape(0.25)';
  const once = rebuild(src);
  assert.match(once, /^note\("c1 ~ c1 ~ g0 ~ c1 ~"\)\.s\("sine"\)\.lpf\(480\)\.shape\(0\.25\)$/);
  assert.equal(rebuild(once), once, 'inestable');
});

test('MELODÍA vaciada: el instrumento NO se pierde (nada de s("~"))', () => {
  const p = parsed('note("c1 ~ c1 ~").s("sine").lpf(480)');
  const empty = p.lanes.map((l) => ({ ...l, steps: l.steps.map(() => 0) }));
  const out = buildSeq(p, empty, p.steps);
  assert.match(out, /^note\("~ ~ ~ ~"\)\.s\("sine"\)\.lpf\(480\)$/);
});

test('MELODÍA con acordes y nivel (kit skank): editable y estable', () => {
  const skank = URBAN_KITS.find((k) => k.genre === 'latin dancehall')!.items.find((i) => i.label.startsWith('skank'))!.code;
  const p = parsed(skank);
  assert.equal(p.melodic, true);
  assert.match(p.lanes[0].notes[1] ?? '', /^\[c4,eb4,g4\]$/); // el acorde vive en la nota del paso
  const once = buildSeq(p, p.lanes, p.steps);
  assert.equal(rebuild(once), once, 'inestable');
  assert.match(once, /\.mul\(gain\(0\.5\)\)/);
  assert.match(once, /\.delay\(0\.25\)/); // eco dub preservado
});

test('MELODÍA: la lane de vel del piano roll (.gain("…")) mapea a niveles y vuelve', () => {
  const src = 'note("c2 eb2 g1 c2").s("sine").gain("1 0.5 1.4 1")';
  const p = parsed(src);
  assert.deepEqual(p.lanes[0].steps, [1, 0.5, 1.4, 1]);
  assert.match(rebuild(src), /\.gain\("1 0\.5 1\.4 1"\)/);
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
  assert.equal(seed!.seedFrom, ref); // la rejilla siembra las notas de la referencia
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
  // suena a nada (N silencios, conservando la longitud como ya hacía la rama melódica)
  // y el banco se conserva. Antes colapsaba a s("~") = 1 paso.
  assert.match(seed!.code, /^s\("~(?: ~)*"\)\.bank\("RolandTR808"\)/);
  assert.equal(parseSeq(seed!.code)!.steps, 8); // misma longitud que la referencia
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

// --- P1.2 micro-timing por paso + humanize centrado · P1.5 velocity continua --------

test('P1.2 nudge: se emite .late("…") alineado a los pasos y hace round-trip', () => {
  const p = parsed('stack(s("bd ~ sd ~"))');
  const lanes = p.lanes.map((l) => ({ ...l, nudge: [0, 0, 0.012, 0] }));
  const out = buildSeq(p, lanes, p.steps);
  assert.match(out, /\.late\("0 0 0\.012 0"\)/);
  const p2 = parseSeq(out)!;
  assert.equal(p2.complex, false);
  assert.deepEqual(p2.lanes.find((l) => l.sound === 'sd')?.nudge ?? p2.lanes[0].nudge, [0, 0, 0.012, 0]);
  assert.equal(buildSeq(p2, p2.lanes, p2.steps), out, 'inestable');
});

test('P1.2 nudge negativo (adelanta) válido y con tope ±NUDGE_MAX', () => {
  const p = parsed('stack(s("bd ~ bd ~"))');
  const lanes = p.lanes.map((l) => ({ ...l, nudge: [-0.5, 0, 0.009, 0] })); // -0.5 se recorta
  const out = buildSeq(p, lanes, p.steps);
  assert.match(out, /\.late\("-0\.02 0 0\.009 0"\)/);
  new Function(`return 0 && (${out})`); // sintaxis válida con negativos
});

test('P1.2 humanize centrado: rand.range(-h/2, h/2) y round-trip de ambas formas', () => {
  const p = parsed('stack(s("hh*8"))');
  const lanes = p.lanes.map((l) => ({ ...l, human: 0.5 }));
  const out = buildSeq(p, lanes, p.steps);
  assert.match(out, /\.late\(rand\.range\(-0\.005,0\.005\)\)/); // centrado, no (0, h)
  // forma nueva re-parsea al mismo human…
  const p2 = parseSeq(out)!;
  assert.ok(Math.abs((p2.lanes[0].human ?? 0) - 0.5) < 0.01);
  // …y la forma LEGADA (0, h) también se entiende
  const leg = parseSeq('stack(s("hh*8").late(rand.range(0,0.01)).velocity(rand.range(0.85,1)))')!;
  assert.ok(Math.abs((leg.lanes[0].human ?? 0) - 0.5) < 0.01);
});

test('P1.2 nudge en forma melódica: la melodía también tiene pocket', () => {
  const p = parsed('note("c2 ~ eb2 ~").s("sine").lpf(600)');
  const lanes = p.lanes.map((l) => ({ ...l, nudge: [0, 0, -0.008, 0] }));
  const out = buildSeq(p, lanes, p.steps);
  assert.match(out, /^note\("c2 ~ eb2 ~"\)\.s\("sine"\)\.late\("0 0 -0\.008 0"\)\.lpf\(600\)$/);
  const p2 = parseSeq(out)!;
  assert.deepEqual(p2.lanes[0].nudge, [0, 0, -0.008, 0]);
});

test('P1.5 velocity continua: valores exactos en .gain("…") round-trip', () => {
  const p = parsed('stack(s("sh sh sh sh"))');
  const lanes = p.lanes.map((l) => ({ ...l, steps: [0.35, 0.62, 0.88, 1.2] })); // crescendo
  const out = buildSeq(p, lanes, p.steps);
  assert.match(out, /\.gain\("0\.35 0\.62 0\.88 1\.2"\)/);
  const p2 = parseSeq(out)!;
  assert.deepEqual(p2.lanes[0].steps, [0.35, 0.62, 0.88, 1.2]);
});

// --- P0.3 ampliado: gestión de secciones por empalme + alineación con la canción ----

import { setArmBars, duplicateArm, addSilentArm, removeArm, wrapAsArrange, alignArrangeToBars } from '../src/nodes/stepseqCode.ts';

const ARR = 'arrange([4, s("bd*4")], [8, silence], [12, s("hh*8").gain(0.3)])';

test('SECCIONES: setArmBars solo toca los dígitos del número (resto byte a byte)', () => {
  const arms = splitArrange(ARR)!;
  const out = setArmBars(ARR, arms[1], 16);
  assert.equal(out, 'arrange([4, s("bd*4")], [16, silence], [12, s("hh*8").gain(0.3)])');
  assert.match(setArmBars(ARR, arms[0], 0), /^arrange\(\[1, /); // clamp mínimo 1
});

test('SECCIONES: duplicateArm inserta la copia tras el original', () => {
  const arms = splitArrange(ARR)!;
  const out = duplicateArm(ARR, arms[0]);
  const a2 = splitArrange(out)!;
  assert.equal(a2.length, 4);
  assert.equal(a2[1].code, a2[0].code);
  assert.equal(a2[1].bars, 4);
  assert.equal(a2[3].code, 's("hh*8").gain(0.3)'); // el resto intacto
});

test('SECCIONES: addSilentArm añade al final y removeArm quita con su coma', () => {
  const arms = splitArrange(ARR)!;
  const added = addSilentArm(ARR, arms[2], 6);
  assert.match(added, /\[12, s\("hh\*8"\)\.gain\(0\.3\)\], \[6, silence\]\)$/);
  // quitar primero / del medio / último
  for (const idx of [0, 1, 2]) {
    const out = removeArm(ARR, arms, idx)!;
    const rest = splitArrange(out)!;
    assert.equal(rest.length, 2, `idx ${idx}: ${out}`);
    new Function(`const arrange=()=>0, s=()=>({gain:()=>0}), silence=0; return (${out})`); // sintaxis válida
  }
  assert.equal(removeArm('arrange([4, s("bd")])', splitArrange('arrange([4, s("bd")])')!, 0), null); // único brazo
});

test('SECCIONES: wrapAsArrange siembra cada sección con el patrón (suena igual)', () => {
  const out = wrapAsArrange('s("bd*4").bank("RolandTR808")', [4, 8]);
  assert.equal(out, 'arrange([4, s("bd*4").bank("RolandTR808")], [8, s("bd*4").bank("RolandTR808")])');
});

test('ALINEAR: plano → envuelto · igual nº → redimensiona · menos → completa con silencio · más → null', () => {
  // plano
  const wrapped = alignArrangeToBars('s("bd*4")', [4, 8, 4])!;
  assert.deepEqual(splitArrange(wrapped)!.map((a) => a.bars), [4, 8, 4]);
  // igual número de brazos
  const resized = alignArrangeToBars(ARR, [2, 4, 6])!;
  const ra = splitArrange(resized)!;
  assert.deepEqual(ra.map((a) => a.bars), [2, 4, 6]);
  assert.equal(ra[2].code, 's("hh*8").gain(0.3)'); // patrones intactos
  // menos brazos que la canción → silencios al final
  const grown = alignArrangeToBars('arrange([4, s("bd*4")])', [8, 4, 4])!;
  const ga = splitArrange(grown)!;
  assert.deepEqual(ga.map((a) => a.bars), [8, 4, 4]);
  assert.equal(ga[1].code, 'silence');
  assert.equal(ga[2].code, 'silence');
  // más brazos que la canción → no se toca
  assert.equal(alignArrangeToBars(ARR, [4]), null);
});

// --- P2.2: banco PROPIO por pista (mezclar máquinas en la misma rejilla) ------------

import { laneOwnBank, withLaneBank } from '../src/nodes/stepseqCode.ts';

test('P2.2 caja por pista: el override vive en el sfx y el resto hereda POR SEGMENTO', () => {
  const p = parsed('stack(s("bd ~ bd ~"), s("~ sd ~ sd")).bank("RolandTR808")');
  // la caja pasa a LinnDrum SOLO en la pista sd
  const lanes = p.lanes.map((l) => (l.sound === 'sd' ? withLaneBank(l, 'LinnDrum') : l));
  assert.equal(laneOwnBank(lanes.find((l) => l.sound === 'sd')!), 'LinnDrum');
  const out = buildSeq(p, lanes, p.steps);
  assert.match(out, /s\("bd ~ bd ~"\)\.bank\("RolandTR808"\)/); // bd hereda, por segmento
  assert.match(out, /s\("~ sd ~ sd"\)[^,]*\.bank\("LinnDrum"\)/); // sd con su caja
  assert.doesNotMatch(out, /\)\)\.bank\(/); // SIN banco global en la cola (pisaría el override)
  // round-trip estable y el override sobrevive
  const p2 = parseSeq(out)!;
  assert.equal(p2.complex, false);
  assert.equal(buildSeq(p2, p2.lanes, p2.steps), out);
  assert.equal(laneOwnBank(p2.lanes.find((l) => l.sound === 'sd')!), 'LinnDrum');
});

test('P2.2 quitar el override: la pista vuelve a heredar el banco de la rejilla', () => {
  const l = withLaneBank({ sound: 'sd', steps: [1], notes: [null], ratchet: [1], prob: [1], sfx: '.room(0.2).bank("LinnDrum")' }, '');
  assert.equal(laneOwnBank(l), '');
  assert.equal(l.sfx, '.room(0.2)'); // el resto del residuo queda intacto
});

// --- Barrido UX #1: la rejilla ya no se COLAPSA al vaciarse ------------------------
// Antes, con todas las pistas apagadas buildSeq emitía s("~") (UN paso): al vaciar una
// rejilla de 8 pasos para redibujarla, el contador saltaba 8→1 y se perdía la longitud.

test('#1 vaciar la rejilla conserva el nº de pasos (no colapsa a s("~"))', () => {
  const p = parsed('s("bd ~ ~ ~ ~ ~ ~ ~")');
  assert.equal(p.steps, 8);
  const emptied = p.lanes.map((l) => ({ ...l, steps: l.steps.map(() => 0) }));
  const out = buildSeq(p, emptied, p.steps);
  assert.doesNotMatch(out, /s\("~"\)/, `no debe colapsar a un solo paso: ${out}`);
  assert.equal(parseSeq(out)!.steps, 8, `debe conservar los 8 pasos: ${out}`);
});

test('#1 vaciar conserva también el banco elegido de la rejilla', () => {
  const p = parsed('s("bd ~ bd ~").bank("RolandTR808")');
  const emptied = p.lanes.map((l) => ({ ...l, steps: l.steps.map(() => 0) }));
  const out = buildSeq(p, emptied, p.steps);
  assert.match(out, /\.bank\("RolandTR808"\)/); // la «caja» no se pierde al vaciar
  assert.equal(parseSeq(out)!.steps, 4);
});

test('#1 «empezar rejilla de 8 pasos» siembra un golpe AUDIBLE (antes silenciaba)', () => {
  // Semilla del botón del patrón avanzado (StepSeq): un golpe en el paso 1 de 8. Antes
  // sembraba los 8 pasos a 0 → buildSeq devolvía s("~") = source MUDO y rejilla de 1 paso.
  const base = parseSeq('s("bd")')!;
  const seed = { sound: 'bd', steps: [NORMAL, 0, 0, 0, 0, 0, 0, 0], notes: Array(8).fill(null), ratchet: Array(8).fill(1), prob: Array(8).fill(1) };
  const out = buildSeq(base, [seed], 8);
  const rp = parseSeq(out)!;
  assert.equal(rp.steps, 8, `rejilla de 8 pasos: ${out}`);
  assert.equal(rp.lanes.length, 1);
  assert.equal(rp.lanes[0].sound, 'bd');
  assert.ok(rp.lanes[0].steps.some((v) => v > 0), 'debe sonar al menos un golpe');
});
