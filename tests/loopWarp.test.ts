// Fase 5.2 · loops al BPM del tema sin cambiar el tono (lógica pura).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loopGrid,
  warpCode,
  warpCycles,
  stretchRatio,
  targetFrames,
  warpKey,
  warpName,
  warpNameIn,
  circularPad,
  extractLoop,
  songBpmOf,
  replaceWarpInCode,
  warpClean,
  tailFrames,
  fadeTail,
  XFADE_S,
  varispeedLoop,
  beatKeyFrames,
  seamLoop,
  keySemis,
  effectiveSemis,
  isVoiceName,
  warpLabel,
  type WarpInfo,
} from '../src/lib/loopWarp.ts';
import { strudelCore } from './helpers/strudelNode.ts';

test('5.2 tempo y largo del loop: manda el BPM del nombre; sin él, duración + detección (×2/÷2)', () => {
  // 4 compases a 126 = 7,619 s
  assert.deepEqual(loopGrid(16 * 60 / 126, { hintBpm: 126 }), { bpm: 126, beats: 16 });
  // un loop de Splice con unas muestras de más/menos sigue siendo de 16 tiempos
  assert.deepEqual(loopGrid(7.63, { hintBpm: 126 }), { bpm: 126, beats: 16 });
  // sin nombre: la detección dice 63 (media) o 252 (doble) → 126 por la duración
  assert.deepEqual(loopGrid(16 * 60 / 126, { detectedBpm: 63 }), { bpm: 126, beats: 16 });
  assert.deepEqual(loopGrid(16 * 60 / 126, { detectedBpm: 125 }), { bpm: 126, beats: 16 });
  // la detección no encaja con ningún largo de compases enteros → no es un loop limpio
  assert.equal(loopGrid(5.37, { detectedBpm: 112 }), null);
  // sin nombre ni detección: nada
  assert.equal(loopGrid(7.6, {}), null);
  assert.equal(loopGrid(0.1, { hintBpm: 126 }), null);
});

test('5.2 código del loop: se re-dispara en la rejilla a velocidad 1 (la copia ya va al tempo → sin tono corrido)', async () => {
  assert.equal(warpCycles(16, 4), 4);
  assert.equal(warpCycles(16, 8), 2);
  const code = warpCode('wl_top_ab12', 4);
  assert.equal(code, 's("wl_top_ab12").slow(4)');
  const core = (await strudelCore()) as Record<string, (...a: unknown[]) => unknown>;
  const pat = (core.s('wl_top_ab12') as { slow: (n: number) => { queryArc: (a: number, b: number, o: object) => { value: Record<string, number | string>; hasOnset: () => boolean; whole: { begin: { valueOf(): number } } }[] } }).slow(4);
  const cps = 132 / 240;
  const haps = pat.queryArc(0, 12, { _cps: cps }).filter((h) => h.hasOnset());
  assert.deepEqual(haps.map((h) => h.whole.begin.valueOf()), [0, 4, 8]); // cada 4 compases, siempre en la rejilla
  assert.equal(haps[0].value.speed, undefined); // velocidad 1: sin varispeed
  assert.equal(haps[0].value.unit, undefined);
  // la copia de 126 → 132 dura 126/132 del original y su vuelta, justo 4 compases a 132
  assert.ok(Math.abs(stretchRatio(126, 132) - 126 / 132) < 1e-12);
  assert.equal(targetFrames(16, 132, 48000), Math.round(16 * 60 / 132 * 48000));
  assert.equal(songBpmOf(0.55, 4), 132);
});

test('5.2 unión sin hueco: la cola de la voz vieja es el espejo del ataque de 1 ms de la nueva', () => {
  const sr = 44100;
  const L = 1000;
  const X = tailFrames(sr);
  assert.ok(X >= Math.ceil(XFADE_S * sr));
  const c = new Float32Array(L + X).fill(1);
  fadeTail([c], L, sr);
  assert.equal(c[L - 1], 1); // la vuelta no se toca
  for (let i = 0; i < X; i++) {
    const attack = Math.min(1, i / (XFADE_S * sr)); // superdough: rampa lineal 0→1 en 1 ms
    assert.ok(Math.abs(c[L + i] + attack - 1) < 1e-6, `muestra ${i}: ${c[L + i]} + ${attack}`);
  }
});

