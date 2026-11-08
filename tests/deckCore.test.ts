import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_CORE_SRC } from '../src/audio/deckCore';

// el mismo texto que corre en el worklet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DeckCore = new Function(`${DECK_CORE_SRC}; return DeckCore;`)() as any;
const SR = 48000;

const sine = (hz: number, sec: number) => {
  const a = new Int16Array(Math.round(sec * SR));
  for (let i = 0; i < a.length; i++) a[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / SR) * 8000);
  return a;
};
const noise = (sec: number) => {
  let x = 12345;
  const a = new Int16Array(Math.round(sec * SR));
  for (let i = 0; i < a.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; a[i] = (x % 16000) - 8000; }
  return a;
};
// renderiza `sec` segundos en bloques de 128 desde el segundo t0
function play(core: { render: (o: Float32Array[], n: number, t: number) => boolean }, t0: number, sec: number) {
  const n = Math.round(sec * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  let ok = true;
  for (let k = 0; k < n; k += 128) {
    const m = Math.min(128, n - k);
    const o = [new Float32Array(m), new Float32Array(m)];
    ok = core.render(o, m, t0 + k / SR) && ok;
    L.set(o[0], k); R.set(o[1], k);
  }
  return { L, R, ok };
}
const crossings = (x: Float32Array) => { let c = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) c++; return c; };

test('a velocidad 1 es transparente: sale el tema tal cual', () => {
  const src = noise(2);
  const core = new DeckCore([src, src], 1 / 16384, SR);
  core.setModel(1, { t0: 1, pos0: 0.25, rate: 1, loop: null });
  const { L } = play(core, 1, 1);
  let maxErr = 0;
  for (let i = 0; i < L.length; i++) maxErr = Math.max(maxErr, Math.abs(L[i] - src[Math.round(0.25 * SR) + i] / 16384));
  assert.ok(maxErr < 1e-6, `error máximo ${maxErr}`);
});

test('más rápido sin cambiar el tono: 440 Hz siguen siendo 440 Hz a 1,05×', () => {
  const src = sine(440, 4);
  const core = new DeckCore([src], 1 / 16384, SR);
  core.setModel(0, { t0: 0, pos0: 0, rate: 1.05, loop: null });
  const { L } = play(core, 0, 2);
  const hz = crossings(L.subarray(SR / 2)) / 2 / 1.5;
  assert.ok(Math.abs(hz - 440) < 4, `tono ${hz.toFixed(1)} Hz`);
});

test('la posición sigue al modelo (sin acumular desvío) a 0,94× y 1,06×', () => {
  for (const rate of [0.94, 1.06]) {
    const src = noise(8);
    const core = new DeckCore([src, src], 1 / 16384, SR);
    core.setModel(0, { t0: 0, pos0: 0.5, rate, loop: null });
    let worst = 0;
    for (let k = 0; k < 4 * SR; k += 128) {
      core.render([new Float32Array(128), new Float32Array(128)], 128, k / SR);
      const mid = core.segOut + core.H / 2;
      const want = (0.5 + (mid / SR) * rate) * SR;
      worst = Math.max(worst, Math.abs(core.segIn + core.H / 2 - want));
    }
    const bound = core.W + 2;
    assert.ok(worst <= bound, `velocidad ${rate}: desvío ${worst} muestras (tope ${bound})`);
  }
});

test('un cambio de velocidad agendado vale desde su hora', () => {
  const src = noise(8);
  const core = new DeckCore([src], 1 / 16384, SR);
  core.setModel(0, { t0: 0, pos0: 0, rate: 1, loop: null });
  core.setModel(1, { t0: 1, pos0: 1, rate: 1.1, loop: null });
  play(core, 0, 3);
  const mid = (core.segOut + core.H / 2) / SR;
  const want = (1 + (mid - 1) * 1.1) * SR;
  assert.ok(Math.abs(core.segIn + core.H / 2 - want) <= core.W + 2);
  assert.ok(core.models.length <= 2, 'los modelos viejos se olvidan');
});

test('en loop vuelve al inicio y no termina; sin loop, termina al final del tema', () => {
  const src = noise(1);
  const looped = new DeckCore([src], 1 / 16384, SR);
  looped.setModel(0, { t0: 0, pos0: 0.2, rate: 1, loop: { a: 0.2, b: 0.7 } });
  const a = play(looped, 0, 3);
  assert.equal(a.ok, true);
  assert.ok(a.L.subarray(2 * SR).some((v) => Math.abs(v) > 0.01), 'sigue sonando dentro del loop');
  const plain = new DeckCore([src], 1 / 16384, SR);
  plain.setModel(0, { t0: 0, pos0: 0.5, rate: 1, loop: null });
  const b = play(plain, 0, 1);
  assert.equal(b.ok, false);
});
