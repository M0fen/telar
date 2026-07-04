import test from 'node:test';
import assert from 'node:assert/strict';
import { laneCode, type LaneLike } from '../src/lib/laneCode.ts';

const L = (o: Partial<LaneLike> = {}): LaneLike => ({ sound: 'bd', bank: '', steps: [true, false, true, false], gain: 1, ...o });

test('fresh lane → s + struct', () => {
  assert.equal(laneCode(L(), 4, 0), 's("bd").struct("x ~ x ~")');
});

test('with bank', () => {
  assert.equal(laneCode(L({ bank: 'RolandTR909' }), 4, 0), 's("bd").bank("RolandTR909").struct("x ~ x ~")');
});

test('PRESERVES user FX when re-syncing (vital)', () => {
  const existing = 's("bd").lpf(200).room(0.3).struct("x x").gain(0.8)';
  assert.equal(laneCode(L(), 4, 0, existing), 's("bd").lpf(200).room(0.3).struct("x ~ x ~")');
});

test('change sound keeps user FX', () => {
  assert.equal(laneCode(L({ sound: 'mykick' }), 4, 0, 's("bd").lpf(200).struct("x ~")'), 's("mykick").lpf(200).struct("x ~ x ~")');
});

test('user sample lane (no bank) with speed + swing', () => {
  assert.equal(
    laneCode(L({ sound: 'phono_kick', bank: '' }), 4, 0.2, 's("bd").bank("RolandTR808").speed(1.2).struct("x ~")'),
    's("phono_kick").speed(1.2).struct("x ~ x ~").swingBy(0.20, 4)',
  );
});

test('lane gain applied, swing at zero omitted', () => {
  assert.equal(laneCode(L({ gain: 0.7 }), 4, 0, 's("bd").struct("x")'), 's("bd").struct("x ~ x ~").gain(0.70)');
});
