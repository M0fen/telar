// AUTOMATIZACIÓN (Modo DAW, Fase 3.1; Fase 7.2 «cualquier perilla»): curvas dibujadas —o
// grabadas en el jam— sobre los compases de la canción. Puntos [compás, valor] con rampas lineales
// entre ellos; antes del primero vale el primero y después del último, el último. Se repite con la
// canción.
//
// Dos sitios:
//   · por PISTA (data.auto del Source): volumen, filtro, paneo y los envíos a los retornos;
//   · del MÁSTER (data.auto del nodo Out): filtro DJ, drive, reverb/eco/crush del máster y el nivel
//     de los dos retornos.
// Y dos maneras de sonar, según dónde vive cada perilla:
//   · en el CÓDIGO (regla 1): un sufijo `.withHap(...)` que lee el compás del PROPIO evento
//     (`hap.whole.begin`) — sigue bien con «tocar desde», el loop de región y cada vuelta:
//       volumen → multiplica `velocity`; filtro → compone `cutoff`/`hcutoff` con la voz (un
//       paso-bajo nunca ABRE uno más oscuro); paneo → fija `pan`; reverb/eco/crush del máster →
//       componen con lo que cada voz ya trae (como sus perillas);
//   · en el MOTOR (Web Audio, sin recompilar): envíos, filtro DJ y drive del bus y nivel de los
//     retornos. En vivo los mueve audio/autoRunner (a ~30 por segundo, en el compás que suena);
//     al exportar se agendan exactos sobre los AudioParam del render.
// Mientras una perilla del motor tiene curva, manda la curva (la perilla vale con ■).
import { sweepCurve, cleanTransitions } from './transitions';

export type AutoPoint = [number, number]; // [compás (desde 0, fraccional), valor]
export type TrackParam = 'vol' | 'filt' | 'pan' | 'rev' | 'del';
export type MasterParam = 'mfilt' | 'mdrive' | 'mroom' | 'mdelay' | 'mcrush' | 'rv' | 'dl';
export type AutoParam = TrackParam | MasterParam;
export type TrackAuto = Partial<Record<AutoParam, AutoPoint[]>>;

// mode: 'mul' multiplica (neutro 1), 'compose' compone con la voz (neutro = no hace nada),
// 'set' fija el valor (activa en cuanto tiene un punto). where: código o motor.
export const AUTO_RANGE: Record<AutoParam, { min: number; max: number; neutral: number; label: string; mode: 'mul' | 'compose' | 'set'; where: 'code' | 'engine' }> = {
  vol: { min: 0, max: 1.5, neutral: 1, label: 'volumen', mode: 'mul', where: 'code' },
  filt: { min: -1, max: 1, neutral: 0, label: 'filtro', mode: 'compose', where: 'code' },
  pan: { min: 0, max: 1, neutral: 0.5, label: 'paneo', mode: 'set', where: 'code' },
  rev: { min: 0, max: 1, neutral: 0, label: 'envío reverb', mode: 'set', where: 'engine' },
  del: { min: 0, max: 1, neutral: 0, label: 'envío eco', mode: 'set', where: 'engine' },
  mfilt: { min: -1, max: 1, neutral: 0, label: 'filtro DJ', mode: 'set', where: 'engine' },
  mdrive: { min: 0, max: 1, neutral: 0, label: 'drive', mode: 'set', where: 'engine' },
  mroom: { min: 0, max: 0.8, neutral: 0, label: 'reverb (room)', mode: 'compose', where: 'code' },
  mdelay: { min: 0, max: 1, neutral: 0, label: 'eco (delay)', mode: 'compose', where: 'code' },
  mcrush: { min: 0, max: 1, neutral: 0, label: 'crush', mode: 'compose', where: 'code' },
  rv: { min: -30, max: 6, neutral: 0, label: 'retorno reverb (dB)', mode: 'set', where: 'engine' },
  dl: { min: -30, max: 6, neutral: 0, label: 'retorno eco (dB)', mode: 'set', where: 'engine' },
};
export const TRACK_PARAMS: TrackParam[] = ['vol', 'filt', 'pan', 'rev', 'del'];
export const MASTER_PARAMS: MasterParam[] = ['mfilt', 'mdrive', 'mroom', 'mdelay', 'mcrush', 'rv', 'dl'];
const ALL_PARAMS = [...TRACK_PARAMS, ...MASTER_PARAMS] as AutoParam[];

