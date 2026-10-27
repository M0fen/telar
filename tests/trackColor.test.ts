// Color por pista (Fase 8.5): tipo según nombre o sonido, dos tonos por tipo y el color propio manda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackColors, trackKind, isHexColor } from '../src/lib/trackColor.ts';

test('tipo de pista por su nombre o por lo que suena', () => {
  assert.equal(trackKind('bombo', 's("bd*4")'), 'kick');
  assert.equal(trackKind('', 's("bd ~ bd ~").bank("RolandTR909")'), 'kick');
  assert.equal(trackKind('rumble', 'note("a1 a1").s("sine")'), 'bass');
  assert.equal(trackKind('', 'note("~ a2 ~ c3").s("sawtooth")'), 'bass'); // notas graves
  assert.equal(trackKind('', 'note("a4 c5 e5").s("sawtooth")'), 'synth');
  assert.equal(trackKind('hats', 'stack(s("hh*8"), s("~ oh"))'), 'hat');
  assert.equal(trackKind('', 's("cp ~ cp ~")'), 'snare');
  assert.equal(trackKind('top loop', 's("sh*16")'), 'loop');
  assert.equal(trackKind('', 's("wl_shaker_140").slow(2)'), 'loop');
  assert.equal(trackKind('voz', 's("voxmaster")'), 'vocal');
  assert.equal(trackKind('', ''), 'other');
});

test('colores: el propio manda; dos pistas del mismo tipo alternan tono', () => {
  const c = trackColors([
    { id: 'a', name: 'bombo', code: 's("bd*4")' },
    { id: 'b', name: 'rumble', code: 'note("a1").s("sine")' },
    { id: 'c', name: 'bajo', code: 'note("a2").s("sawtooth")' },
    { id: 'd', name: 'hats', code: 's("hh*8")', color: '#123ABC' },
    { id: 'e', name: 'cosa', code: '' },
  ]);
  assert.equal(c.a, '#f08a3d');
  assert.equal(c.b, '#b48cf0');
  assert.equal(c.c, '#8c8cf0'); // segundo bajo: el otro tono
  assert.equal(c.d, '#123abc');
  assert.ok(isHexColor(c.e));
  assert.equal(isHexColor('rojo'), false);
});
