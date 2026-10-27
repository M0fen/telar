// REGLA Y REJILLA DEL DAW (Fase 8.1) — lógica PURA (testeable en Node).
//
// Un compás = un ciclo del scheduler; `beats` = tiempos por compás (el «4» de 4/4, el pulso es la
// negra). La regla y las líneas de las pistas se adaptan al zoom (px por compás): primero compases,
// luego pulsos, luego semicorcheas, sin amontonarse nunca. La REJILLA MAGNÉTICA dice a qué se
// ajusta lo que se coloca o se arrastra (puntos de automatización, transiciones; luego clips):
// un valor fijo (compás, 1/2, 1/4, 1/8, 1/16, tresillos), «auto» (la división más fina que se lee
// con este zoom, como la rejilla adaptativa de Live/Bitwig) o «libre».

export type GridId = 'auto' | 'bar' | '1/2' | '1/4' | '1/8' | '1/16' | '1/8T' | '1/16T' | 'off';

export const GRID_OPTIONS: { id: GridId; label: string; title: string }[] = [
  { id: 'auto', label: 'auto', title: 'según el zoom: la división más fina que se lee' },
  { id: 'bar', label: 'compás', title: 'compases enteros' },
  { id: '1/2', label: '1/2', title: 'medio compás (blanca)' },
  { id: '1/4', label: '1/4', title: 'un pulso (negra)' },
  { id: '1/8', label: '1/8', title: 'corchea' },
  { id: '1/16', label: '1/16', title: 'semicorchea' },
  { id: '1/8T', label: '1/8 T', title: 'corchea de tresillo' },
  { id: '1/16T', label: '1/16 T', title: 'semicorchea de tresillo' },
  { id: 'off', label: 'libre', title: 'sin imán' },
];

const safeBeats = (beats: number) => (Number.isFinite(beats) && beats >= 1 ? Math.round(beats) : 4);

// largo de una unidad de la rejilla, en COMPASES
export function gridBars(id: GridId, beats: number): number {
  const b = safeBeats(beats);
  switch (id) {
    case 'bar': return 1;
    case '1/2': return 2 / b;
    case '1/4': return 1 / b;
    case '1/8': return 0.5 / b;
    case '1/16': return 0.25 / b;
    case '1/8T': return 1 / 3 / b;
    case '1/16T': return 1 / 6 / b;
    default: return 0;
  }
}

// REJILLA AUTOMÁTICA: la división más fina cuyo hueco mide al menos `minPx` en pantalla
export function autoGrid(px: number, beats: number, minPx = 12): { bars: number; label: string } {
  const b = safeBeats(beats);
  const cands: { bars: number; label: string }[] = [
    { bars: 8, label: '8 compases' },
    { bars: 4, label: '4 compases' },
    { bars: 2, label: '2 compases' },
    { bars: 1, label: 'compás' },
    ...(b % 2 === 0 && b > 2 ? [{ bars: 2 / b, label: '1/2' }] : []),
    { bars: 1 / b, label: '1/4' },
    { bars: 0.5 / b, label: '1/8' },
    { bars: 0.25 / b, label: '1/16' },
  ];
  let pick = cands[0];
  for (const c of cands) if (c.bars * px >= minPx) pick = c;
  return pick;
}

// la unidad que manda ahora (0 = libre) y cómo se llama
export function effectiveGrid(id: GridId, px: number, beats: number): { bars: number; label: string } {
  if (id === 'auto') return autoGrid(px, beats);
  if (id === 'off') return { bars: 0, label: 'libre' };
  return { bars: gridBars(id, beats), label: GRID_OPTIONS.find((o) => o.id === id)?.label ?? id };
}

// ajusta una posición (en compases) a la rejilla; libre = resolución fina (1/192 de compás)
export function snapTo(bar: number, step: number): number {
  const x = Number.isFinite(bar) ? bar : 0;
  const s = step > 0 ? step : 1 / 192;
  return Math.round(Math.round(x / s) * s * 1e6) / 1e6;
}

