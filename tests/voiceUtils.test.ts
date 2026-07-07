// Tests de src/ui/voice/voiceUtils.ts — helpers puros del estudio de voz extraídos
// en el split de VoiceStudio.tsx (P2.6). Sin @strudel/web ni DOM: corren en Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, midiToName, noteToMidi, scaleName, SCALE_STEPS, NATURAL_MIDI,
  PC_FLAT, ACCIDENTAL, AT_ROOTS, AT_SCALE_NAMES, melodyTokenToNote,
} from '../src/ui/voice/voiceUtils';

test('melodyTokenToNote: grado en escala → nota (raíz c2); cromático → tal cual; ~ → null', () => {
  // menor: grados [0,2,3,5,7,8,10] sobre c2 (midi 36). grado 0 = c2, grado 1 = d2 (36+2)
  assert.equal(melodyTokenToNote('0', 'C:minor'), 'c2');
  assert.equal(melodyTokenToNote('1', 'C:minor'), midiToName(NATURAL_MIDI + SCALE_STEPS.minor[1]));
  assert.equal(melodyTokenToNote('7', 'C:minor'), midiToName(NATURAL_MIDI + 12)); // grado 7 = octava (c3)
  assert.equal(melodyTokenToNote('eb4', ''), 'eb4'); // cromático: el token ya es nota
  assert.equal(melodyTokenToNote('~', 'C:minor'), null);
  assert.equal(melodyTokenToNote('', ''), null);
});

test('clamp01 acota a [0,1]', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(0.37), 0.37);
  assert.equal(clamp01(1.5), 1);
});

test('noteToMidi: notación de Strudel (bemoles, sostenidos, octavas)', () => {
  assert.equal(noteToMidi('c4'), 60);
  assert.equal(noteToMidi('a4'), 69);
  assert.equal(noteToMidi('eb3'), 51);
  assert.equal(noteToMidi('f#2'), 42);
  assert.equal(noteToMidi('fs2'), 42); // 's' = sostenido (alias Strudel)
  assert.equal(noteToMidi('c'), 60); // sin octava → 4 por defecto
  assert.equal(noteToMidi('C4'), 60); // mayúscula
  assert.equal(noteToMidi('x9'), null); // no-nota
  assert.equal(noteToMidi('~'), null); // silencio
});

test('midiToName ↔ noteToMidi: round-trip en el rango del piano roll', () => {
  // 2 octavas cromáticas desde c1 hasta b4 (cubre el roll con octava base 1..3)
  for (let m = 24; m <= 71; m++) {
    const name = midiToName(m);
    assert.equal(noteToMidi(name), m, `round-trip de ${name}`);
  }
});

test('NATURAL_MIDI = c2 (transpose 0 en superdough)', () => {
  assert.equal(midiToName(NATURAL_MIDI), 'c2');
});

test('scaleName pela el prefijo de raíz', () => {
  assert.equal(scaleName('C:minor'), 'minor');
  assert.equal(scaleName('minor'), 'minor');
  assert.equal(scaleName('C: harmonic minor'), 'harmonic minor');
});

test('SCALE_STEPS: escalas bien formadas (empiezan en 0, ascendentes, < 12)', () => {
  for (const [name, steps] of Object.entries(SCALE_STEPS)) {
    assert.equal(steps[0], 0, `${name} empieza en la raíz`);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i] > steps[i - 1], `${name} asciende`);
      assert.ok(steps[i] < 12, `${name} dentro de la octava`);
    }
  }
  // las escalas del selector de VoiceStudio existen todas
  for (const s of ['major', 'minor', 'minor pentatonic', 'major pentatonic', 'dorian', 'phrygian', 'harmonic minor']) {
    assert.ok(SCALE_STEPS[s], `existe ${s}`);
  }
});

test('tablas del roll y del autotune coherentes', () => {
  assert.equal(PC_FLAT.length, 12);
  assert.equal(AT_ROOTS.length, 12); // una raíz por semitono (índice = semitonos sobre C)
  assert.ok(AT_SCALE_NAMES.includes('menor'));
  // las teclas negras son exactamente los 5 pitch-class con bemol/sostenido
  assert.deepEqual([...ACCIDENTAL].sort((a, b) => a - b), [1, 3, 6, 8, 10]);
});