const r3 = (x: number) => Math.round(x * 1000) / 1000;
// el compás de un punto: exacto en la rejilla del DAW (1/16 y tresillos caben en 1/192 de compás, 8.1)
const rb = (x: number) => Math.round(x * 192) / 192;
// rango de una curva: un parámetro conocido o el de una perilla de FX ({min, max}, 7.2)
export type RangeLike = AutoParam | { min: number; max: number };
const rangeOf = (p: RangeLike) => (typeof p === 'string' ? AUTO_RANGE[p] : p);
const clampV = (p: RangeLike, v: number) => Math.max(rangeOf(p).min, Math.min(rangeOf(p).max, Number(v) || 0));
export const snapBar = (bar: number, grid = 0.25) => Math.max(0, Math.round(bar / grid) * grid);

export function sortPoints(pts: AutoPoint[]): AutoPoint[] {
  return [...pts].sort((a, b) => a[0] - b[0]);
}

// Añade (o reemplaza, si ya hay uno en ese compás) un punto.
export function addPoint(pts: AutoPoint[] | undefined, p: RangeLike, bar: number, val: number): AutoPoint[] {
  const b = rb(Math.max(0, bar));
  const out = (pts ?? []).filter((x) => Math.abs(x[0] - b) > 1e-6);
  out.push([b, r3(clampV(p, val))]);
  return sortPoints(out);
}
export function movePoint(pts: AutoPoint[], i: number, p: RangeLike, bar: number, val: number): AutoPoint[] {
  if (i < 0 || i >= pts.length) return pts;
  const rest = pts.filter((_, k) => k !== i);
  return addPoint(rest, p, bar, val);
}
export function removePoint(pts: AutoPoint[], i: number): AutoPoint[] {
  return pts.filter((_, k) => k !== i);
}

// Valor de la curva en el compás x (sin repetir).
export function valueAt(pts: AutoPoint[], x: number): number {
  if (!pts.length) return NaN;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x < pts[i][0]) {
      const [a, va] = pts[i - 1];
      const [b, vb] = pts[i];
      return b > a ? va + ((vb - va) * (x - a)) / (b - a) : vb;
    }
  }
  return pts[pts.length - 1][1];
}

// Puntos VÁLIDOS de una curva: un proyecto importado (hecho a mano o por otra IA) puede traer
// cualquier cosa en `auto`. Pares [compás ≥ 0, valor] numéricos, valor dentro del rango,
// ordenados y sin compases repetidos; máximo 512. Nunca lanza.
const MAX_POINTS = 512;
export function cleanPoints(pts: unknown, p: RangeLike): AutoPoint[] {
  if (!Array.isArray(pts)) return [];
  const out: AutoPoint[] = [];
  for (const x of pts) {
    if (!Array.isArray(x) || x.length < 2) continue;
    const b = Number(x[0]);
    const v = Number(x[1]);
    if (!Number.isFinite(b) || !Number.isFinite(v) || b < 0) continue;
    out.push([rb(b), r3(clampV(p, v))]);
    if (out.length >= MAX_POINTS) break;
  }
  const s = sortPoints(out);
  return s.filter((x, i) => i === 0 || Math.abs(x[0] - s[i - 1][0]) > 1e-6);
}
export function cleanAuto(a: unknown): TrackAuto {
  if (!a || typeof a !== 'object') return {};
  const o = a as Record<string, unknown>;
  const out: TrackAuto = {};
  for (const p of ALL_PARAMS) {
    const pts = cleanPoints(o[p], p);
    if (pts.length) out[p] = pts;
  }
  return out;
}

