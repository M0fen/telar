import { useEffect, useRef } from 'react';
import { getSourceAnalyser, isStarted } from '../audio/engine';
import { drawWave, drawFlat } from './drawWave';

// Onda EN VIVO de un source, dibujada leyendo su analyser directamente (no usa el
// registro compartido de scopeEngine → puede convivir con el visual del instrumento).
// Se usa en el secuenciador para "ver la onda mientras editas". Línea plana si no suena.
export function LiveScope({ nodeId, height = 40 }: { nodeId: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const buf = new Uint8Array(1024);
    let idleAt = 0;
    const draw = (t: number) => {
      const c = ref.current;
      // parado: la línea base basta con 2 dibujos por segundo
      const idle = !isStarted();
      if (idle && idleAt && t - idleAt < 500) { raf = requestAnimationFrame(draw); return; }
      idleAt = idle ? t : 0;
      if (c) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = Math.floor(c.clientWidth * dpr);
        const H = Math.floor(height * dpr);
        if (c.width !== W) c.width = W;
        if (c.height !== H) c.height = H;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, W, H);
          const an = getSourceAnalyser(nodeId);
          if (an) {
            const n = Math.min(buf.length, an.fftSize);
            an.getByteTimeDomainData(buf);
            drawWave(ctx, buf, n, W, H);
          } else {
            drawFlat(ctx, W, H);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [nodeId, height]);
  return <div className="seq-scope nodrag"><canvas ref={ref} className="seq-scope-canvas" style={{ height }} /></div>;
}
