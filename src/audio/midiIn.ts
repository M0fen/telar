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

  const slot = ctl[st.map[key]];
  if (!slot) return;
  if (slot.kind === 'knob' && ty === 0xb0 && st.rel[key]) {
    // encoder relativo: suma/resta el delta a la cantidad actual
    const dlt = st.rel[key] === '64' ? v - 64 : v < 64 ? v : v - 128;
    slot.set(clamp(slot.get() + dlt / 80, 0, 1));
  } else if (slot.kind === 'knob' && val != null) {
    slot.set(val); // perilla absoluta: 0..127 → 0..1
  } else if (slot.kind === 'pad') {
    if (down) slot.down();
    else slot.up();
  } else if (slot.kind === 'tap' && down) {
    slot.tap();
  }
}