// ¿la curva hace algo? Las que FIJAN un valor, en cuanto tienen un punto; las demás, si algún
// punto se aparta del neutro.
export function isActive(pts: unknown, p: AutoParam): boolean {
  const c = cleanPoints(pts, p);
  if (AUTO_RANGE[p].mode === 'set') return c.length > 0;
  return c.some((x) => Math.abs(x[1] - AUTO_RANGE[p].neutral) > 1e-3);
}

// valor de la curva en el compás de canción `bar`, repitiendo cada L compases (L ≤ 0: sin repetir)
export function curveAt(pts: AutoPoint[], bar: number, L: number): number {
  const x = L > 0 ? ((bar % L) + L) % L : bar;
  return valueAt(pts, x);
}

// La curva como SEÑAL de Strudel (`signal(t => …)`): el argumento de una perilla de FX (`.lpf(…)`)
// que se mueve por compás (7.2). Se muestrea al principio de cada evento.
export function curveSignal(pts: AutoPoint[], L: number): string {
  return `signal(${curveFn(pts, L)})`;
}

// Función JS (texto) de la curva con repetición cada L compases (L ≤ 0: sin repetir).
function curveFn(pts: AutoPoint[], L: number): string {
  const P = JSON.stringify(sortPoints(pts).map(([b, v]) => [r3(b), r3(v)]));
  const len = L > 0 ? r3(L) : 0;
  return `((P,L)=>t=>{const x=L>0?((t%L)+L)%L:t;if(x<=P[0][0])return P[0][1];for(let i=1;i<P.length;i++){if(x<P[i][0]){const a=P[i-1],b=P[i];return b[0]>a[0]?a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]):b[1]}}return P[P.length-1][1]})(${P},${len})`;
}

// Sufijo de automatización del Source ('' si no hay nada que hacer → código idéntico).
export function automationSuffix(auto: unknown, songBars: number): string {
  const a = cleanAuto(auto);
  const L = Number.isFinite(songBars) && songBars > 0 ? songBars : 0;
  const fn = (p: AutoParam) => (a[p] && isActive(a[p], p) ? curveFn(a[p]!, L) : 'null');
  const vol = fn('vol');
  const filt = fn('filt');
  const pan = fn('pan');
  if (vol === 'null' && filt === 'null' && pan === 'null') return '';
  return (
    `.withHap(((V,F,P)=>h=>{const t=h.whole?Number(h.whole.begin):0;return h.withValue(v=>{const o=Object.assign({},v);` +
    `if(V){o.velocity=(v.velocity==null?1:v.velocity)*V(t)}` +
    `if(F){const f=F(t);if(f<-0.02)o.cutoff=Math.min(+v.cutoff||20000,18000*Math.pow(100/18000,-f));else if(f>0.02)o.hcutoff=Math.max(+v.hcutoff||0,20*Math.pow(5000/20,f))}` +
    `if(P){o.pan=P(t)}` +
    `return o})})(${vol},${filt},${pan}))`
  );
}

// Sufijo de automatización del MÁSTER sobre la mezcla entera (reverb/eco/crush, que viven en el
// código): COMPONEN con lo que cada voz trae — igual que sus perillas del máster.
export function masterAutomationSuffix(auto: unknown, songBars: number): string {
  const a = cleanAuto(auto);
  const L = Number.isFinite(songBars) && songBars > 0 ? songBars : 0;
  const fn = (p: AutoParam) => (a[p] && isActive(a[p], p) ? curveFn(a[p]!, L) : 'null');
  const room = fn('mroom');
  const dly = fn('mdelay');
  const crush = fn('mcrush');
  if (room === 'null' && dly === 'null' && crush === 'null') return '';
  return (
    `.withHap(((R,D,C)=>h=>{const t=h.whole?Number(h.whole.begin):0;return h.withValue(v=>{const o=Object.assign({},v);` +
    `if(R){const r=R(t);if(r>0.005)o.room=1-(1-(+v.room||0))*(1-r)}` +
    `if(D){const d=D(t);if(d>0.005)o.delay=1-(1-(+v.delay||0))*(1-d)}` +
    `if(C){const c=C(t);if(c>0.02)o.crush=Math.min(+v.crush||16,16-c*12)}` +
    `return o})})(${room},${dly},${crush}))`
  );
}

