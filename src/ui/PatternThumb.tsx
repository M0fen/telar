import { useEffect, useRef } from 'react';
import { previewPattern, eventsOf } from '../audio/patternPreview';
import { patternFigure, type PatternFigure } from '../lib/patternDraw';
import { splitArrange, isSilenceArm, isMutedArm, unmuteArm } from '../nodes/stepseqCode';

// MINIATURA DEL PATRÓN (Fase 8.7): lo que toca una pista en un compás — golpes por sonido, notas por
// altura o la barra de un loop — en su color. La usan los nodos plegados del grafo. En un arrange
// se muestra la primera sección que tiene patrón.
export function previewSource(code: string): string {
  const arms = splitArrange(code);
  if (!arms) return code;
  const a = arms.find((x) => !isSilenceArm(x.code));
  if (!a) return '';
  return isMutedArm(a.code) ? unmuteArm(a.code) : a.code;
}

export function drawFigure(cv: HTMLCanvasElement | null, fig: PatternFigure | null, color: string, opts: { beats?: number; bars?: number; grid?: boolean } = {}) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || cv.width;
  const H = cv.clientHeight || cv.height;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const bars = opts.bars ?? 1;
  const beats = opts.beats ?? 4;
  if (opts.grid !== false) {
    g.fillStyle = 'rgba(150, 178, 198, 0.10)';
    for (let i = 1; i < bars * beats; i++) g.fillRect(Math.round((i / (bars * beats)) * W), 0, 1, H);
  }
  if (!fig || fig.kind === 'empty') return;
  g.fillStyle = color;
  if (fig.kind === 'loop') {
    for (const s of fig.shapes) {
      g.globalAlpha = 0.28 * s.a;
      g.fillRect(s.x * W, 2, Math.max(2, s.w * W), H - 4);
      g.globalAlpha = 0.9;
      // un trazo de «onda» para que se lea como audio
      g.beginPath();
      const x0 = s.x * W;
      const x1 = x0 + s.w * W;
      for (let x = x0; x < x1; x += 2) {
        const k = Math.abs(Math.sin(x * 0.37) * Math.cos(x * 0.13));
        const a = (0.15 + 0.6 * k) * (H / 2 - 3);
        g.rect(x, H / 2 - a, 1, 2 * a);
      }
      g.fill();
    }
    g.globalAlpha = 1;
    return;
  }
  for (const s of fig.shapes) {
    g.globalAlpha = s.a;
    const pad = fig.kind === 'drums' ? 1 : 0.5;
    g.fillRect(s.x * W, s.y * H + pad, Math.max(fig.kind === 'drums' ? 2 : 1.5, s.w * W), Math.max(1.5, s.h * H - 2 * pad));
  }
  g.globalAlpha = 1;
}

export function PatternThumb({ code, color, className }: { code: string; color?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(async () => {
      const src = previewSource(code);
      const pat = src ? await previewPattern(src) : null;
      if (!alive) return;
      drawFigure(ref.current, pat ? patternFigure(eventsOf(pat, 0, 1), 1) : null, color ?? '#3df0d0');
    }, 120);
    return () => { alive = false; window.clearTimeout(t); };
  }, [code, color]);
  return <canvas ref={ref} className={`pthumb${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}
