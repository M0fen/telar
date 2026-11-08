// MAPAS DE CONTROLADORES DE DJ listos (sin «aprender»): firma física ('n<canal>:<nota>' /
// 'c<canal>:<cc>', como midiIn) → slot de la mesa. Deck 1 = el lado A, deck 2 = el B (orderDecks).
// Puro: el que lo aplica es midiIn (al conectar, si reconoce el nombre del aparato).
// lo que muestra un deck en las luces del controlador
export interface DeckLights { loaded: boolean; playing: boolean; sync: boolean; pfl: boolean; hot: boolean[]; loopBeats: number | null }
export type LightMsg = [number, number, number];
export interface ControllerMap {
  name: string;
  match: RegExp;
  map: Record<string, string>;
  rel: Record<string, string>;
  lights?: (decks: DeckLights[]) => LightMsg[]; // todas las luces, encendidas o apagadas
}

// Pioneer DJ DDJ-FLX4 (sirve para el DDJ-400, que manda lo mismo). Números de su lista de mensajes
// MIDI (los mismos que usa el mapa de Mixxx): botones del deck en el canal 1/2, mezclador y
// crossfader en el 7, pads del deck 1 en el 8 y del deck 2 en el 10. Faders y perillas mandan MSB
// (7 bit) y luego LSB: se usa el MSB. El jog manda 64 ± velocidad.
const BEAT_LOOPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
// slot de un loop de N tiempos (sin punto en el nombre: 0,25 → loopb0_25)
export const beatLoopSlot = (beats: number) => `loopb${String(beats).replace('.', '_')}`;
function ddjFlx4(): ControllerMap {
  const map: Record<string, string> = { 'c6:31': 'dj.xfader', 'c6:12': 'dj.hpmix' };
  const rel: Record<string, string> = {};
  for (const d of [0, 1]) {
    const s = (w: string) => `dj.d${d + 1}.${w}`;
    const pad = d === 0 ? 7 : 9;
    Object.assign(map, {
      [`n${d}:11`]: s('play'),
      [`n${d}:12`]: s('cuebtn'),
      [`n${d}:88`]: s('sync'),
      [`n${d}:84`]: s('cue'),
      [`c${d}:19`]: s('gain'),
      [`c${d}:0`]: s('pitchinv'), // el TEMPO del FLX4: arriba = más lento
      [`c${d}:7`]: s('eqhigh'),
      [`c${d}:11`]: s('eqmid'),
      [`c${d}:15`]: s('eqlow'),
      [`c6:${23 + d}`]: s('filter'),
      [`n${d}:16`]: s(beatLoopSlot(4)), // LOOP IN / 4 BEAT
      [`n${d}:77`]: s('loopexit'), // RELOOP / EXIT
      [`n${d}:81`]: s('loophalf'), // CUE/LOOP CALL ◀
      [`n${d}:83`]: s('loopdouble'), // CUE/LOOP CALL ▶
      [`c${d}:33`]: s('jog'), // el borde del jog: empujar
      [`c${d}:35`]: s('jog'), // el plato (vinyl apagado)
    });
    rel[`c${d}:33`] = '64';
    rel[`c${d}:35`] = '64';
    for (let k = 0; k < 8; k++) {
      map[`n${pad}:${k}`] = s(`hot${k + 1}`); // pads en modo HOT CUE
      map[`n${pad}:${96 + k}`] = s(beatLoopSlot(BEAT_LOOPS[k])); // pads en modo BEAT LOOP
    }
  }
  return { name: 'Pioneer DDJ-FLX4 / DDJ-400', match: /DDJ-?(FLX4|400)/i, map, rel, lights: flx4Lights };
}

// LUCES del FLX4 (las mismas notas que se tocan, con 127 = encendida y 0 = apagada): PLAY, CUE
// (en pausa con tema), SYNC, cue de audífonos, LOOP IN/OUT con el loop puesto y, en los pads,
// los cues rápidos puestos (modo HOT CUE) y el loop que suena (modo BEAT LOOP)
export function flx4Lights(decks: DeckLights[]): LightMsg[] {
  const out: LightMsg[] = [];
  const on = (b: boolean) => (b ? 127 : 0);
  for (const d of [0, 1]) {
    const s = decks[d] ?? { loaded: false, playing: false, sync: false, pfl: false, hot: [], loopBeats: null };
    const ch = 0x90 + d, pad = d === 0 ? 0x97 : 0x99;
    const looping = s.loopBeats != null;
    out.push([ch, 0x0b, on(s.playing)], [ch, 0x0c, on(s.loaded && !s.playing)], [ch, 0x58, on(s.loaded && s.sync)], [ch, 0x54, on(s.pfl)], [ch, 0x10, on(looping)], [ch, 0x11, on(looping)]);
    for (let k = 0; k < 8; k++) out.push([pad, k, on(!!s.hot[k])]);
    BEAT_LOOPS.forEach((b, k) => out.push([pad, 0x60 + k, on(looping && Math.abs((s.loopBeats as number) - b) < 1e-6)]));
  }
  return out;
}

export const CONTROLLER_MAPS: ControllerMap[] = [ddjFlx4()];
export const BEAT_LOOP_SIZES = BEAT_LOOPS;
export const controllerFor = (inputs: string[]): ControllerMap | null => CONTROLLER_MAPS.find((c) => inputs.some((i) => c.match.test(i))) ?? null;