// Curvas que mueve el MOTOR (no el código): los envíos de cada pista y el filtro DJ, el drive y los
// retornos del máster. Lo usan el autoRunner (en vivo) y el render (al exportar).
export interface EngineAuto {
  bars: number; // compases de la canción (las curvas se repiten con ella; 0 = sin repetir)
  sends: Record<string, { rev?: AutoPoint[]; del?: AutoPoint[] }>; // por id de pista
  master: { mfilt?: AutoPoint[]; mdrive?: AutoPoint[]; rv?: AutoPoint[]; dl?: AutoPoint[] };
}
export function engineAutomation(nodes: { id: string; data: { kind?: string; auto?: unknown; mute?: unknown } }[], songBars: number): EngineAuto {
  const out: EngineAuto = { bars: Number.isFinite(songBars) && songBars > 0 ? songBars : 0, sends: {}, master: {} };
  const outNode = nodes.find((n) => n.data.kind === 'out');
  const ma = cleanAuto(outNode?.data.auto);
  for (const p of ['mfilt', 'mdrive', 'rv', 'dl'] as const) if (ma[p] && isActive(ma[p], p)) out.master[p] = ma[p];
  // BARRIDOS de la pista de transiciones (7.4): el filtro DJ del máster sube y se abre en el compás
  // (con la pista de transiciones en M, tampoco barren)
  const trans = nodes.find((n) => n.data.kind === 'source' && Array.isArray((n.data as { transitions?: unknown }).transitions));
  if (trans && !trans.data.mute) {
    const merged = sweepCurve(cleanTransitions((trans.data as { transitions?: unknown }).transitions), out.master.mfilt, out.bars);
    if (merged) out.master.mfilt = merged;
  }
  for (const n of nodes) {
    if (n.data.kind !== 'source') continue;
    const a = cleanAuto(n.data.auto);
    const s: { rev?: AutoPoint[]; del?: AutoPoint[] } = {};
    if (a.rev && isActive(a.rev, 'rev')) s.rev = a.rev;
    if (a.del && isActive(a.del, 'del')) s.del = a.del;
    if (s.rev || s.del) out.sends[n.id] = s;
  }
  return out;
}
export const hasEngineAuto = (e: EngineAuto) => Object.keys(e.master).length > 0 || Object.keys(e.sends).length > 0;

// muestras de una curva para agendarla en un AudioParam (setValueCurveAtTime): de `bar0` a `bar1`
// a `rate` valores por segundo (`cps` ciclos por segundo), pasadas por `map` (valor → parámetro)
export function curveSamples(pts: AutoPoint[], L: number, bar0: number, bar1: number, cps: number, rate = 200, map: (v: number) => number = (v) => v): Float32Array {
  const dur = Math.max(0, (bar1 - bar0) / cps);
  const n = Math.max(2, Math.ceil(dur * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = map(curveAt(pts, bar0 + ((bar1 - bar0) * i) / (n - 1), L));
  return out;
}

// Quita puntos redundantes (los que caen en la recta entre sus vecinos ± tol) — para las
// curvas grabadas desde las perillas (Fase 3.2).
export function simplify(pts: AutoPoint[], tol = 0.01): AutoPoint[] {
  const s = sortPoints(pts);
  if (s.length <= 2) return s;
  const out: AutoPoint[] = [s[0]];
  for (let i = 1; i < s.length - 1; i++) {
    const a = out[out.length - 1];
    const b = s[i + 1];
    const x = s[i][0];
    const lin = b[0] > a[0] ? a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]) : b[1];
    if (Math.abs(lin - s[i][1]) > tol) out.push(s[i]);
  }
  out.push(s[s.length - 1]);
  return out;
}
