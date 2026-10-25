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

// --- Modo DAW Fase 1.4: tocar desde un compás --------------------------------------------
import { applyStartBar, applyGlobalMaster } from '../src/graph/compile.ts';

test('1.4: songPosition cuenta desde el compás de arranque (from)', () => {
  const steps = [{ scene: 1, bars: 8 }, { scene: 2, bars: 8 }, { scene: 3, bars: 16 }];
  assert.deepEqual(songPosition(steps, 0, true, 0, 0), { idx: 0, end: false });
  assert.deepEqual(songPosition(steps, 0, true, 0, 8), { idx: 1, end: false }); // clic en el compás 9
  assert.deepEqual(songPosition(steps, 0.5, true, 0, 16), { idx: 2, end: false });
  assert.deepEqual(songPosition(steps, 16, true, 0, 16), { idx: 0, end: false }); // da la vuelta (32 → 0)
  assert.deepEqual(songPosition(steps, 16, false, 0, 16), { idx: 2, end: true }); // sin loop: se acaba
  assert.deepEqual(songPosition(steps, 7.95, true, 0.1, 0), songPosition(steps, 0.95, true, 0.1, 7)); // la anticipación también
});

test('1.4: .early(from) solo con from > 0, entero, y POR DENTRO del máster', () => {
  const code = 'stack(arrange([8, s("bd*4")], [8, s("hh*8")]), note("c2").s("sine"))';
  assert.equal(applyStartBar(code, 0), code);
  assert.equal(applyStartBar(code, -3), code);
  assert.equal(applyStartBar(code, Number.NaN), code);
  assert.equal(applyStartBar(code, 8), `(${code}\n).early(8)`);
  assert.equal(applyStartBar(code, 8.7), `(${code}\n).early(8)`); // compases enteros
  assert.equal(applyStartBar('s("bd*4") // fin', 4), '(s("bd*4") // fin\n).early(4)'); // un // final no se come el cierre
  const m = { gain: 1, filter: 0, room: 0, drive: 0, delay: 0, crush: 0, swing: 0.1, humanize: 0, half: 0 } as Parameters<typeof applyGlobalMaster>[1];
  const out = applyGlobalMaster(applyStartBar(code, 8), m);
  assert.ok(out.startsWith(`(${code}\n).early(8)`) && out.indexOf('.early(8)') < out.indexOf('.swingBy('));
  // ½ tiempo: el ancla (reloj del scheduler) envuelve el patrón YA adelantado
  const half = applyGlobalMaster(applyStartBar(code, 8), { ...m, swing: 0, half: 2 });
  assert.ok(half.startsWith('((p)=>stack(') && half.includes(`((${code}\n).early(8))`));
});

// --- Modo DAW Fase 2.4: loop de región ---------------------------------------------------
import { timelinePos, regionOffset } from '../src/lib/songClock.ts';
import { applyTimeline } from '../src/graph/compile.ts';

test('2.4: posición con loop de región (y arrancando dentro de ella)', () => {
  const r = { start: 16, bars: 8 };
  assert.equal(timelinePos(3, { from: 0, region: r, regionOn: false }), 3);
  assert.equal(timelinePos(3, { from: 8, region: r, regionOn: false }), 11);
  assert.equal(timelinePos(0, { from: 0, region: r, regionOn: true }), 16);
  assert.equal(timelinePos(7.5, { from: 0, region: r, regionOn: true }), 23.5);
  assert.equal(timelinePos(8, { from: 0, region: r, regionOn: true }), 16); // vuelve al inicio
  assert.equal(regionOffset({ from: 20, region: r, regionOn: true }), 4);
  assert.equal(timelinePos(0, { from: 20, region: r, regionOn: true }), 20); // arrancó dentro
  assert.equal(timelinePos(4, { from: 20, region: r, regionOn: true }), 16); // y vuelve al inicio
  assert.equal(regionOffset({ from: 40, region: r, regionOn: true }), 0); // fuera → desde el inicio
});

test('2.4: .ribbon solo con el bucle activo, con .early si se arrancó dentro, y por dentro del máster', () => {
  const code = 's("bd*4")';
  assert.equal(applyTimeline(code, { from: 0, region: { start: 16, bars: 8 }, regionOn: false }), code);
  assert.equal(applyTimeline(code, { from: 8, region: null, regionOn: true }), `(${code}\n).early(8)`);
  assert.equal(applyTimeline(code, { from: 0, region: { start: 16, bars: 8 }, regionOn: true }), `(${code}\n).ribbon(16, 8)`);
  assert.equal(applyTimeline(code, { from: 19, region: { start: 16, bars: 8 }, regionOn: true }), `(${code}\n).ribbon(16, 8).early(3)`);
  const m = { gain: 1, filter: 0, room: 0, drive: 0, delay: 0, crush: 0, swing: 0.1, humanize: 0, half: 0 } as Parameters<typeof applyGlobalMaster>[1];
  const out = applyGlobalMaster(applyTimeline(code, { from: 0, region: { start: 16, bars: 8 }, regionOn: true }), m);
  assert.ok(out.indexOf('.ribbon(16, 8)') < out.indexOf('.swingBy('));
});

test('3.3: al exportar, pasado stopAt no arranca nada nuevo (la cola suena, la vuelta siguiente no)', () => {
  const code = 's("bd*4")';
  assert.equal(applyTimeline(code, { from: 0, region: null, regionOn: false, stopAt: null }), code);
  assert.equal(
    applyTimeline(code, { from: 8, region: null, regionOn: false, stopAt: 16 }),
    `((${code}\n).early(8)).filterHaps((h)=>!h.whole||h.whole.begin<16)`,
  );
});
