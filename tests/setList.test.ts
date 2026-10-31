// Tracklist del set (DJ-4): cuándo entra cada tema, formato y CUE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueSheet, emptyLog, fmtStamp, logStep, tracklistText, type DeckNow } from '../src/lib/setList.ts';

const deck = (id: string, trackId: string, audible: boolean, title = trackId, n = 1): DeckNow => ({ id, trackId, title, deck: n, audible, bpm: 126, key: '8A' });

test('un tema se anota cuando sube a la sala, no cuando se prepara en los audífonos', () => {
  let st = emptyLog();
  let r = logStep(st, [deck('d1', 'A', true, 'Tema A', 1), deck('d2', 'B', false, 'Tema B', 2)], 0);
  assert.deepEqual(r.add.map((e) => e.title), ['Tema A']);
  st = r.st;
  r = logStep(st, [deck('d1', 'A', true), deck('d2', 'B', false)], 10); // nada nuevo
  assert.equal(r.add.length, 0);
  st = r.st;
  r = logStep(st, [deck('d1', 'A', true), deck('d2', 'B', true, 'Tema B', 2)], 95); // sube B
  assert.deepEqual(r.add.map((e) => [e.title, e.t, e.deck]), [['Tema B', 95, 2]]);
  st = r.st;
  // un corte de B (baja y vuelve en 4 s): no se anota otra vez
  r = logStep(st, [deck('d1', 'A', false), deck('d2', 'B', false)], 120);
  st = r.st;
  r = logStep(st, [deck('d1', 'A', false), deck('d2', 'B', true, 'Tema B', 2)], 124);
  assert.equal(r.add.length, 0);
  st = r.st;
  // otro tema en el deck 1, más tarde
  r = logStep(st, [deck('d1', 'C', true, 'Tema C', 1), deck('d2', 'B', true)], 300);
  assert.deepEqual(r.add.map((e) => e.title), ['Tema C']);
  // el mismo tema A vuelve mucho después: sí se anota
  r = logStep(r.st, [deck('d1', 'A', true, 'Tema A', 1)], 900);
  assert.deepEqual(r.add.map((e) => e.title), ['Tema A']);
});

test('formato de la lista y el CUE', () => {
  assert.equal(fmtStamp(0), '0:00');
  assert.equal(fmtStamp(754.9), '12:34');
  assert.equal(fmtStamp(3723), '1:02:03');
  const list = [{ t: 0, title: 'Tema A', deck: 1, bpm: 126, key: '8A' }, { t: 95.5, title: 'Tema "B"', deck: 2 }];
  assert.equal(tracklistText(list), '01. 0:00 — Tema A (8A · 126 BPM)\n02. 1:35 — Tema "B"');
  const cue = cueSheet(list, 'set.mp3', 'Mi set');
  assert.match(cue, /FILE "set\.mp3" MP3/);
  assert.match(cue, /TRACK 02 AUDIO\r\n {4}TITLE "Tema 'B'"/);
  assert.match(cue, /INDEX 01 01:35:38/); // 95,5 s = 1 min 35 s y 37,5 → 38 cuadros
  assert.match(cue, /TRACK 01 AUDIO[\s\S]*INDEX 01 00:00:00/);
});
