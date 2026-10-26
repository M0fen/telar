// Fase 5.1 · tonalidad del tema (lógica pura).
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyShort, keyLong, keyScale, cleanKey, parseKeyToken, keyFromFileName, suggestKey } from '../src/lib/songKey.ts';
import { exportFileName } from '../src/lib/audioFormats.ts';

test('5.1 nombres: corto, largo y escala de Strudel; el tono transpone lo que suena', () => {
  const am = { root: 9, minor: true };
  assert.equal(keyShort(am), 'Am');
  assert.equal(keyShort(am, 2), 'Bm');
  assert.equal(keyShort(am, -10), 'Bm');
  assert.equal(keyLong({ root: 6, minor: false }), 'F# mayor');
  assert.equal(keyLong(am, 1), 'Bb menor');
  assert.equal(keyScale(am), 'A:minor');
  assert.equal(keyScale({ root: 3, minor: true }), 'Eb:minor');
  assert.deepEqual(cleanKey({ root: 14, minor: 1 }), { root: 2, minor: true });
  assert.equal(cleanKey({ root: 'x' }), null);
  assert.equal(cleanKey(null), null);
  // va en el nombre del archivo exportado
  assert.equal(exportFileName({ title: 'Pergolero', bpm: 132, key: keyShort({ root: 1, minor: true }), part: 'master', ext: 'wav' }), 'pergolero_132bpm_Csm_master.wav');
});

test('5.1 tonalidad desde nombres de Splice', () => {
  assert.deepEqual(parseKeyToken('Amin'), { root: 9, minor: true });
  assert.deepEqual(parseKeyToken('C#maj'), { root: 1, minor: false });
  assert.deepEqual(parseKeyToken('Bbminor'), { root: 10, minor: true });
  assert.deepEqual(parseKeyToken('F#m'), { root: 6, minor: true });
  assert.deepEqual(parseKeyToken('E'), { root: 4, minor: null });
  assert.equal(parseKeyToken('am'), null);
  assert.equal(parseKeyToken('Bass'), null);
  assert.deepEqual(keyFromFileName('PL_TT_126_Amin_top_loop.wav'), { root: 9, minor: true });
  assert.deepEqual(keyFromFileName('SOP_128_F_bass_loop.wav'), { root: 5, minor: null });
  // una letra suelta sin BPM en el nombre no cuenta (puede ser «Loop_B»)
  assert.equal(keyFromFileName('Loop_B_dark.wav'), null);
  assert.deepEqual(keyFromFileName('vocal_chop_Gmin.wav'), { root: 7, minor: true });
  // una «A» de artista antes del BPM no es tonalidad
  assert.deepEqual(keyFromFileName('A_126_F_bass.wav'), { root: 5, minor: null });
});

test('5.1 sugerencia: la tonalidad de la mayoría de los loops', () => {
  const s = suggestKey(['PL_126_Amin_top.wav', 'PL_126_Amin_pad.wav', 'XX_128_Fmin_bass.wav', 'kick_01.wav']);
  assert.deepEqual(s, { key: { root: 9, minor: true }, votes: 2 });
  // raíz sin modo vota con el modo de esa raíz
  const r = suggestKey(['A_126_F_bass.wav', 'SOP_126_F_sub.wav', 'SOP_126_Fmaj_keys.wav', 'SOP_126_Amin_top.wav']);
  assert.deepEqual(r, { key: { root: 5, minor: false }, votes: 3 });
  assert.equal(suggestKey(['kick.wav', 'hat_02.wav']), null);
});
