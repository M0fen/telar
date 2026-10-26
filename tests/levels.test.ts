import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakRmsDb, dbToMeter, PeakWindow, fallDb, fmtDb, headroomFactor, headroomState, scaleGains, scaleStateGains, METER_FLOOR } from '../src/lib/levels';

const near = (a: number, b: number, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('pico y RMS de un seno en dBFS', () => {
  const sr = 48000;
  const x = new Float32Array(sr);
  for (let i = 0; i < sr; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  const { peak, rms } = peakRmsDb(x);
  near(peak, -6.02);
  near(rms, -9.03);
  // más de 0 dBFS (coma flotante: la suma puede pasarse)
  const hot = peakRmsDb(Float32Array.from([0, 1.4, -0.2]));
  near(hot.peak, 2.92);
  // silencio
  const z = peakRmsDb(new Float32Array(64));
  assert.equal(z.peak, -Infinity);
  assert.equal(z.rms, -Infinity);
});

test('escala del medidor: −60…+6 dB → 0…1', () => {
  assert.equal(dbToMeter(-Infinity), 0);
  assert.equal(dbToMeter(-80), 0);
  assert.equal(dbToMeter(6), 1);
  assert.equal(dbToMeter(12), 1);
  near(dbToMeter(0), 60 / 66, 1e-9);
});

test('pico retenido: máximo de la ventana; entre golpes no cae a la cola', () => {
  const w = new PeakWindow(1500);
  // un bombo cada 500 ms (−3 dBFS) y su cola (−30) entre medias, leído a 30 por segundo
  let shown = -Infinity;
  let lastKick = 0;
  const seen: number[] = [];
  for (let t = 0; t <= 6000; t += 33) {
    const kick = t % 500 < 40;
    if (kick) lastKick = t;
    shown = w.push(kick ? -3 : -30, t);
    if (t > 100) seen.push(shown);
  }
  assert.ok(seen.every((v) => v === -3), 'el número se queda quieto en el pico');
  // se calla: el pico sigue mientras el último golpe esté en la ventana, luego baja
  let t = 6033;
  for (; t - lastKick <= 1500; t += 33) assert.equal(w.push(-Infinity, t), -3);
  for (; t <= 8000; t += 33) shown = w.push(-Infinity, t);
  assert.equal(shown, -Infinity);
  // uno más alto manda al instante
  assert.equal(w.push(2, 8100), 2);
  w.reset();
  assert.equal(w.push(-40, 9000), -40);
});

test('balística del RMS: sube al instante, baja 20 dB/s', () => {
  assert.equal(fallDb(-20, -6, 0.033), -6);
  near(fallDb(-6, -40, 0.1), -8);
  assert.equal(fallDb(-6, -7, 0.5), -7); // no baja de lo que mide
  assert.equal(fallDb(-59, -Infinity, 0.1), -Infinity); // bajo el piso = silencio
  assert.equal(fallDb(-Infinity, -30, 0.1), -30);
});

test('dBFS para leer', () => {
  assert.equal(fmtDb(-3.24), '−3.2');
  assert.equal(fmtDb(1.36), '+1.4');
  assert.equal(fmtDb(0.02), '0.0');
  assert.equal(fmtDb(-Infinity), '−∞');
  assert.equal(fmtDb(METER_FLOOR), '−∞');
});

test('dejar margen: solo baja, hasta −6 dBFS de pico', () => {
  near(20 * Math.log10(headroomFactor(3)), -9, 1e-9);
  near(20 * Math.log10(headroomFactor(-2)), -4, 1e-9);
  assert.equal(headroomFactor(-6.3), 1); // ya está (±0,5 dB)
  assert.equal(headroomFactor(-5.6), 1);
  assert.equal(headroomFactor(-20), 1); // con margen: no sube
  assert.equal(headroomFactor(-Infinity), 1);
  near(20 * Math.log10(headroomFactor(40)), -24, 1e-9); // tope de una vez
});

test('estado de la suma antes del máster', () => {
  assert.equal(headroomState(-Infinity), 'none');
  assert.equal(headroomState(-12), 'ok');
  assert.equal(headroomState(-5.8), 'ok');
  assert.equal(headroomState(-3), 'justo');
  assert.equal(headroomState(0), 'justo');
  assert.equal(headroomState(0.4), 'over');
});

test('escalar las ganancias conserva el balance', () => {
  const k = headroomFactor(3); // −9 dB
  const { gains, capped } = scaleGains([1, 0.5, 1.5], k);
  assert.equal(capped, false);
  near(gains[0] / gains[1], 2, 0.01);
  near(gains[2], 1.5 * k, 0.001);
  assert.deepEqual(scaleGains([1.2], 2), { gains: [1.5], capped: true });
  assert.deepEqual(scaleGains([NaN], 0.5).gains, [0.5]); // sin gain = 1
});

test('escalar el gain de las escenas: solo pistas y solo si lo guardaron', () => {
  const st = { a: { gain: 1, mute: false }, b: { mute: true }, fx: { gain: 0.8 } };
  const out = scaleStateGains(st, new Set(['a', 'b']), 0.5);
  assert.deepEqual(out.a, { gain: 0.5, mute: false });
  assert.equal(out.b, st.b);
  assert.equal(out.fx, st.fx); // no es pista
});