test('5.2 copia rápida por varispeed: largo exacto y vuelta circular del original', () => {
  // rampa 0..7 (un loop de 8 muestras) a la mitad de duración → toma una de cada dos
  const x = Float32Array.from({ length: 8 }, (_, i) => i);
  const [h] = varispeedLoop([x], 8, 0.5, 6);
  assert.deepEqual([...h], [0, 2, 4, 6, 0, 2]); // la cola continúa desde el principio
  // al doble de duración, interpola
  const [d] = varispeedLoop([x], 8, 2, 4);
  assert.deepEqual([...d], [0, 0.5, 1, 1.5]);
  // el final interpola hacia el principio (no hacia lo que haya después en el archivo)
  const [e] = varispeedLoop([Float32Array.from([0, 2, 4, 6, 99])], 4, 2, 8);
  assert.deepEqual([...e], [0, 1, 2, 3, 4, 5, 6, 3]);
});

test('5.2 contexto circular y vuelta del medio: el loop vuelve entero y con largo exacto', () => {
  const x = new Float32Array([1, 2, 3, 4, 5, 6]);
  const [p] = circularPad([x], 2);
  assert.deepEqual([...p], [5, 6, 1, 2, 3, 4, 5, 6, 1, 2]);
  const [m] = extractLoop([p], 2, 6);
  assert.deepEqual([...m], [1, 2, 3, 4, 5, 6]);
  // si falta audio al final, silencio (nunca un largo distinto)
  const [s] = extractLoop([p], 8, 4);
  assert.deepEqual([...s], [1, 2, 0, 0]);
  // un pad mayor que el loop se limita al loop
  const [q] = circularPad([new Float32Array([7, 8])], 9);
  assert.deepEqual([...q], [7, 8, 7, 8, 7, 8]);
});

test('5.2 claves de caché y nombres', () => {
  const w: WarpInfo = { name: 'wl_x_ab12', orig: 'abc', srcBpm: 126, beats: 16 };
  assert.equal(warpKey(w, 132), 'abc|126|132|0||a1');
  assert.equal(warpKey({ ...w, semis: -2, formant: true }, 131.999), 'abc|126|132|-2|f|a1');
  assert.notEqual(warpKey(w, 132), warpKey(w, 128));
  let i = 0;
  const seq = [0.1, 0.5, 0.9, 0.3];
  const n = warpName('Top Loop · Groovy!', () => seq[i++ % 4]);
  assert.match(n, /^wl_top_loop_groovy_[a-z2-9]{4}$/);
  assert.equal(warpNameIn('arrange([8, s("wl_top_ab12").slow(4)], [8, silence])'), 'wl_top_ab12');
  assert.equal(warpNameIn('s("bd*4")'), null);
});

test('5.2 corregir el loop en el código: nombre y largo en todos los brazos', () => {
  const code = 'arrange([8, s("wl_top_ab12").slow(2).gain(0.8)], [8, s("wl_top_ab12").slow(2).mask(0)])';
  assert.equal(
    replaceWarpInCode(code, 'wl_top_ab12', 'wl_top_k9x3', 4),
    'arrange([8, s("wl_top_k9x3").slow(4).gain(0.8)], [8, s("wl_top_k9x3").slow(4).mask(0)])',
  );
  assert.equal(replaceWarpInCode('s("wl_a_ab12").loopAt(2)', 'wl_a_ab12', 'wl_a_cd34', 4), 's("wl_a_cd34").slow(4)');
  assert.equal(replaceWarpInCode('s("wl_a_ab12")', 'wl_a_ab12', 'wl_a_cd34', 4), 's("wl_a_cd34")');
  assert.equal(warpClean('wl_top_loop_ab12'), 'top_loop');
  // rebanado (5.4): el largo se corrige detrás del .slice
  assert.equal(
    replaceWarpInCode('s("wl_a_ab12").slice([0, 0.25, 1], "1@2500 0@7500").slow(2)', 'wl_a_ab12', 'wl_a_cd34', 4),
    's("wl_a_cd34").slice([0, 0.25, 1], "1@2500 0@7500").slow(4)',
  );
});

