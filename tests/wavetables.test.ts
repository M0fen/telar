import test from 'node:test';
import assert from 'node:assert/strict';
import { morphSeries, morphSeriesByName, wavBuffer, MORPH_WAVETABLES, userWaveFrame, userFrames, userWaveSeries } from '../src/audio/wavetables.ts';

const LEN = 2048;
const FRAMES = 16;

// --- morphSeries: estructura de la serie de cuadros -----------------------------------
test('morphSeries: concatena FRAMES cuadros de 2048 (longitud exacta)', () => {
  const s = morphSeries((_t) => new Float32Array(LEN)); // generador trivial (cuadro vacío)
  assert.equal(s.length, FRAMES * LEN);
});

test('morphSeries: cada cuadro de una tabla real queda normalizado a [-1,1] (ninguno mudo)', () => {
  const s = morphSeriesByName('telar_reso')!; // saw + pico resonante: todos los cuadros con fundamental
  for (let f = 0; f < FRAMES; f++) {
    let max = 0;
    for (let i = 0; i < LEN; i++) max = Math.max(max, Math.abs(s[f * LEN + i]));
    assert.ok(max <= 1.0001 && max > 0.5, `cuadro ${f}: pico ${max} fuera de rango (o mudo)`);
  }
});

// --- La tabla real `telar_sweep`: cuadro 0 = seno puro, último = saw (morph real) -------
test('morphSeriesByName("telar_sweep"): cuadro 0 es un SENO puro', () => {
  const s = morphSeriesByName('telar_sweep');
  assert.ok(s, 'la tabla existe');
  // frame 0 (t=0) = additive([1,0,0…]) = sin(2π i/2048). Puntos clave del seno:
  assert.ok(Math.abs(s![0] - 0) < 1e-6, 'sin(0)=0');
  assert.ok(Math.abs(s![512] - 1) < 1e-3, 'sin(π/2)=1 (cuarto de ciclo)');
  assert.ok(Math.abs(s![1024] - 0) < 1e-3, 'sin(π)=0');
  assert.ok(Math.abs(s![1536] + 1) < 1e-3, 'sin(3π/2)=-1');
});

test('morphSeriesByName("telar_sweep"): el último cuadro DIFIERE del primero (hubo morph) y trae armónicos', () => {
  const s = morphSeriesByName('telar_sweep')!;
  const frame0 = s.subarray(0, LEN);
  const frameLast = s.subarray((FRAMES - 1) * LEN, FRAMES * LEN);
  // diferencia media significativa → el timbre se movió de seno a saw
  let diff = 0;
  for (let i = 0; i < LEN; i++) diff += Math.abs(frame0[i] - frameLast[i]);
  diff /= LEN;
  assert.ok(diff > 0.1, `morph insuficiente (diff media ${diff.toFixed(3)})`);
  // el saw tiene MÁS cruces por cero que el seno (más contenido armónico)
  const crossings = (fr: Float32Array) => { let c = 0; for (let i = 1; i < fr.length; i++) if ((fr[i - 1] < 0) !== (fr[i] < 0)) c++; return c; };
  assert.ok(crossings(frameLast) >= crossings(frame0), 'el último cuadro no es más rico que el primero');
});

test('morphSeriesByName: nombre desconocido → null', () => {
  assert.equal(morphSeriesByName('telar_nope'), null);
  assert.equal(morphSeriesByName('bd'), null);
});

test('MORPH_WAVETABLES: banco de fábrica ampliado (>= 8 tablas, incluye las nuevas)', () => {
  const names = MORPH_WAVETABLES.map((t) => t.name);
  for (const k of ['sweep', 'formant', 'pwm', 'square', 'drawbars', 'bell', 'reso', 'fold']) {
    assert.ok(names.includes(`telar_${k}`), `falta telar_${k}`);
  }
  assert.ok(MORPH_WAVETABLES.length >= 8, `se esperaban >=8 tablas, hay ${MORPH_WAVETABLES.length}`);
  // toda tabla listada debe generar una serie válida (no null) y del tamaño correcto
  for (const t of MORPH_WAVETABLES) assert.equal(morphSeriesByName(t.name)?.length, FRAMES * LEN, `tabla ${t.name} inválida`);
});

