// Un solo reloj (Fase 0.2): la posición de la canción es el ciclo del scheduler, el mismo
// que recorren los arrange de los instrumentos desde el ciclo 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songPosition, songTotal, arrangeMismatches } from '../src/lib/songClock.ts';

const steps = [{ scene: 1, bars: 4 }, { scene: 2, bars: 8 }, { scene: 3, bars: 2 }]; // 14 compases

test('la canción cuenta desde el ciclo 0 del scheduler (sin reloj propio)', () => {
  assert.equal(songTotal(steps), 14);
  assert.deepEqual(songPosition(steps, 0, true), { idx: 0, end: false });
  assert.equal(songPosition(steps, 3.99, true).idx, 0);
  assert.equal(songPosition(steps, 4, true).idx, 1);
  assert.equal(songPosition(steps, 11.99, true).idx, 1);
  assert.equal(songPosition(steps, 12, true).idx, 2);
  // con el transporte en el ciclo 37.2, la sección es la de 37.2 mod 14 = 9.2 → la 2.ª
  assert.equal(songPosition(steps, 37.2, true).idx, 1);
});

test('segunda vuelta del loop: cae en el mismo compás que el arrange (ciclo mod total)', () => {
  for (let c = 0; c < 42; c++) {
    const idx = songPosition(steps, c + 0.5, true).idx;
    const m = c % 14;
    assert.equal(idx, m < 4 ? 0 : m < 12 ? 1 : 2, `ciclo ${c}`);
  }
});

test('la anticipación dispara la escena justo ANTES de la frontera', () => {
  assert.equal(songPosition(steps, 3.97, true, 0.045).idx, 1);
  assert.equal(songPosition(steps, 3.9, true, 0.045).idx, 0);
  assert.equal(songPosition(steps, 13.98, true, 0.045).idx, 0); // vuelve al 1 del loop
});

test('sin loop: pasado el final termina; antes del final nunca se sale de la última', () => {
  assert.deepEqual(songPosition(steps, 14, false), { idx: 2, end: true });
  assert.equal(songPosition(steps, 13.99, false, 0.045).end, false);
  assert.equal(songPosition(steps, 13.99, false, 0.045).idx, 2);
  assert.equal(songPosition([], 3, true).end, true);
});

test('aviso: instrumentos cuyo arrange no dura lo que la canción', () => {
  const m = arrangeMismatches(steps, [
    { id: 'src_1', name: 'bombo', code: 'arrange([4, s("bd*4")], [8, s("bd*4")], [2, silence])' },
    { id: 'src_2', name: 'bajo', code: 'arrange([8, note("c2")], [8, note("eb2")])' },
    { id: 'src_3', code: 's("hh*8")' }, // plano: no se desfasa
    { id: 'src_4', name: '  ', code: 'arrange([2, s("cp")])' },
  ]);
  assert.deepEqual(m, [{ id: 'src_2', name: 'bajo', bars: 16 }, { id: 'src_4', name: 'src_4', bars: 2 }]);
  assert.deepEqual(arrangeMismatches([], [{ id: 'a', code: 'arrange([2, s("x")])' }]), []);
});
