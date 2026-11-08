import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitBankOf, setKitBank } from '../src/lib/kitBank';

test('kitBankOf: lee el banco o dice si se puede poner uno', () => {
  assert.equal(kitBankOf('s("bd*4").bank("RolandTR909")'), 'RolandTR909');
  assert.equal(kitBankOf('stack(s("bd ~ sd ~"), s("hh*8"))'), '');
  assert.equal(kitBankOf('s("local_kick ~ ~ ~")'), null); // un sample propio no es de caja de ritmos
  assert.equal(kitBankOf('note("c2 e2").s("sawtooth")'), null);
  assert.equal(kitBankOf('s("bd").bank("A").fast(2).bank("B")'), null);
  assert.equal(kitBankOf('arrange([16, s("bd*4").bank("RolandTR909")], [8, s("bd*4").bank("RolandTR909").mask(0)])'), 'RolandTR909');
});

test('setKitBank: reemplaza en su sitio, agrega o quita', () => {
  assert.equal(setKitBank('s("bd*4").bank("RolandTR909").gain(0.8)', 'LinnDrum'), 's("bd*4").bank("LinnDrum").gain(0.8)');
  assert.equal(setKitBank('s("bd*4")', 'RolandTR808'), 's("bd*4").bank("RolandTR808")');
  assert.equal(setKitBank('s("bd*4").bank("RolandTR808")', ''), 's("bd*4")');
  assert.equal(setKitBank('arrange([1, s("bd").bank("A")], [1, s("bd").bank("A")])', 'B'), 'arrange([1, s("bd").bank("B")], [1, s("bd").bank("B")])');
});
