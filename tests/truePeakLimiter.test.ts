import test from 'node:test';
import assert from 'node:assert/strict';
import { TruePeakLimiter, blockTruePeakDb, polyphaseBanks, dbToLin } from '../src/audio/truePeakLimiter.ts';

const SR = 48000;
// genera un seno de amplitud `amp` a `hz` de `n` muestras (mono → [ch]).
function sine(hz: number, amp: number, n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return a;
}

test('polyphaseBanks: cada fase pasa DC a ganancia unidad (suma de taps ≈ 1)', () => {
  const banks = polyphaseBanks(4, 12);
  assert.equal(banks.length, 4);
  for (const b of banks) {
    const s = b.reduce((a, c) => a + c, 0);
    assert.ok(Math.abs(s - 1) < 1e-6, `suma de fase = ${s}`);
  }
});

test('techo GARANTIZADO: una señal a tope nunca sale por encima de −1 dBTP', () => {
  const lim = new TruePeakLimiter(SR, { ceilingDb: -1, lookaheadMs: 1.5, releaseMs: 60 });
  const ceil = dbToLin(-1);
  // seno fuerte (1.2 = clipeando) a una frecuencia con picos inter-muestra reales
  const inp = sine(7000, 1.2, 8192);
  const out = lim.process([inp]);
  // 1) ninguna MUESTRA supera el techo (clamp final)
  let maxSample = 0;
  for (const y of out[0]) maxSample = Math.max(maxSample, Math.abs(y));
  assert.ok(maxSample <= ceil + 1e-6, `pico de muestra ${maxSample} > techo ${ceil}`);
  // 2) el pico REAL (inter-muestra, oversample 4x) tampoco pasa del techo (con tolerancia del filtro)
  const tpDb = blockTruePeakDb(out, 4);
  assert.ok(tpDb <= -1 + 0.3, `true-peak de salida ${tpDb.toFixed(2)} dBTP > −1`);
});

test('picos inter-muestra: señal que aliasea alto se limita de verdad', () => {
  const lim = new TruePeakLimiter(SR, { ceilingDb: -1 });
  // patrón que reconstruye MUY por encima de sus muestras (energía cerca de Nyquist)
  const n = 8192;
  const inp = new Float32Array(n);
  for (let i = 0; i < n; i++) inp[i] = (i % 2 ? -0.9 : 0.9);
  const out = lim.process([inp]);
  const tpDb = blockTruePeakDb(out, 4);
  assert.ok(tpDb <= -1 + 0.3, `true-peak ${tpDb.toFixed(2)} dBTP > −1`);
});

test('transparencia: una señal por debajo del techo NO se atenúa', () => {
  const lim = new TruePeakLimiter(SR, { ceilingDb: -1 });
  const amp = 0.2; // −14 dB, muy por debajo del techo
  const inp = sine(1000, amp, 8192);
  const out = lim.process([inp]);
  let maxOut = 0;
  // ignora las primeras muestras (retardo de lookahead = ceros)
  for (let i = 200; i < out[0].length; i++) maxOut = Math.max(maxOut, Math.abs(out[0][i]));
  assert.ok(maxOut > amp * 0.98, `atenuó una señal que no debía: ${maxOut} vs ${amp}`);
  assert.ok(maxOut <= amp * 1.02, `amplificó de más: ${maxOut} vs ${amp}`);
});

test('estéreo linkado: L y R reciben la MISMA reducción (imagen intacta)', () => {
  const lim = new TruePeakLimiter(SR, { ceilingDb: -1 });
  const n = 4096;
  const L = sine(500, 1.3, n);        // canal fuerte (dispara la reducción)
  const R = sine(500, 0.3, n);        // canal suave
  const out = lim.process([L, R]);
  // la relación L/R de entrada (1.3/0.3) se preserva en la salida (misma ganancia a ambos)
  let mL = 0, mR = 0;
  for (let i = 300; i < n; i++) { mL = Math.max(mL, Math.abs(out[0][i])); mR = Math.max(mR, Math.abs(out[1][i])); }
  assert.ok(Math.abs(mL / mR - 1.3 / 0.3) < 0.15, `imagen alterada: ${(mL / mR).toFixed(2)} vs ${(1.3 / 0.3).toFixed(2)}`);
});

test('continuidad en streaming: procesar en 2 bloques = procesar de una', () => {
  const inp = sine(3000, 1.1, 4096);
  const whole = new TruePeakLimiter(SR, { ceilingDb: -1 }).process([inp.slice()])[0];
  const split = new TruePeakLimiter(SR, { ceilingDb: -1 });
  const a = split.process([inp.slice(0, 2048)])[0];
  const b = split.process([inp.slice(2048)])[0];
  for (let i = 0; i < 4096; i++) {
    const v = i < 2048 ? a[i] : b[i - 2048];
    assert.ok(Math.abs(v - whole[i]) < 1e-6, `divergen en ${i}: ${v} vs ${whole[i]}`);
  }
});
