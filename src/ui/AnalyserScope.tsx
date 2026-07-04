import { useEffect, useRef } from 'react';
import { getSourceAnalyser } from '../audio/engine';
import { drawWave, drawFlat } from '../nodes/drawWave';

// Osciloscopio autónomo de un Source: dibuja getSourceAnalyser(nodeId) con su PROPIO
// rAF (no usa el mapa compartido de scopeEngine, que es 1 canvas por nodeId → evita
// chocar con el scope inline del editor cuando el nodo está montado). Vacío si no suena.
export function AnalyserScope({ nodeId, className }: { nodeId: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor((c.clientWidth || 0) * dpr);
      const h = Math.floor((c.clientHeight || 0) * dpr);
      if (!w || !h) return;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const an = getSourceAnalyser(nodeId);
      if (!an) { drawFlat(ctx, w, h); return; }
      if (!buf || buf.length !== an.fftSize) buf = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(buf);
      drawWave(ctx, buf, buf.length, w, h);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [nodeId]);
  return <canvas ref={ref} className={className} />;
}