// «25.2.3»: compás.pulso.semicorchea (todo desde 1) de una posición en compases desde 0
export function barParts(bar: number, beats: number): { bar: number; beat: number; six: number } {
  const b = safeBeats(beats);
  const p = Math.max(0, (Number.isFinite(bar) ? bar : 0) + 1e-9);
  const n = Math.floor(p);
  const inBeats = (p - n) * b;
  const beat = Math.min(b - 1, Math.floor(inBeats));
  const six = Math.min(3, Math.floor((inBeats - beat) * 4));
  return { bar: n + 1, beat: beat + 1, six: six + 1 };
}
export function fmtBarPos(bar: number, beats: number): string {
  const q = barParts(bar, beats);
  return `${q.bar}.${q.beat}.${q.six}`;
}
// reloj «0:42.1» (minutos:segundos.décimas) para el contador del transporte (8.2)
export function fmtClock(sec: number): string {
  const t = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const d = Math.floor(t * 10 + 1e-6);
  const m = Math.floor(d / 600);
  const s = Math.floor((d % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${d % 10}`;
}
// lo que se escribe en el contador para saltar: «33», «33.3» o «33.3.2» → compás desde 0
export function parseBarPos(txt: string, beats: number): number | null {
  const m = /^\s*(\d+)(?:[.,:](\d+))?(?:[.,:](\d+))?\s*$/.exec(txt);
  if (!m) return null;
  const b = safeBeats(beats);
  const bar = Number(m[1]);
  const beat = m[2] ? Number(m[2]) : 1;
  const six = m[3] ? Number(m[3]) : 1;
  if (bar < 1 || beat < 1 || beat > b || six < 1 || six > 4) return null;
  return bar - 1 + (beat - 1) / b + (six - 1) / (4 * b);
}

// corto: «25» en el compás justo, «25.3» en un pulso, «25.3.2» si cae entre pulsos
export function fmtBarShort(bar: number, beats: number): string {
  const q = barParts(bar, beats);
  const whole = Math.abs(bar - Math.round(bar)) < 1e-6;
  if (whole) return String(Math.round(bar) + 1);
  const onBeat = Math.abs(bar * safeBeats(beats) - Math.round(bar * safeBeats(beats))) < 1e-6;
  return onBeat ? `${q.bar}.${q.beat}` : `${q.bar}.${q.beat}.${q.six}`;
}

// QUÉ DIBUJA LA REGLA con este zoom
export interface RulerPlan {
  labelEvery: number; // número de compás cada N compases
  beatTicks: boolean; // rayitas de pulso
  beatLabels: boolean; // «25.2» en cada pulso
  sixTicks: boolean; // rayitas de semicorchea
}
export function rulerPlan(px: number, beats: number): RulerPlan {
  const b = safeBeats(beats);
  const beatPx = px / b;
  return {
    labelEvery: px >= 24 ? 1 : px >= 13 ? 2 : px >= 7 ? 4 : 8,
    beatTicks: beatPx >= 5,
    beatLabels: beatPx >= 30,
    sixTicks: beatPx / 4 >= 5,
  };
}

interface Bg {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
}
const line = (c: string) => `linear-gradient(to right, ${c} 1px, transparent 1px)`;
const LN_SIX = 'rgba(150, 178, 198, 0.035)';
const LN_BEAT = 'rgba(150, 178, 198, 0.075)';
const LN_BAR = 'rgba(150, 178, 198, 0.15)';
const LN_PHRASE = 'rgba(150, 178, 198, 0.27)';
const SHADE = 'rgba(150, 178, 198, 0.03)';
// sombra cada 4 compases: el 2.º bloque de 4 de cada 8 va un poco más claro (frases a la vista)
const shade = (px: number) => ({ img: `linear-gradient(to right, transparent 50%, ${SHADE} 50%)`, size: `${px * 8}px 100%` });

function build(layers: { img: string; size: string; pos?: string; rep?: string }[]): Bg {
  return {
    backgroundImage: layers.map((l) => l.img).join(', '),
    backgroundSize: layers.map((l) => l.size).join(', '),
    backgroundPosition: layers.map((l) => l.pos ?? '0 0').join(', '),
    backgroundRepeat: layers.map((l) => l.rep ?? 'repeat').join(', '),
  };
}

// LÍNEAS DE LAS PISTAS: frase (4 compases) > compás > pulso > semicorchea, según quepan
export function laneBackground(px: number, beats: number): Bg {
  const b = safeBeats(beats);
  const beatPx = px / b;
  const layers: { img: string; size: string }[] = [];
  if (beatPx / 4 >= 7) layers.push({ img: line(LN_SIX), size: `${beatPx / 4}px 100%` });
  if (beatPx >= 7) layers.push({ img: line(LN_BEAT), size: `${beatPx}px 100%` });
  if (px >= 6) layers.push({ img: line(LN_BAR), size: `${px}px 100%` });
  layers.push({ img: line(LN_PHRASE), size: `${px * 4}px 100%` });
  layers.push(shade(px));
  return build(layers);
}

// MARCAS DE LA REGLA: rayas de compás a toda altura, pulsos y semicorcheas abajo
export function rulerBackground(px: number, beats: number): Bg {
  const b = safeBeats(beats);
  const beatPx = px / b;
  const plan = rulerPlan(px, b);
  const layers: { img: string; size: string; pos?: string; rep?: string }[] = [];
  if (plan.sixTicks) layers.push({ img: line('rgba(150, 178, 198, 0.22)'), size: `${beatPx / 4}px 3px`, pos: '0 100%', rep: 'repeat-x' });
  if (plan.beatTicks) layers.push({ img: line('rgba(150, 178, 198, 0.4)'), size: `${beatPx}px 7px`, pos: '0 100%', rep: 'repeat-x' });
  if (px >= 6) layers.push({ img: line('rgba(150, 178, 198, 0.42)'), size: `${px}px 100%` });
  layers.push({ img: line('rgba(150, 178, 198, 0.7)'), size: `${px * 4}px 100%` });
  layers.push(shade(px));
  return build(layers);
}
