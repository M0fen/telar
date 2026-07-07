import test from 'node:test';
import assert from 'node:assert/strict';
import { tempoCpsFromCode, isTelarPattern, sampleSilenceRisk, sanitizeAiGraph } from '../src/lib/aiGraph.ts';

// --- helpers puros -------------------------------------------------------------------
test('tempoCpsFromCode: traduce setcpm/setcps/setbpm y solo eso', () => {
  assert.ok(Math.abs(tempoCpsFromCode('setcpm(72)')! - 1.2) < 1e-9);   // 72 ciclos/min → 1.2 cps
  assert.equal(tempoCpsFromCode('setcps(0.6)'), 0.6);                   // directo
  assert.ok(Math.abs(tempoCpsFromCode('setbpm(144)')! - 0.6) < 1e-9);  // 144/240
  assert.equal(tempoCpsFromCode('s("bd*4")'), null);                   // un patrón no es tempo
  assert.equal(tempoCpsFromCode('setcpm(-4)'), null);                  // valor inválido
});

test('isTelarPattern: solo s/sound/note/n/arrange son patrones; globals no', () => {
  for (const ok of ['s("bd*4")', 'sound("hh")', 'note("c3").s("sine")', 'n("0 2 4").scale("c:minor")', 'arrange([4, s("bd")])']) assert.ok(isTelarPattern(ok), ok);
  for (const bad of ['setcpm(72)', 'setcps(0.6)', 'stack(s("bd"), s("hh"))', 'samples("x")', 'silence', 'foo()']) assert.ok(!isTelarPattern(bad), bad);
});

test('sampleSilenceRisk: avisa de samples dudosos, no de perc/ondas/bank', () => {
  assert.equal(sampleSilenceRisk('s("darkatmos").room(0.5)'), 'darkatmos'); // nombre raro sin bank
  assert.equal(sampleSilenceRisk('s("bd ~ sd ~ hh*2")'), null);             // percusión estándar
  assert.equal(sampleSilenceRisk('s("conga").bank("RolandTR808")'), null);  // con banco → asumido válido
  assert.equal(sampleSilenceRisk('note("c3").s("sawtooth")'), null);        // síntesis, no sample
  assert.equal(sampleSilenceRisk('s("white").lpf(800)'), null);             // ruido conocido
});

// --- ACEPTACIÓN: el grafo con todas las patologías juntas suena igual -----------------
test('sanitizeAiGraph: traduce tempo, descarta no-patrones, avisa sample, deja sonar el resto', () => {
  const graph = {
    cps: 0, // inválido a propósito → debe usar el tempo del nodo setcpm
    nodes: [
      { id: 't', type: 'source', data: { kind: 'source', name: 'tempo', code: 'setcpm(72)' } },
      { id: 'combo', type: 'source', data: { kind: 'source', name: 'combo', code: 'stack(s("bd"), s("hh"))' } },
      { id: 'atmos', type: 'source', data: { kind: 'source', name: 'atmos', code: 's("darkpad").room(0.6)' } },
      { id: 'k', type: 'source', data: { kind: 'source', name: 'kick', code: 's("bd ~ ~ bd ~ ~ ~ ~").bank("RolandTR808").shape(0.4)' } },
      { id: 'b', type: 'source', data: { kind: 'source', name: '808', code: 'note("f#1 ~ ~ f#1").s("sine").penv(7).pdecay(0.15).lpf(300)' } },
      { id: 'h', type: 'source', data: { kind: 'source', name: 'hats', code: 's("hh*8").gain(0.4)' } },
      { id: 'c', type: 'source', data: { kind: 'source', name: 'caja', code: 's("~ ~ sd ~").bank("RolandTR808")' } },
      { id: 'out_1', type: 'out', data: { kind: 'out' } },
    ],
    edges: [],
  };
  const { snap, warnings } = sanitizeAiGraph(graph);
  const srcNames = (snap.nodes ?? []).filter((n) => n.data.kind === 'source').map((n) => n.data.name);

  assert.ok(Math.abs((snap.cps as number) - 1.2) < 1e-9, `cps=${snap.cps}`);   // 72cpm traducido
  assert.ok(!srcNames.includes('tempo'), 'el nodo de tempo NO queda como nodo');
  assert.ok(!srcNames.includes('combo'), 'el nodo con stack() se descarta');
  for (const n of ['kick', '808', 'hats', 'caja']) assert.ok(srcNames.includes(n), `falta ${n}`);
  assert.ok(srcNames.includes('atmos'), 'el sample dudoso se conserva (no se descarta, podría existir)');
  assert.ok(warnings.some((w) => w.includes('tempo')), 'avisa del tempo movido');
  assert.ok(warnings.some((w) => /no es un patrón|stack/.test(w)), 'avisa del stack descartado');
  assert.ok(warnings.some((w) => w.includes('darkpad')), 'avisa del sample dudoso');
  // los 4 válidos + el atmos conservado = 5 sources audibles (el resto quedó fuera)
  assert.equal(srcNames.length, 5);
});

test('sanitizeAiGraph: si no queda ningún instrumento, lanza error para reintentar (no grafo mudo)', () => {
  assert.throws(
    () => sanitizeAiGraph({ nodes: [
      { id: 't', type: 'source', data: { kind: 'source', code: 'setcpm(72)' } },
      { id: 'x', type: 'source', data: { kind: 'source', code: 'stack(s("bd"))' } },
      { id: 'o', type: 'out', data: { kind: 'out' } },
    ], edges: [] }),
    /no produjo audio|reintenta/,
  );
});

// --- ACEPTACIÓN: un máster alucinado por NodIa (fuera de rango) NUNCA deja la salida muda ---
test('sanitizeAiGraph: sanea el máster fuera de rango (filter:-3 → 0 neutro) y lo reporta en la revisión', () => {
  const { snap, warnings } = sanitizeAiGraph({
    nodes: [
      { id: 'k', type: 'source', data: { kind: 'source', name: 'kick', code: 's("bd*4").bank("RolandTR909")' } },
      { id: 'o', type: 'out', data: { kind: 'out' } },
    ],
    edges: [],
    master: { gain: 1, filter: -3, crush: 5, room: 0.2 }, // filter/crush fuera de rango, room OK
  });
  const master = snap.master as Record<string, number>;
  assert.equal(master.filter, 0, 'filter -3 (rango -1..1) → 0 = sin filtro, SUENA');
  assert.equal(master.crush, 0, 'crush 5 (rango 0..1) → 0 = sin crush');
  assert.equal(master.room, 0.2, 'room en rango → intacto');
  assert.ok(warnings.some((w) => /máster:.*filtro.*-3.*0.*neutro/.test(w)), `la revisión lista el filtro reseteado: ${JSON.stringify(warnings)}`);
});

test('sanitizeAiGraph: un máster en rango NO añade avisos (no-op)', () => {
  const { warnings } = sanitizeAiGraph({
    nodes: [{ id: 'k', type: 'source', data: { kind: 'source', code: 's("bd*4")' } }, { id: 'o', type: 'out', data: { kind: 'out' } }],
    edges: [],
    master: { gain: 1, filter: -0.3, room: 0.2, crush: 0.4 },
  });
  assert.ok(!warnings.some((w) => w.startsWith('máster:')), 'sin avisos de máster para valores en rango');
});
