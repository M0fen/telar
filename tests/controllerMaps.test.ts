import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerFor, beatLoopSlot } from '../src/lib/controllerMaps';

test('reconoce el DDJ-FLX4 por el nombre de la entrada MIDI', () => {
  assert.ok(controllerFor(['DDJ-FLX4 MIDI 1']));
  assert.ok(controllerFor(['PIONEER DDJ-400']));
  assert.equal(controllerFor(['Arturia MiniLab']), null);
});

test('FLX4: los controles principales van a su slot (deck 1 = canal 1, deck 2 = canal 2)', () => {
  const m = controllerFor(['DDJ-FLX4'])!.map;
  assert.equal(m['n0:11'], 'dj.d1.play');
  assert.equal(m['n1:11'], 'dj.d2.play');
  assert.equal(m['n0:88'], 'dj.d1.sync');
  assert.equal(m['c0:19'], 'dj.d1.gain');
  assert.equal(m['c6:31'], 'dj.xfader');
  assert.equal(m['c6:24'], 'dj.d2.filter');
  assert.equal(m['n7:0'], 'dj.d1.hot1');
  assert.equal(m['n9:7'], 'dj.d2.hot8');
  assert.equal(m['n7:96'], `dj.d1.${beatLoopSlot(0.25)}`);
  assert.equal(beatLoopSlot(0.25), 'loopb0_25');
  assert.equal(controllerFor(['DDJ-FLX4'])!.rel['c0:33'], '64');
});

test('luces del FLX4: lo que suena, los cues puestos y el loop', async () => {
  const { flx4Lights } = await import('../src/lib/controllerMaps');
  const msgs = flx4Lights([{ loaded: true, playing: true, sync: true, pfl: false, hot: [true, false], loopBeats: 4 }]);
  const v = (st: number, n: number) => msgs.find((m) => m[0] === st && m[1] === n)?.[2];
  assert.equal(v(0x90, 0x0b), 127); // PLAY del deck 1
  assert.equal(v(0x90, 0x0c), 0); // CUE apagado sonando
  assert.equal(v(0x90, 0x58), 127); // SYNC
  assert.equal(v(0x97, 0x00), 127); // pad 1: cue rápido puesto
  assert.equal(v(0x97, 0x01), 0);
  assert.equal(v(0x97, 0x64), 127); // pad 5 en BEAT LOOP: 4 tiempos
  assert.equal(v(0x90, 0x10), 127); // LOOP IN encendido
  assert.equal(v(0x91, 0x0b), 0); // deck 2 vacío: apagado
});
