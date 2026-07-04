// Generación PURA del código Strudel de una pista del secuenciador (sin dependencias
// del store/motor → testeable en Node). CLAVE: si ya hay código (el usuario pudo trabajar
// el sonido añadiendo FX como .lpf()/.room()/.speed()), lo PRESERVAMOS y solo parcheamos
// las partes que el secuenciador posee (sonido, banco, patrón, gain, swing). Así "el sonido
// que estás trabajando" NO se pierde al abrir/editar el secuenciador.

export interface LaneLike {
  sound: string;
  bank: string;
  steps: boolean[];
  gain: number;
}

const SRC_RE = /\b(?:s|sound)\(\s*["'`][^"'`]*["'`]\s*\)/;
const BANK_RE = /\.bank\(\s*["'`][^"'`]*["'`]\s*\)/;
const STRUCT_RE = /\.struct\(\s*["'`][^"'`]*["'`]\s*\)/;
const GAIN_RE = /\.gain\(\s*[\d.]+\s*\)/;
const SWING_RE = /\.swingBy\([^)]*\)/;

export function laneCode(l: LaneLike, stepCount: number, swing: number, existing = ''): string {
  const pat = l.steps.slice(0, stepCount).map((s) => (s ? 'x' : '~')).join(' ');
  let c = SRC_RE.test(existing) ? existing : `s("${l.sound}")`;
  c = c.replace(SRC_RE, `s("${l.sound}")`); // sonido
  c = c.replace(BANK_RE, ''); // banco: se re-inserta tras el s(...) si lo hay
  if (l.bank) c = c.replace(SRC_RE, (m) => `${m}.bank("${l.bank}")`);
  c = STRUCT_RE.test(c) ? c.replace(STRUCT_RE, `.struct("${pat}")`) : `${c}.struct("${pat}")`; // patrón
  c = c.replace(GAIN_RE, ''); // gain del slider de la pista
  if (Math.abs(l.gain - 1) > 0.01) c += `.gain(${l.gain.toFixed(2)})`;
  c = c.replace(SWING_RE, ''); // swing global
  if (swing > 0.01) c += `.swingBy(${swing.toFixed(2)}, 4)`;
  return c;
}
