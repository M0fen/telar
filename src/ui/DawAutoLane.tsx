import { useRef, useState } from 'react';
import { AUTO_RANGE, addPoint, movePoint, removePoint, snapBar, sortPoints, type AutoParam, type AutoPoint } from '../lib/automation';

// CARRIL DE AUTOMATIZACIÓN (Modo DAW, Fase 3.1) bajo una pista: la curva de volumen o filtro
// sobre los compases. Clic en vacío = punto (y arrástralo) · arrastrar un punto = moverlo
// (¼ de compás) · doble clic = quitarlo. Con un punto enfocado: ← → mueven ¼ de compás,
// ↑ ↓ cambian el valor, Supr lo quita. Cada cambio va al nodo (data.auto) → Ctrl+Z.
const H = 56;
const PAD = 5;

export function DawAutoLane({
  points, param, total, px, onChange,
}: {
  points: AutoPoint[];
  param: AutoParam;
  total: number;
  px: number;
  onChange: (pts: AutoPoint[]) => void;
}) {
  const rg = AUTO_RANGE[param];
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const width = Math.max(1, total * px);
  const y = (v: number) => PAD + (1 - (v - rg.min) / (rg.max - rg.min)) * (H - 2 * PAD);
  const v = (yy: number) => rg.min + (1 - (yy - PAD) / (H - 2 * PAD)) * (rg.max - rg.min);
  const pts = sortPoints(points);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { bar: Math.min(total, snapBar((e.clientX - r.left) / px)), val: v(e.clientY - r.top) };
  };
  const line = pts.length
    ? [`0,${y(pts[0][1])}`, ...pts.map(([b, val]) => `${b * px},${y(val)}`), `${width},${y(pts[pts.length - 1][1])}`].join(' ')
    : '';
  const step = (rg.max - rg.min) / 20;
  const fmt = (val: number) => (param === 'vol' ? `${Math.round(val * 100)}%` : val < -0.02 ? `paso-bajo ${Math.round(-val * 100)}%` : val > 0.02 ? `paso-alto ${Math.round(val * 100)}%` : 'abierto');

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
        const next = addPoint(pts, param, bar, val);
        onChange(next);
        setDrag(next.findIndex((p) => Math.abs(p[0] - bar) < 1e-6));
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag == null) return;
        const { bar, val } = at(e);
        const next = movePoint(pts, drag, param, bar, val);
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
            else if (e.key === 'ArrowUp') next = movePoint(pts, i, param, b, val + step);
            else if (e.key === 'ArrowDown') next = movePoint(pts, i, param, b, val - step);
            else if (e.key === 'ArrowLeft') next = movePoint(pts, i, param, Math.max(0, b - 0.25), val);
            else if (e.key === 'ArrowRight') next = movePoint(pts, i, param, Math.min(total, b + 0.25), val);
            if (next) { e.preventDefault(); e.stopPropagation(); onChange(next); }
          }}
        >
          <title>{`compás ${(b + 1).toFixed(2).replace(/\.00$/, '')} · ${fmt(val)} — doble clic: quitar`}</title>
        </circle>
      ))}
    </svg>
  );
}
