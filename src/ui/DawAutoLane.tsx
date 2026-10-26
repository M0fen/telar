import { useRef, useState } from 'react';
import { AUTO_RANGE, addPoint, movePoint, removePoint, snapBar, sortPoints, type AutoParam, type AutoPoint } from '../lib/automation';

// CARRIL DE AUTOMATIZACIÓN (Modo DAW, Fase 3.1; 7.2 cualquier perilla) bajo una pista o el máster:
// la curva del parámetro elegido sobre los compases. Clic en vacío = punto (y arrástralo) · arrastrar un punto = moverlo
// (¼ de compás) · doble clic = quitarlo. Con un punto enfocado: ← → mueven ¼ de compás,
// ↑ ↓ cambian el valor, Supr lo quita. Cada cambio va al nodo (data.auto) → Ctrl+Z.
const H = 56;
const PAD = 5;

// rango de un carril: un parámetro conocido (AUTO_RANGE) o el de una perilla de FX (7.2), con
// escala exponencial para las frecuencias
export interface LaneRange { min: number; max: number; neutral: number; label: string; scale?: 'exp'; unit?: string }

export function DawAutoLane({
  points, param, range, total, px, onChange,
}: {
  points: AutoPoint[];
  param?: AutoParam;
  range?: LaneRange;
  total: number;
  px: number;
  onChange: (pts: AutoPoint[]) => void;
}) {
  const rg: LaneRange = range ?? (param ? AUTO_RANGE[param] : { min: 0, max: 1, neutral: 0, label: '' });
  const bounds = { min: rg.min, max: rg.max };
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const width = Math.max(1, total * px);
  // valor ↔ 0..1 (lineal o logarítmico)
  const exp = rg.scale === 'exp' && rg.min > 0;
  const norm = (v: number) => (exp ? Math.log(v / rg.min) / Math.log(rg.max / rg.min) : (v - rg.min) / (rg.max - rg.min));
  const denorm = (u: number) => (exp ? rg.min * Math.pow(rg.max / rg.min, u) : rg.min + u * (rg.max - rg.min));
  const y = (v: number) => PAD + (1 - Math.max(0, Math.min(1, norm(v)))) * (H - 2 * PAD);
  const v = (yy: number) => denorm(Math.max(0, Math.min(1, 1 - (yy - PAD) / (H - 2 * PAD))));
  const pts = sortPoints(points);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    const raw = v(e.clientY - r.top);
    return { bar: Math.min(total, snapBar((e.clientX - r.left) / px)), val: exp || Math.abs(rg.max - rg.min) > 50 ? Math.round(raw) : raw };
  };
  const line = pts.length
    ? [`0,${y(pts[0][1])}`, ...pts.map(([b, val]) => `${b * px},${y(val)}`), `${width},${y(pts[pts.length - 1][1])}`].join(' ')
    : '';
  // ↑ ↓: un 5 % del recorrido (en la escala del carril)
  const nudge = (val: number, dir: 1 | -1) => denorm(Math.max(0, Math.min(1, norm(val) + dir * 0.05)));
  const fmt = (val: number) => {
    if (range) return rg.unit === 'Hz' ? (val >= 1000 ? `${(val / 1000).toFixed(1)} kHz` : `${Math.round(val)} Hz`) : `${Math.round(val * 100) / 100}${rg.unit ? ' ' + rg.unit : ''}`;
    if (param === 'filt' || param === 'mfilt') return val < -0.02 ? `paso-bajo ${Math.round(-val * 100)}%` : val > 0.02 ? `paso-alto ${Math.round(val * 100)}%` : 'abierto';
    if (param === 'pan') return val < 0.48 ? `izquierda ${Math.round((0.5 - val) * 200)}%` : val > 0.52 ? `derecha ${Math.round((val - 0.5) * 200)}%` : 'centro';
    if (param === 'rv' || param === 'dl') return `${val >= 0 ? '+' : ''}${val.toFixed(1)} dB`;
    return `${Math.round(val * 100)}%`;
  };

  return (
    <svg
      ref={svgRef}
      className="daw-auto-svg"
      width={width}
      height={H}
      role="group"
      aria-label={`curva de ${rg.label}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as Element).tagName === 'circle') return;
        const { bar, val } = at(e);
        const next = addPoint(pts, bounds, bar, val);
        onChange(next);
        setDrag(next.findIndex((p) => Math.abs(p[0] - bar) < 1e-6));
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag == null) return;
        const { bar, val } = at(e);
        const next = movePoint(pts, drag, bounds, bar, val);
        onChange(next);
        setDrag(next.findIndex((p) => Math.abs(p[0] - bar) < 1e-6));
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      <line x1={0} x2={width} y1={y(rg.neutral)} y2={y(rg.neutral)} className="daw-auto-neutral" />
      {line && <polyline points={line} className="daw-auto-line" />}
      {pts.map(([b, val], i) => (
        <circle
          key={`${b}-${i}`}
          cx={b * px}
          cy={y(val)}
          r={4.5}
          tabIndex={0}
          className={`daw-auto-pt${drag === i ? ' drag' : ''}`}
          onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); setDrag(i); svgRef.current?.setPointerCapture?.(e.pointerId); }}
          onDoubleClick={(e) => { e.stopPropagation(); onChange(removePoint(pts, i)); }}
          onKeyDown={(e) => {
            let next: AutoPoint[] | null = null;
            if (e.key === 'Delete' || e.key === 'Backspace') next = removePoint(pts, i);
            else if (e.key === 'ArrowUp') next = movePoint(pts, i, bounds, b, nudge(val, 1));
            else if (e.key === 'ArrowDown') next = movePoint(pts, i, bounds, b, nudge(val, -1));
            else if (e.key === 'ArrowLeft') next = movePoint(pts, i, bounds, Math.max(0, b - 0.25), val);
            else if (e.key === 'ArrowRight') next = movePoint(pts, i, bounds, Math.min(total, b + 0.25), val);
            if (next) { e.preventDefault(); e.stopPropagation(); onChange(next); }
          }}
        >
          <title>{`compás ${(b + 1).toFixed(2).replace(/\.00$/, '')} · ${fmt(val)} — doble clic: quitar`}</title>
        </circle>
      ))}
    </svg>
  );
}
