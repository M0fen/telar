// Helpers compartidos del piano roll (Synth clip + estudio de voz): conversión
// nota↔midi (bemoles, como Strudel) y las escalas del autotune.
export const PC_FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
export const ACCIDENTAL = new Set([1, 3, 6, 8, 10]); // teclas negras
const NAME_TO_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function midiToName(m: number): string {
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  return PC_FLAT[pc] + oct;
}
export function noteToMidi(tok: string): number | null {
  const m = /^([a-gA-G])([#sb]?)(-?\d+)?$/.exec(tok.trim());
  if (!m) return null;
  let semi = NAME_TO_SEMI[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === 's') semi += 1;
  else if (m[2] === 'b') semi -= 1;
  const oct = m[3] != null ? parseInt(m[3], 10) : 4;
  return semi + (oct + 1) * 12;
}

// intervalos (semitonos) de cada escala — raíz C
export const SCALE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};
export function scaleName(scale: string): string {
  const i = scale.indexOf(':');
  return (i >= 0 ? scale.slice(i + 1) : scale).trim();
}
