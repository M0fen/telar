// AUTOMATIZACIÓN por pista (Modo DAW, Fase 3.1): curvas de VOLUMEN y FILTRO dibujadas sobre
// los compases de la canción. Puntos [compás, valor] con rampas lineales entre ellos; antes del
// primero vale el primero y después del último, el último. Se repite con la canción.
//
// Se compila como SUFIJO del Source (regla 1): un `.withHap(...)` que lee el compás de la
// canción del PROPIO evento (`hap.whole.begin`) — por eso sigue bien con «tocar desde», el
// loop de región y cada vuelta — y:
//   · volumen → multiplica `velocity` (superdough: gain × velocity) → sin salto de nivel;
//   · filtro  → compone `cutoff`/`hcutoff` con los de la voz (un paso-bajo nunca ABRE uno más
//     oscuro; un paso-alto nunca BAJA uno más fino), misma curva que la perilla del canal.
export type AutoPoint = [number, number]; // [compás (desde 0, fraccional), valor]
export type AutoParam = 'vol' | 'filt';
export interface TrackAuto {
  vol?: AutoPoint[];
  filt?: AutoPoint[];
}

export const AUTO_RANGE: Record<AutoParam, { min: number; max: number; neutral: number; label: string }> = {
  vol: { min: 0, max: 1.5, neutral: 1, label: 'volumen' },
  filt: { min: -1, max: 1, neutral: 0, label: 'filtro' },
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clampV = (p: AutoParam, v: number) => Math.max(AUTO_RANGE[p].min, Math.min(AUTO_RANGE[p].max, Number(v) || 0));
export const snapBar = (bar: number, grid = 0.25) => Math.max(0, Math.round(bar / grid) * grid);

export function sortPoints(pts: AutoPoint[]): AutoPoint[] {
  return [...pts].sort((a, b) => a[0] - b[0]);
}

// Añade (o reemplaza, si ya hay uno en ese compás) un punto.
export function addPoint(pts: AutoPoint[] | undefined, p: AutoParam, bar: number, val: number): AutoPoint[] {
  const b = r3(Math.max(0, bar));
  const out = (pts ?? []).filter((x) => Math.abs(x[0] - b) > 1e-6);
  out.push([b, r3(clampV(p, val))]);
  return sortPoints(out);
}
export function movePoint(pts: AutoPoint[], i: number, p: AutoParam, bar: number, val: number): AutoPoint[] {
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
export function cleanPoints(pts: unknown, p: AutoParam): AutoPoint[] {
  if (!Array.isArray(pts)) return [];
  const out: AutoPoint[] = [];
  for (const x of pts) {
    if (!Array.isArray(x) || x.length < 2) continue;
    const b = Number(x[0]);
    const v = Number(x[1]);
    if (!Number.isFinite(b) || !Number.isFinite(v) || b < 0) continue;
    out.push([r3(b), r3(clampV(p, v))]);
    if (out.length >= MAX_POINTS) break;
  }
  const s = sortPoints(out);
  return s.filter((x, i) => i === 0 || Math.abs(x[0] - s[i - 1][0]) > 1e-6);
}
export function cleanAuto(a: unknown): TrackAuto {
  if (!a || typeof a !== 'object') return {};
  const o = a as Record<string, unknown>;
  const out: TrackAuto = {};
  const vol = cleanPoints(o.vol, 'vol');
  const filt = cleanPoints(o.filt, 'filt');
  if (vol.length) out.vol = vol;
  if (filt.length) out.filt = filt;
  return out;
}

// ¿la curva hace algo? (al menos un punto fuera del valor neutro)
export function isActive(pts: unknown, p: AutoParam): boolean {
  return cleanPoints(pts, p).some((x) => Math.abs(x[1] - AUTO_RANGE[p].neutral) > 1e-3);
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
  const vol = a.vol && isActive(a.vol, 'vol') ? curveFn(a.vol, L) : 'null';
  const filt = a.filt && isActive(a.filt, 'filt') ? curveFn(a.filt, L) : 'null';
  if (vol === 'null' && filt === 'null') return '';
  return (
    `.withHap(((V,F)=>h=>{const t=h.whole?Number(h.whole.begin):0;return h.withValue(v=>{const o=Object.assign({},v);` +
    `if(V){o.velocity=(v.velocity==null?1:v.velocity)*V(t)}` +
    `if(F){const f=F(t);if(f<-0.02)o.cutoff=Math.min(+v.cutoff||20000,18000*Math.pow(100/18000,-f));else if(f>0.02)o.hcutoff=Math.max(+v.hcutoff||0,20*Math.pow(5000/20,f))}` +
    `return o})})(${vol},${filt}))`
  );
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