// --- wavBuffer: cabecera WAV PCM válida (lo que registerWaveTable va a decodificar) -----
test('wavBuffer: cabecera RIFF/WAVE/PCM correcta y tamaño de datos = n*2', () => {
  const n = FRAMES * LEN;
  const buf = wavBuffer(morphSeriesByName('telar_sweep')!);
  assert.equal(buf.byteLength, 44 + n * 2, 'tamaño total = 44 (cabecera) + n*2 (16-bit)');
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(12), 'fmt ');
  assert.equal(v.getUint16(20, true), 1, 'PCM');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(tag(36), 'data');
  assert.equal(v.getUint32(40, true), n * 2, 'bytes de datos');
});

// --- userWaveFrame: onda dibujada con nodos (editor) -----------------------------------
test('userWaveFrame: <2 puntos → seno (fallback), longitud LEN', () => {
  const s = userWaveFrame([]);
  assert.equal(s.length, LEN);
  assert.ok(Math.abs(s[512] - 1) < 1e-3, 'seno: pico en 1/4 de ciclo');
});

test('userWaveFrame: interpola (suave) y normaliza — forma correcta (+@.25, -@.75, 0@0)', () => {
  const s = userWaveFrame([{ x: 0, y: 0 }, { x: 0.25, y: 1 }, { x: 0.5, y: 0 }, { x: 0.75, y: -1 }]);
  assert.equal(s.length, LEN);
  let max = 0; for (let i = 0; i < LEN; i++) max = Math.max(max, Math.abs(s[i]));
  assert.ok(Math.abs(max - 1) < 1e-6, 'normalizado a pico 1');
  assert.ok(s[Math.round(0.25 * LEN)] > 0.7, 'fuerte positivo cerca de x=0.25');
  assert.ok(s[Math.round(0.75 * LEN)] < -0.7, 'fuerte negativo cerca de x=0.75');
  assert.ok(Math.abs(s[0]) < 0.2, 'cerca de 0 en x=0');
});

test('userWaveFrame: es PERIÓDICO (el fin conecta con el principio, sin salto)', () => {
  const s = userWaveFrame([{ x: 0.1, y: 0.5 }, { x: 0.6, y: -0.5 }]);
  assert.ok(Math.abs(s[LEN - 1] - s[0]) < 0.05, `salto de loop ${Math.abs(s[LEN - 1] - s[0]).toFixed(3)}`);
});

test('userFrames: normaliza formato viejo (plano = 1 cuadro) y nuevo (cuadros)', () => {
  assert.equal(userFrames([{ x: 0, y: 0 }, { x: 0.5, y: 1 }]).length, 1, 'array plano de puntos → 1 cuadro');
  assert.equal(userFrames([[{ x: 0, y: 0 }], [{ x: 0, y: 1 }]]).length, 2, 'array de cuadros → tal cual');
  assert.equal(userFrames([]).length, 0);
  assert.equal(userFrames(undefined).length, 0);
});

test('userWaveSeries: concatena N cuadros (N × LEN); el formato viejo cuenta como 1', () => {
  const s2 = userWaveSeries([[{ x: 0, y: 0 }, { x: 0.25, y: 1 }, { x: 0.75, y: -1 }], [{ x: 0, y: 1 }, { x: 0.5, y: -1 }]]);
  assert.equal(s2.length, 2 * LEN);
  const s1 = userWaveSeries([{ x: 0, y: 0 }, { x: 0.5, y: 1 }]); // plano → 1 cuadro
  assert.equal(s1.length, LEN);
});