test('5.2 cuadros clave por tiempo y vuelta periódica (unión continua)', () => {
  const k = beatKeyFrames(1000, 4, 120, 1000, 0.5); // 120 bpm a 1 kHz: un tiempo = 500 muestras
  assert.deepEqual(k, [[1000, 500], [1500, 750], [2000, 1000], [2500, 1250], [3000, 1500]]);
  // copia "estirada" de un seno cuya vuelta NO cierra en fase (tono sostenido tras el estirado)
  const sr = 1000;
  const y = Float32Array.from({ length: 3000 }, (_, i) => Math.sin(2 * Math.PI * 7.3 * i / sr));
  const s = 1000;
  const L = 1000;
  const [o] = seamLoop([y], s, L, 4, 50);
  assert.equal(o.length, L + 4);
  // sin el fundido, el salto del final al principio sería grande; con él, la última muestra es la
  // anterior al principio en la copia → la unión es tan suave como el propio seno
  const step = Math.abs(o[0] - o[L - 1]);
  const typical = 2 * Math.PI * 7.3 / sr;
  assert.ok(step <= typical * 1.05, `salto ${step} vs ${typical}`);
  assert.ok(Math.abs(y[s + L - 1] - y[s]) > 10 * typical); // el problema existía
  // la cola es el principio otra vez
  assert.deepEqual([...o.subarray(L)], [...o.subarray(0, 4)]);
  // el principio no se toca
  assert.equal(o[0], y[s]);
});

test('5.3 a la tonalidad del tema: camino más corto, relativas, tono y octava', () => {
  const am = { root: 9, minor: true };
  // loop en F menor → tema en A menor: +4 (no −8)
  assert.equal(keySemis({ root: 5, minor: true }, am), 4);
  // loop en D menor → A menor: −5 (no +7)
  assert.equal(keySemis({ root: 2, minor: true }, am), -5);
  // el tono del tema (+2) también cuenta: suena en B menor
  assert.equal(keySemis({ root: 9, minor: true }, am, 2), 2);
  // modos distintos → a la relativa: un loop en C mayor en un tema en A menor no se mueve
  assert.equal(keySemis({ root: 0, minor: false }, am), 0);
  assert.equal(keySemis({ root: 9, minor: true }, { root: 0, minor: false }), 0);
  // sin modo en el nombre: solo la raíz
  assert.equal(keySemis({ root: 7, minor: null }, am), 2);
  const w: WarpInfo = { name: 'wl_x_ab12', orig: 'o', srcBpm: 126, beats: 16, key: { root: 5, minor: true } };
  assert.equal(effectiveSemis(w, am), 4);
  assert.equal(effectiveSemis({ ...w, oct: -1 }, am), -8);
  assert.equal(effectiveSemis({ ...w, follow: false }, am), 0); // fijo
  assert.equal(effectiveSemis({ ...w, follow: false, oct: 1 }, am), 12);
  assert.equal(effectiveSemis(w, null), 0); // tema sin tonalidad
  assert.equal(effectiveSemis({ ...w, key: undefined }, am), 0); // sin tonalidad propia (batería)
  assert.equal(isVoiceName('PL_126_Amin_vocal_chop.wav'), true);
  assert.equal(isVoiceName('VOX_phrase_Gmin.wav'), true);
  assert.equal(isVoiceName('PL_126_Amin_top_loop.wav'), false);
  assert.equal(warpLabel(w, 132, 4), '126→132 bpm · 4 comp. · Fm→Am (+4)');
  assert.equal(warpLabel({ ...w, shot: true, srcBpm: 0, beats: 0 }, 132, -3), 'Fm→Dm (-3)');
  assert.equal(warpLabel({ ...w, key: undefined }, 126, 0), '126 bpm · 4 comp.');
  assert.equal(warpLabel({ ...w, shot: true, srcBpm: 0, beats: 0 }, 132, -12), 'Fm -1 8va');
  assert.equal(warpLabel({ ...w, key: undefined, shot: true }, 132, 12), '+1 8va');
});
