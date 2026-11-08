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
