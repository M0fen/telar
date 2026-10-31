import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { previewPattern, eventsOf } from '../audio/patternPreview';
import { getWaveInfo, type WaveInfo } from '../audio/waveformPeaks';
import { useSoundsVersion } from '../audio/soundsVersion';
import { resolveSampleUrl } from '../lib/sampleResolve';
import { patternFigure, patternPeriod, type PatternFigure } from '../lib/patternDraw';
import { isMutedArm, isSilenceArm, unmuteArm } from '../nodes/stepseqCode';
import type { DawBlock } from '../lib/dawModel';

// LO QUE SUENA DENTRO DE LOS BLOQUES (Fase 9.1): golpes por sonido, notas por altura y la onda de los
// loops, en el color de la pista, con una marca donde el patrón vuelve a empezar. Un solo canvas por
// pista que cubre SOLO la parte visible de la línea de tiempo (se redibuja al desplazar o hacer zoom),
// así una canción de 200 compases a 480 px por compás no crea lienzos gigantes. Los eventos salen de
// evaluar el código de cada brazo con Strudel (audio/patternPreview): cualquier código se dibuja.

interface Region { b: number; e: number; rev: boolean; rate: number } // 9.5: el tramo que suena (y si va al revés)
interface LoopPiece { t: number; d: number; off: number; snd: string; region: Region | null } // off = vuelta ya empezada
interface LoopWave { url: string | null; wave: WaveInfo | null; bars: number } // bars = compases que dura el sample

interface BlockData {
  n: number; // compases calculados (el patrón se repite en bloques más largos)
  fig: PatternFigure;
  period: number;
  pieces?: LoopPiece[]; // loops: dónde suena cada vuelta, de qué sample y qué tramo
  waves?: Record<string, LoopWave>; // loops: la onda de cada sample (y la URL con la que se pidió)
}

const MAX_BARS = 64;
const cache = new Map<string, Promise<BlockData | null>>();
const done = new Map<string, BlockData | null>(); // lo ya resuelto de `cache` (para revisarlo sin esperar)
const keyOf = (code: string, bars: number, cps: number) => `${Math.max(1, Math.min(MAX_BARS, Math.ceil(bars)))}\u0000${cps.toFixed(4)}\u0000${code}`;
const sampleOf = (snd: string) => snd.replace(/:.*$/, '');

// La onda de un loop depende de un sample que puede no estar registrado todavía (el banco cargando,
// el loop estirándose al tempo) o cambiar de audio (otro BPM): si su URL ya no es la que se usó,
// se olvida y se vuelve a calcular. Antes quedaba dibujado con cajas para siempre.
function staleLoop(key: string): boolean {
  const d = done.get(key);
  if (!d?.waves) return false;
  return Object.entries(d.waves).some(([name, w]) => resolveSampleUrl(name) !== w.url || (!!w.url && !w.wave));
}

function regionOf(e: { begin?: number; end?: number; speed?: number }): Region | null {
  const sp = e.speed ?? 1;
  if (e.begin == null && e.end == null && sp >= 0 && Math.abs(sp - 1) <= 1e-3) return null;
  // superdough voltea el buffer antes de recortar: el tramo del original es el espejo
  const b = Math.max(0, Math.min(1, e.begin ?? 0));
  const en = Math.max(0, Math.min(1, e.end ?? 1));
  return sp < 0 ? { b: 1 - en, e: 1 - b, rev: true, rate: Math.abs(sp) || 1 } : { b, e: en, rev: false, rate: Math.abs(sp) || 1 };
}

function blockData(code: string, bars: number, cps: number): Promise<BlockData | null> {
  const n = Math.max(1, Math.min(MAX_BARS, Math.ceil(bars)));
  const key = keyOf(code, bars, cps);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const src = isMutedArm(code) ? unmuteArm(code) : code;
    if (!src.trim() || isSilenceArm(src)) return null;
    const pat = await previewPattern(src);
    if (!pat) return null;
    let ev = eventsOf(pat, 0, n);
    let fig = patternFigure(ev, n, 4);
    if (fig.kind === 'loop' || fig.kind === 'empty') {
      // un clip partido de un loop (`.early(n)`) empieza a mitad del sample: ese trozo también se dibuja
      const pv = eventsOf(pat, 0, n, true);
      const f2 = pv.some((e) => e.off) ? patternFigure(pv, n, 4) : null;
      if (f2?.kind === 'loop') { ev = pv; fig = f2; }
    }
    const out: BlockData = { n, fig, period: patternPeriod(ev, n) };
    if (fig.kind === 'loop') {
      out.pieces = ev.map((e) => ({ t: e.t, d: e.d, off: e.off ?? 0, snd: sampleOf(e.snd), region: regionOf(e) }));
      out.waves = {};
      for (const name of new Set(out.pieces.map((x) => x.snd))) {
        const url = resolveSampleUrl(name);
        const wave = url ? await getWaveInfo(name, 600).catch(() => null) : null;
        out.waves[name] = { url, wave, bars: wave ? wave.duration * (cps > 0 ? cps : 0.5) : 0 };
      }
    }
    return out;
  })();
  cache.set(key, p);
  void p.then((d) => { if (cache.get(key) === p) done.set(key, d); });
  if (cache.size > 300) { const old = cache.keys().next().value as string; cache.delete(old); done.delete(old); }
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
  const sounds = useSoundsVersion(); // sonidos nuevos registrados → las ondas que faltaban
  // datos de cada bloque (async, con caché por código)
  const sig = blocks.map((b) => `${b.bars}\u0000${b.code}`).join('\u0001');
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      for (const b of blocks) {
        const k = keyOf(b.code, b.bars, cps);
        if (staleLoop(k)) { cache.delete(k); done.delete(k); }
      }
      void Promise.all(blocks.map((b) => blockData(b.code, b.bars, cps).then((d) => [`${b.bars}\u0000${b.code}`, d] as const))).then((pairs) => {
        if (alive) setData(Object.fromEntries(pairs));
      });
    }, 60);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, cps, sounds]);

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
        if (d.fig.kind === 'loop' && d.pieces) {
          g.globalAlpha = 0.85 * base;
          for (const s of d.pieces) {
            const lw = d.waves?.[s.snd];
            const sx = ox + s.t * px;
            if (!lw?.wave) {
              // sin onda (el sample no existe o no se pudo leer): una barra por vuelta
              const bw2 = Math.min(s.d, d.n - s.t) * px;
              g.globalAlpha = 0.35 * base;
              if (sx < W && sx + bw2 > 0) g.fillRect(sx, 3, Math.max(2, bw2 - 1), H - 6);
              g.globalAlpha = 0.85 * base;
              continue;
            }
            const pk = lw.wave.peaks;
            const rg = s.region ?? { b: 0, e: 1, rev: false, rate: 1 };
            const segBars = Math.max(1e-3, ((rg.e - rg.b) * (lw.bars || d.n)) / rg.rate); // compases que dura el tramo al sonar
            const len = Math.min(s.d, segBars - s.off, d.n - s.t); // lo que suena de esta vuelta dentro del bloque
            if (len <= 0) continue;
            const x1 = Math.max(0, sx);
            const x2 = Math.min(W, sx + len * px);
            for (let x = x1; x < x2; x += 1) {
              const f = ((x - sx) / px + s.off) / segBars;
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
