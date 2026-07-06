// G1 — tests de la categorización de samples (lógica pura). Fija el comportamiento y las
// colisiones de substring resueltas, para que ampliar los diccionarios no regrese sonidos
// a la sección equivocada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, instrToken } from '../src/lib/sampleCategory';

test('batería por abreviatura exacta (dough-samples)', () => {
  assert.equal(categorize('bd'), 'kick');
  assert.equal(categorize('kick'), 'kick');
  assert.equal(categorize('sd'), 'snare');
  assert.equal(categorize('clap'), 'snare');
  assert.equal(categorize('hh'), 'hat');
  assert.equal(categorize('oh'), 'hat');
  assert.equal(categorize('crash'), 'cymbal');
  assert.equal(categorize('ride'), 'cymbal');
});

test('shaker es PERCUSIÓN (no hat) — enfoque latino', () => {
  assert.equal(categorize('shaker'), 'perc');
  assert.equal(categorize('sh'), 'perc');
});

test('percusión latina/mundo — exacta y compuesta', () => {
  assert.equal(categorize('conga'), 'perc');
  assert.equal(categorize('timbale'), 'perc');
  assert.equal(categorize('guiro'), 'perc');
  assert.equal(categorize('agogo'), 'perc');
  assert.equal(categorize('lat_conga'), 'perc'); // compuesto (substring)
  assert.equal(categorize('perc_guiro_02'), 'perc');
});

test('COLISIÓN airhorn → fx, NO inst (aunque contiene "horn")', () => {
  assert.equal(categorize('airhorn'), 'fx');
  assert.equal(categorize('air_horn_01'), 'fx');
  assert.equal(categorize('horn'), 'inst'); // el cuerno real sí es instrumento
});

test('COLISIÓN cowbell → perc, NO inst (aunque contiene "bell")', () => {
  assert.equal(categorize('cowbell'), 'perc');
  assert.equal(categorize('big_cowbell'), 'perc');
  assert.equal(categorize('bell'), 'inst'); // campana melódica sí es instrumento
});

test('tags de cultura/transición → fx', () => {
  assert.equal(categorize('siren'), 'fx');
  assert.equal(categorize('pullup'), 'fx');
  assert.equal(categorize('vinyl_scratch'), 'fx');
  assert.equal(categorize('downlifter'), 'fx');
});

test('bajos / 808 / sub', () => {
  assert.equal(categorize('bass'), 'bass');
  assert.equal(categorize('808'), 'bass');
  assert.equal(categorize('reese'), 'bass');
  assert.equal(categorize('jvbass'), 'bass');
  assert.equal(categorize('subbass'), 'bass');
});

test('instrumentos reales y sintes', () => {
  assert.equal(categorize('piano'), 'inst');
  assert.equal(categorize('cello'), 'inst');
  assert.equal(categorize('organ'), 'inst');
  assert.equal(categorize('rhodes'), 'inst');
  assert.equal(categorize('supersaw_lead'), 'synth');
  assert.equal(categorize('pad'), 'synth');
});

test('voces y loops', () => {
  assert.equal(categorize('vocal'), 'vocal');
  assert.equal(categorize('acapella'), 'vocal');
  assert.equal(categorize('amen'), 'loop');
  assert.equal(categorize('break'), 'loop');
});

test('desconocido → other', () => {
  assert.equal(categorize('zxqw'), 'other');
});

test('instrToken: último segmento sin dígitos finales', () => {
  assert.equal(instrToken('bd'), 'bd');
  assert.equal(instrToken('house_bass2'), 'bass'); // último segmento, dígitos quitados
  assert.equal(instrToken('latin_conga_01'), ''); // segmento numérico final → vacío (cae al substring)
});
