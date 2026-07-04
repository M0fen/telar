import type { OpDef } from './types';

// Catálogo v1 de Transform y Filter/FX. Géneros objetivo: techno, dnb,
// experimental, urbano (master-prompt §1). Los FX son los que se insertan en vivo.
export const OPS: OpDef[] = [
  // --- Transform (tiempo / estructura) ---
  { id: 'fast', label: 'fast', method: 'fast', kind: 'transform', params: [{ key: 'n', label: 'factor', default: 2, kind: 'number', min: 0.25, max: 8, step: 0.25 }] },
  { id: 'slow', label: 'slow', method: 'slow', kind: 'transform', params: [{ key: 'n', label: 'factor', default: 2, kind: 'number', min: 0.25, max: 8, step: 0.25 }] },
  { id: 'rev', label: 'rev', method: 'rev', kind: 'transform', params: [] },
  { id: 'jux', label: 'jux(rev)', method: 'jux', kind: 'transform', params: [], rawArg: 'rev' },
  { id: 'chop', label: 'chop', method: 'chop', kind: 'transform', params: [{ key: 'n', label: 'trozos', default: 8, kind: 'number', min: 1, max: 32, step: 1 }] },
  { id: 'degradeBy', label: 'degradeBy', method: 'degradeBy', kind: 'transform', params: [{ key: 'n', label: 'prob', default: 0.3, kind: 'number', min: 0, max: 1, step: 0.05 }] },
  { id: 'every', label: 'every(n, rev)', method: 'every', kind: 'transform', params: [{ key: 'n', label: 'cada', default: 4, kind: 'number', min: 1, max: 16, step: 1 }], rawArg: 'rev' },

  // --- Filter / FX (los protagonistas de la edición en vivo) ---
  { id: 'lpf', label: 'lpf', method: 'lpf', kind: 'fx', params: [{ key: 'cutoff', label: 'cutoff Hz', default: 800, kind: 'number', min: 20, max: 18000, step: 1, scale: 'exp' }] },
  { id: 'hpf', label: 'hpf', method: 'hpf', kind: 'fx', params: [{ key: 'cutoff', label: 'cutoff Hz', default: 400, kind: 'number', min: 20, max: 18000, step: 1, scale: 'exp' }] },
  { id: 'bpf', label: 'bpf', method: 'bpf', kind: 'fx', params: [{ key: 'cutoff', label: 'cutoff Hz', default: 1000, kind: 'number', min: 20, max: 18000, step: 1, scale: 'exp' }] },
  { id: 'room', label: 'room', method: 'room', kind: 'fx', params: [{ key: 'amt', label: 'amount', default: 0.4, kind: 'number', min: 0, max: 1, step: 0.02 }] },
  { id: 'delay', label: 'delay', method: 'delay', kind: 'fx', params: [{ key: 'amt', label: 'amount', default: 0.5, kind: 'number', min: 0, max: 1, step: 0.02 }] },
  { id: 'crush', label: 'crush', method: 'crush', kind: 'fx', params: [{ key: 'bits', label: 'bits', default: 6, kind: 'number', min: 1, max: 16, step: 1 }] },
  { id: 'vowel', label: 'vowel', method: 'vowel', kind: 'fx', params: [{ key: 'v', label: 'vocal', default: 'a', kind: 'text' }] },
  // MIDI out (Tier 2): envía las notas a un dispositivo MIDI (hardware/soft). device
  // vacío = primera salida. Requiere activar MIDI (botón del menú derecho). Es salida
  // pura: el sonido local se silencia para esos eventos.
  { id: 'midi', label: 'midi out', method: 'midi', kind: 'fx', params: [
    { key: 'device', label: 'device', default: '', kind: 'text' },
    { key: 'channel', label: 'canal', default: 1, kind: 'number', min: 1, max: 16, step: 1 },
  ] },
  // sidechain: pump de ganancia sincronizado al beat (clásico EBM/darkwave). NO es
  // método directo: el compilador emite .gain(saw.range(1-depth,1).fast(rate)).
  { id: 'sidechain', label: 'sidechain', method: 'gain', kind: 'fx', params: [
    { key: 'depth', label: 'depth', default: 0.7, kind: 'number', min: 0, max: 0.95, step: 0.05 },
    { key: 'rate', label: 'beats', default: 4, kind: 'number', min: 1, max: 16, step: 1 },
  ] },
  { id: 'stut', label: 'stut', method: 'stut', kind: 'fx', params: [
    { key: 'count', label: 'repes', default: 3, kind: 'number', min: 1, max: 8, step: 1 },
    { key: 'fb', label: 'feedback', default: 0.5, kind: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'time', label: 'tiempo', default: 0.125, kind: 'number', min: 0.01, max: 1, step: 0.01 },
  ] },

  // --- Mezcla pro (dinámica + nivel + estéreo) ---
  // Compresor de dinámica nativo (DynamicsCompressorNode): controla picos / pega el
  // sonido. .compressor(threshold, ratio, knee, attack, release) — multi-control.
  { id: 'compressor', label: 'compressor', method: 'compressor', kind: 'fx', params: [
    { key: 'threshold', label: 'umbral dB', default: -20, kind: 'number', min: -60, max: 0, step: 1 },
    { key: 'ratio', label: 'ratio', default: 4, kind: 'number', min: 1, max: 20, step: 0.5 },
    { key: 'knee', label: 'knee', default: 10, kind: 'number', min: 0, max: 40, step: 1 },
    { key: 'attack', label: 'ataque s', default: 0.01, kind: 'number', min: 0.001, max: 0.5, step: 0.001 },
    { key: 'release', label: 'release s', default: 0.1, kind: 'number', min: 0.01, max: 1, step: 0.01 },
  ] },
  { id: 'gain', label: 'gain (trim)', method: 'gain', kind: 'fx', params: [
    { key: 'amt', label: 'nivel', default: 1, kind: 'number', min: 0, max: 2, step: 0.05 },
  ] },
  { id: 'pan', label: 'pan', method: 'pan', kind: 'fx', params: [
    { key: 'pos', label: 'izq↔der', default: 0.5, kind: 'number', min: 0, max: 1, step: 0.02 },
  ] },

  // --- Tier 1 expresivo: ritmo, tonalidad y articulación (ya en el motor) ---
  { id: 'euclid', label: 'euclid', method: 'euclid', kind: 'transform', params: [
    { key: 'pulses', label: 'pulsos', default: 3, kind: 'number', min: 1, max: 16, step: 1 },
    { key: 'steps', label: 'pasos', default: 8, kind: 'number', min: 1, max: 32, step: 1 },
    { key: 'rot', label: 'rot', default: 0, kind: 'number', min: 0, max: 16, step: 1 },
  ] },
  { id: 'scale', label: 'scale', method: 'scale', kind: 'transform', params: [
    { key: 'name', label: 'escala', default: 'C:minor', kind: 'text' },
  ] },
  { id: 'arp', label: 'arp', method: 'arp', kind: 'transform', params: [
    { key: 'mode', label: 'modo', default: 'up', kind: 'text' },
  ] },
  { id: 'ply', label: 'ply', method: 'ply', kind: 'transform', params: [
    { key: 'n', label: 'rep', default: 2, kind: 'number', min: 1, max: 8, step: 1 },
  ] },
];

export const OPS_BY_ID: Record<string, OpDef> = Object.fromEntries(OPS.map((o) => [o.id, o]));

export function defaultParams(op: OpDef): Record<string, number | string> {
  return Object.fromEntries(op.params.map((p) => [p.key, p.default]));
}
