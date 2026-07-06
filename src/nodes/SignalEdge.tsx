import { useEffect, useRef } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { registerFlowEdge, unregisterFlowEdge } from './signalFlow';

// Cable del grafo como conducto de señal (V1a). Dibuja el bezier normal (BaseEdge) y le
// superpone una traza que "corre" del source hacia el Out (dash animado) cuya intensidad
// = el pulso que llega a ese cable (propagado por la topología en signalFlow). En silencio
// la traza queda a opacidad 0 → solo se ve el cable base oscuro. El registro es imperativo
// (el rAF de signalFlow escribe opacidad/grosor directo al <path>), sin re-render por frame.
export function SignalEdge({ id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const flowRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    registerFlowEdge(id, source, (v) => {
      el.style.opacity = v.toFixed(3);
      el.style.strokeWidth = (1.2 + v * 3.4).toFixed(2);
    });
    return () => unregisterFlowEdge(id);
  }, [id, source]);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <path ref={flowRef} d={path} className="signal-edge-flow" style={{ opacity: 0 }} />
    </>
  );
}
