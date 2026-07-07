import test from 'node:test';
import assert from 'node:assert/strict';
import { morphSeries, morphSeriesByName, wavBuffer, MORPH_WAVETABLES } from '../src/audio/wavetables.ts';

const LEN = 2048;
const FRAMES = 16;

// --- morphSeries: estructura de la serie de cuadros -----------------------------------
test('morphSeries: concatena FRAMES cuadros de 2048 (longitud exacta)', () => {
  const s = morphSeries((_t) => [1]); // perfil trivial (solo fundamental)
  assert.equal(s.length, FRAMES * LEN);
});

test('morphSeries: cada cuadro queda normalizado a [-1,1]', () => {
  const s = morphSeries((t) => [1, t, t * 0.5, t * 0.3]); // morph con armónicos crecientes
  for (let f = 0; f < FRAMES; f++) {
    let max = 0;
    for (let i = 0; i < LEN; i++) max = Math.max(max, Math.abs(s[f * LEN + i]));
    assert.ok(max <= 1.0001 && max > 0.5, `cuadro ${f}: pico ${max} fuera de rango`);
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

test('MORPH_WAVETABLES: expone al menos sweep y formant', () => {
  const names = MORPH_WAVETABLES.map((t) => t.name);
  assert.ok(names.includes('telar_sweep'), 'falta telar_sweep');
  assert.ok(names.includes('telar_formant'), 'falta telar_formant');
});

// --- wavBuffer: cabecera WAV PCM válida (lo que registerWaveTable va a decodificar) -----
test('wavBuffer: cabecera RIFF/WAVE/PCM correcta y tamaño de datos = n*2', () => {
  const n = FRAMES * LEN;
  const buf = wavBuffer(morphSeries((t) => [1, t]));
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
