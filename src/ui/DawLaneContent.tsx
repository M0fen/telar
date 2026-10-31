import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { previewPattern, eventsOf } from '../audio/patternPreview';
import { getWaveInfo, type WaveInfo } from '../audio/waveformPeaks';
import { patternFigure, patternPeriod, type PatternFigure } from '../lib/patternDraw';
import { isMutedArm, isSilenceArm, unmuteArm } from '../nodes/stepseqCode';
import type { DawBlock } from '../lib/dawModel';

// LO QUE SUENA DENTRO DE LOS BLOQUES (Fase 9.1): golpes por sonido, notas por altura y la onda de los
// loops, en el color de la pista, con una marca donde el patrón vuelve a empezar. Un solo canvas por
// pista que cubre SOLO la parte visible de la línea de tiempo (se redibuja al desplazar o hacer zoom),
// así una canción de 200 compases a 480 px por compás no crea lienzos gigantes. Los eventos salen de
// evaluar el código de cada brazo con Strudel (audio/patternPreview): cualquier código se dibuja.

interface BlockData {
  n: number; // compases calculados (el patrón se repite en bloques más largos)
  fig: PatternFigure;
  period: number;
  wave?: WaveInfo | null; // loops: la onda del sample
  waveBars?: number; // compases que dura el sample
  region?: { b: number; e: number; rev: boolean; rate: number }; // 9.5: el tramo que suena (y si va al revés)
}

const MAX_BARS = 64;
const cache = new Map<string, Promise<BlockData | null>>();

function blockData(code: string, bars: number, cps: number): Promise<BlockData | null> {
  const n = Math.max(1, Math.min(MAX_BARS, Math.ceil(bars)));
  const key = `${n}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const src = isMutedArm(code) ? unmuteArm(code) : code;
    if (!src.trim() || isSilenceArm(src)) return null;
    const pat = await previewPattern(src);
    if (!pat) return null;
    const ev = eventsOf(pat, 0, n);
    const fig = patternFigure(ev, n, 4);
    const out: BlockData = { n, fig, period: patternPeriod(ev, n) };
    if (fig.kind === 'loop' && ev[0]?.snd) {
      const name = ev[0].snd.replace(/:.*$/, '');
      out.wave = await getWaveInfo(name, 600).catch(() => null);
      if (out.wave) out.waveBars = out.wave.duration * (cps > 0 ? cps : 0.5);
      const e0 = ev[0];
      const sp = e0.speed ?? 1;
      if (e0.begin != null || e0.end != null || sp < 0 || Math.abs(sp - 1) > 1e-3) {
        // superdough voltea el buffer antes de recortar: el tramo del original es el espejo
        const b = Math.max(0, Math.min(1, e0.begin ?? 0));
        const e = Math.max(0, Math.min(1, e0.end ?? 1));
        out.region = sp < 0 ? { b: 1 - e, e: 1 - b, rev: true, rate: Math.abs(sp) || 1 } : { b, e, rev: false, rate: Math.abs(sp) || 1 };
      }
    }
    return out;
  })();
  cache.set(key, p);
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return p;
}

export function DawLaneContent({
  blocks, px, x0, w, color, beats, cps, plain, h = 34,
}: {
  blocks: DawBlock[];
  px: number;
  x0: number; // inicio de la vista (px de la línea de tiempo)
  w: number; // ancho visible
  color: string;
  beats: number;
  cps: number;
  plain: boolean;
  h?: number; // alto de la fila (9.6): redibuja al cambiarlo
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<Record<string, BlockData | null>>({});
  // datos de cada bloque (async, con caché por código)
  const sig = blocks.map((b) => `${b.bars}\u0000${b.code}`).join('\u0001');
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      void Promise.all(blocks.map((b) => blockData(b.code, b.bars, cps).then((d) => [`${b.bars}\u0000${b.code}`, d] as const))).then((pairs) => {
        if (alive) setData(Object.fromEntries(pairs));
      });
    }, 60);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, cps]);

  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(w));
    const H = cv.clientHeight || 26;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    for (const b of blocks) {
      const bx = b.start * px - x0;
      const bw = b.bars * px;
      if (bx > W || bx + bw < 0) continue;
      const d = data[`${b.bars}\u0000${b.code}`];
      if (!d) continue;
      const on = b.state === 'on' && !b.ghost;
      const base = b.state === 'on' ? (b.ghost ? 0.55 : 1) : 0.32;
      g.save();
      g.beginPath();
      g.rect(Math.max(0, bx + 1), 0, Math.min(W, bx + bw - 1) - Math.max(0, bx + 1), H);
      g.clip();
      g.fillStyle = color;
      // marcas de vuelta: donde el patrón vuelve a empezar (si se repite dentro del bloque)
      if (d.period < b.bars && d.period * px >= 6) {
        g.globalAlpha = on ? 0.32 : 0.16;
        for (let k = d.period; k < b.bars; k += d.period) {
          const x = bx + k * px;
          if (x >= 0 && x <= W) g.fillRect(Math.round(x), 0, 1, H);
        }
      }
      const span = d.n * px;
      const reps = Math.ceil(b.bars / d.n);
      for (let r = 0; r < reps; r++) {
        const ox = bx + r * span;
        if (ox > W || ox + span < 0) continue;
        if (d.fig.kind === 'loop' && d.wave) {
          const pk = d.wave.peaks;
          const lb = d.waveBars ?? d.n;
          const rg = d.region ?? { b: 0, e: 1, rev: false, rate: 1 };
          const segPx = Math.max(1, ((rg.e - rg.b) * lb * px) / rg.rate); // lo que dura el tramo al sonar
          for (const s of d.fig.shapes) {
            const sx = ox + s.x * span;
            const sw = Math.min(s.w * span, segPx);
            const x1 = Math.max(0, sx);
            const x2 = Math.min(W, sx + sw);
            g.globalAlpha = 0.85 * base;
            for (let x = x1; x < x2; x += 1) {
              const f = (x - sx) / segPx;
              const at = rg.rev ? rg.e - f * (rg.e - rg.b) : rg.b + f * (rg.e - rg.b);
              const v = pk[Math.max(0, Math.min(pk.length - 1, Math.floor(at * pk.length)))] ?? 0;
              const a = Math.max(0.5, v * (H / 2 - 2));
              g.fillRect(x, H / 2 - a, 1, 2 * a);
            }
          }
          continue;
        }
        for (const s of d.fig.shapes) {
          const sx = ox + s.x * span;
          if (sx > W || sx < -40) continue;
          g.globalAlpha = Math.max(0.18, s.a * base);
          if (d.fig.kind === 'loop') {
            g.fillRect(sx, 3, Math.max(2, s.w * span), H - 6);
            continue;
          }
          const sw = d.fig.kind === 'notes' ? Math.max(1.5, s.w * span - 0.5) : Math.max(1.5, Math.min(s.w * span, px / (beats * 2)));
          const pad = d.fig.kind === 'drums' ? 1 : 0.5;
          g.fillRect(sx, s.y * H + pad, sw, Math.max(1.5, s.h * H - 2 * pad));
        }
      }
      g.restore();
    }
    g.globalAlpha = 1;
  }, [blocks, data, px, x0, w, color, beats, plain, h]);

  return <canvas ref={ref} className="daw-lc" style={{ left: x0, width: Math.max(1, Math.round(w)) }} aria-hidden="true" />;
}
