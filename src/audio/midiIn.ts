import { useMidiStore } from '../store/useMidiStore';

// Despachador de MIDI IN para el modo EN VIVO. Recibe los bytes crudos de un
// mensaje (de `engine.startMidiInput`), los parsea a una FIRMA estable y los
// enruta al slot asignado. Portado del En vivo de la Sala de Dirección
// (28b-envivo.js): mismo parseo de Note/CC, mismo "aprender" y misma detección
// de perillas relativas. No genera audio: solo llama a los handlers de la UI.

export type MidiSlot =
  | { kind: 'knob'; get: () => number; set: (v01: number) => void } // perilla: cantidad 0..1
  | { kind: 'pad'; down: () => void; up: () => void } // pad momentáneo (mantener)
  | { kind: 'tap'; tap: () => void }; // pad de disparo (escena)

// Registro vivo de slots (lo rellena MidiLive en cada render). Se reemplaza entero
// para no acumular handlers viejos.
const ctl: Record<string, MidiSlot> = {};
const hist: Record<string, number[]> = {};
// SOFT-TAKEOVER (pickup) para perillas absolutas: la perilla de pantalla no se mueve
// hasta que la física "cruza" el valor actual, para que no SALTE al tomarla.
const caught: Record<string, boolean> = {}; // slotId → ya agarró
const lastApplied: Record<string, number> = {}; // slotId → último valor que la perilla aplicó
const lastPhys: Record<string, number> = {}; // firma → último valor físico (0..1)

// INSTRUMENTO DE PADS (Fase 5.4 rebanador; 7.1 grabar): las NOTAS que no están asignadas a un
// slot van aquí (nota, velocidad 0..1, pulsado/soltado). null = nadie las usa.
type NoteSink = (note: number, vel: number, down: boolean) => void;
let noteSink: NoteSink | null = null;
export function setNoteSink(fn: NoteSink | null): void {
  noteSink = fn;
}

export function registerSlots(slots: Record<string, MidiSlot>): void {
  for (const k of Object.keys(ctl)) delete ctl[k];
  Object.assign(ctl, slots);
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export function handleMidi(data: Uint8Array | number[]): void {
  if (!data || data.length < 2) return;
  const ty = data[0] & 0xf0;
  const chn = data[0] & 15;
  const d1 = data[1];
  const v = data.length > 2 ? data[2] : 0;
  let key = '';
  let down = false;
  let val: number | null = null;
  if (ty === 0x90 && v > 0) {
    key = 'n' + chn + ':' + d1;
    down = true;
    val = v / 127;
  } else if (ty === 0x80 || (ty === 0x90 && v === 0)) {
    key = 'n' + chn + ':' + d1; // Note On con velocidad 0 == Note Off
    down = false;
  } else if (ty === 0xb0) {
    key = 'c' + chn + ':' + d1;
    val = v / 127;
    down = v >= 64;
  } else return;

  const st = useMidiStore.getState();
  // monitor: registra SIEMPRE la señal recibida (así se ve que el controlador llega)
  st.note(ty === 0xb0 ? `CC ${d1} · ${v}` : down ? `nota ${d1}` : `nota ${d1} ✕`);

  // Modo APRENDER: el próximo mensaje queda ligado al slot elegido. En notas,
  // solo al PULSAR (no al soltar), para no asignar con el release.
  if (st.learn && st.pick) {
    if (ty !== 0xb0 && !down) return;
    st.assign(key, st.pick);
    return;
  }

  // Detección de perilla RELATIVA (encoder sin fin): manda valores chicos/altos
  // repetidos al girar quieto. Igual heurística que la Sala.
  if (ty === 0xb0) {
    const hh = (hist[key] = (hist[key] || []).concat(v).slice(-3));
    if (
      !st.rel[key] &&
      hh.length === 3 &&
      hh[0] === v &&
      hh[1] === v &&
      [1, 2, 3, 61, 62, 63, 65, 66, 67, 125, 126].includes(v)
    ) {
      st.setRel(key, v >= 61 && v <= 67 ? '64' : '2c');
    }
  }

  const slotId = st.map[key];
  const slot = ctl[slotId];
  if (!slot) {
    // nota libre → instrumento de pads (rebanadas…), si hay uno armado
    if (ty !== 0xb0 && noteSink) noteSink(d1, down ? (val ?? 0.8) : 0, down);
    return;
  }
  if (slot.kind === 'knob' && ty === 0xb0 && st.rel[key]) {
    // encoder relativo (sin fin): suma/resta el delta — nunca salta, no necesita pickup
    const dlt = st.rel[key] === '64' ? v - 64 : v < 64 ? v : v - 128;
    slot.set(clamp(slot.get() + dlt / 80, 0, 1));
  } else if (slot.kind === 'knob' && val != null) {
    // perilla ABSOLUTA (0..127 → 0..1) con SOFT-TAKEOVER: no mueve el valor de
    // pantalla hasta que la física lo "alcanza" (cruza), así no salta al tomarla.
    const cur = slot.get();
    // si el valor cambió por otra vía (mouse, otra perilla) desde lo último que
    // aplicamos, hay que volver a "agarrar" para no saltar.
    if (caught[slotId] && lastApplied[slotId] != null && Math.abs(cur - lastApplied[slotId]) > 0.06) caught[slotId] = false;
    if (!caught[slotId]) {
      const prev = lastPhys[key];
      const crossed = prev != null && (prev - cur) * (val - cur) <= 0; // la física cruzó el valor actual
      if (Math.abs(val - cur) <= 0.03 || crossed) caught[slotId] = true;
    }
    if (caught[slotId]) {
      slot.set(val);
      lastApplied[slotId] = val;
    }
    lastPhys[key] = val;
  } else if (slot.kind === 'pad') {
    if (down) slot.down();
    else slot.up();
  } else if (slot.kind === 'tap' && down) {
    slot.tap();
  }
}
