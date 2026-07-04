import test from 'node:test';
import assert from 'node:assert/strict';
import { irRoomsize, knownIr, registerUserIr, allIrDefs, BUILTIN_IRS } from '../src/audio/irRegistry.ts';

test('irRoomsize returns the exact tabulated duration for built-in spaces', () => {
  assert.equal(irRoomsize('ir_room'), 0.5);
  assert.equal(irRoomsize('ir_hall'), 2.2);
  assert.equal(irRoomsize('ir_cathedral'), 4.0);
});

test('irRoomsize falls back to 5 for unknown IRs', () => {
  assert.equal(irRoomsize('nope'), 5);
});

test('irRoomsize clamps to a sane range', () => {
  registerUserIr({ name: 'ir_u_huge', label: 'huge', duration: 40 });
  registerUserIr({ name: 'ir_u_tiny', label: 'tiny', duration: 0.01 });
  assert.equal(irRoomsize('ir_u_huge'), 12);
  assert.equal(irRoomsize('ir_u_tiny'), 0.2);
});

test('irRoomsize uses the measured duration of a real IR (Bricasti-like ~3.5s)', () => {
  registerUserIr({ name: 'ir_u_m7hall', label: 'm7 hall', duration: 3.47 });
  assert.equal(irRoomsize('ir_u_m7hall'), 3.5); // ceil a 0.1 → cola íntegra, sin bucle
});

test('knownIr: true for built-ins and registered user IRs, false otherwise', () => {
  assert.equal(knownIr('ir_plate'), true);
  assert.equal(knownIr('ir_u_m7hall'), true);
  assert.equal(knownIr('ir_ghost'), false);
});

test('allIrDefs includes every built-in space', () => {
  const names = new Set(allIrDefs().map((d) => d.name));
  for (const b of BUILTIN_IRS) assert.equal(names.has(b.name), true);
});
