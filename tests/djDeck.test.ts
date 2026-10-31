// Decks de tema (DJ-1): rejilla, sync, posición con loop, cues, Camelot y ganancia automática.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatAt, posOfBeat, snapPos, syncRate, posAt, lockedPos, phaseError, lockFor, nearestLock, loopFrom, jumpBeats,
  bandPeaks, camelot, camelotCompatible, autoGainDb, fmtTime, barLen, type Grid,
} from '../src/lib/djDeck.ts';

const g: Grid = { bpm: 128, first: 0.5, beats: 4 };
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);

test('rejilla: segundos ↔ tiempos y cuantizar', () => {
  near(beatAt(g, 0.5), 0);
  near(beatAt(g, 0.5 + 60 / 128 * 8), 8);
  near(posOfBeat(g, 4), 0.5 + 4 * 60 / 128);
  near(snapPos(g, 0.5 + 60 / 128 * 2.4), 0.5 + 60 / 128 * 2); // al tiempo
  near(snapPos(g, 0.5 + 60 / 128 * 1.4, 'bar'), 0.5); // al compás más cercano
  near(snapPos(g, 0.5 + 60 / 128 * 2.4, 'bar'), 0.5 + 4 * 60 / 128);
  near(barLen(g), 4 * 60 / 128);
});

test('sync: el tema va a tempo de la sesión, con su fase fija', () => {
  near(syncRate(130, g), 130 / 128);
  near(syncRate(130, g, 0.02), (130 / 128) * 1.02);
  // entra en el 1 de la sesión (tiempo 64) desde su tiempo 32 → lock = −32
  const lock = lockFor(32, 64);
  assert.equal(lock, -32);
  near(lockedPos(g, 72, lock), posOfBeat(g, 40)); // 8 tiempos después, 8 tiempos más adentro
  near(phaseError(40.1, 72, lock), 0.1);
  near(phaseError(39.95, 72, lock), -0.05);
  assert.equal(nearestLock(40.3, 72), -32); // sincronizar uno que ya suena: corrige menos de medio tiempo
  assert.equal(nearestLock(40.6, 72), -31);
});

test('posición analítica: avanza a su velocidad, da la vuelta en el loop y se para al final', () => {
  const m = { t0: 10, pos0: 20, rate: 1.0156, loop: null };
  near(posAt(m, 12, 300), 20 + 2 * 1.0156);
  near(posAt(m, 9, 300), 20); // antes de arrancar
  near(posAt({ ...m, pos0: 299 }, 20, 300), 300); // fin del tema
  const L = loopFrom(g, 20.2, 1); // 1 compás desde el tiempo donde está
  assert.ok(L.a <= 20.2 && L.b > 20.2);
  near(L.b - L.a, barLen(g));
  const ml = { t0: 0, pos0: L.a, rate: 1, loop: L };
  near(posAt(ml, barLen(g) * 2.5, 300), L.a + barLen(g) * 0.5); // dos vueltas y media
  assert.equal(jumpBeats(g, 4), 16);
});

test('forma de onda por bandas: un bombo grave pesa en graves, un hat en agudos', () => {
  const sr = 44100, n = sr;
  const kick = new Float32Array(n), hat = new Float32Array(n);
  for (let i = 0; i < n; i++) { kick[i] = Math.sin((2 * Math.PI * 55 * i) / sr); hat[i] = Math.sin((2 * Math.PI * 3500 * i) / sr) * 0.5; }
  const k = bandPeaks(kick, sr, 4), h = bandPeaks(hat, sr, 4);
  assert.ok(k.lo[2] > k.hi[2] * 5, 'el bombo es grave');
  assert.ok(h.hi[2] > h.lo[2] * 5, 'el hat es agudo');
  assert.ok(k.pk[2] > 0.95 && h.pk[2] > 0.45);
});

test('Camelot: claves y compatibles', () => {
  assert.equal(camelot({ root: 9, minor: true }), '8A'); // La menor
  assert.equal(camelot({ root: 0, minor: false }), '8B'); // Do mayor
  assert.equal(camelot({ root: 8, minor: true }), '1A'); // Lab menor
  assert.equal(camelot({ root: 11, minor: false }), '1B'); // Si mayor
  assert.equal(camelot({ root: 4, minor: true }), '9A'); // Mi menor
  assert.ok(camelotCompatible('8A', '9A') && camelotCompatible('8A', '7A') && camelotCompatible('8A', '8B'));
  assert.ok(camelotCompatible('12A', '1A'));
  assert.ok(!camelotCompatible('8A', '10A') && !camelotCompatible('8A', '9B'));
});

test('ganancia automática y tiempo', () => {
  assert.equal(autoGainDb(-9), -5);
  assert.equal(autoGainDb(-30), 6); // tope
  assert.equal(autoGainDb(null), 0);
  assert.equal(fmtTime(125.7), '2:05');
});

test('rejilla afinada sobre todo el tema: tempo con decimales y la fase de los golpes', async () => {
  const { onsetEnvelope, refineGrid } = await import('../src/lib/djDeck.ts');
  const sr = 11025, bpm = 127.62, first = 0.31, secs = 180;
  const x = new Float32Array(sr * secs);
  const beat = 60 / bpm;
  for (let t = first; t < secs - 0.3; t += beat) {
    const s0 = Math.round(t * sr);
    for (let i = 0; i < sr * 0.15; i++) x[s0 + i] += Math.sin((2 * Math.PI * 55 * i) / sr) * Math.exp(-i / (sr * 0.04));
  }
  const hop = Math.round(sr / 200);
  const env = onsetEnvelope(x, sr, hop);
  const r = refineGrid(env, sr / hop, 128); // el estimado llega redondeado
  assert.ok(Math.abs(r.bpm - bpm) < 0.02, `tempo ${r.bpm}`);
  // la fase cae en un golpe (módulo el tiempo), a pocos ms
  const d = ((r.first - first) % beat + beat) % beat;
  assert.ok(Math.min(d, beat - d) < 0.012, `fase corrida ${(Math.min(d, beat - d) * 1000).toFixed(1)} ms`);
  // y a los 3 minutos sigue en su sitio
  const last = Math.floor((secs - 1 - first) / beat);
  assert.ok(Math.abs((r.first + last * (60 / r.bpm)) - (first + last * beat)) < 0.02);
});

test('el primer 1 cae en el primer golpe, no en un tiempo fantasma antes del tema', async () => {
  const { onsetEnvelope, refineGrid, firstStrongBeat } = await import('../src/lib/djDeck.ts');
  const sr = 11025, bpm = 131.5, first = 0.6, secs = 60;
  const x = new Float32Array(sr * secs);
  for (let t = first; t < secs - 0.3; t += 60 / bpm) {
    const s0 = Math.round(t * sr);
    for (let i = 0; i < sr * 0.15; i++) x[s0 + i] += Math.sin((2 * Math.PI * 55 * i) / sr) * Math.exp(-i / (sr * 0.04));
  }
  const hop = Math.round(sr / 200);
  const env = onsetEnvelope(x, sr, hop);
  const r = refineGrid(env, sr / hop, 131);
  assert.ok(r.first < 60 / bpm, 'la fase sola queda antes del tema');
  const f = firstStrongBeat(env, sr / hop, r.bpm, r.first);
  assert.ok(Math.abs(f - first) < 0.015, `primer 1 en ${f.toFixed(3)} (real ${first})`);
});
