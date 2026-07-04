// Campo de nodos audio-reactivo — grafo dirigido por fuerzas (force-directed, al
// estilo d3-force), minimalista y sobrio. UN nodo por SOURCE: los nodos = los
// sonidos presentes. Se REPELEN entre sí (nunca se tocan, mantienen su espacio) y
// una fuerza de cohesión MODULADA POR EL AUDIO los contrae al ritmo y los suelta en
// el silencio → el conjunto respira con la música. Cada golpe da un empujón sutil.
// El nodo es bello por sí mismo: su tamaño/brillo es su propio nivel; los enlaces
// finos tensan con la energía. Canvas2D, O(n²) con n = nº de sources (pequeño).
import { getSourceAnalyser } from '../audio/engine';

const TAU = Math.PI * 2;

interface FNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  disp: number; // nivel mostrado (ataque rápido, caída suave)
  slow: number; // media lenta (para detectar golpes)
  flash: number; // destello/empuje reciente
  hue: number;
  tbuf?: Uint8Array<ArrayBuffer>;
  tuned: boolean;
}

let fnodes: FNode[] = [];
let sig = '';
let lastT = 0;

export function resetNodeField(): void {
  fnodes = [];
  sig = '';
  lastT = 0;
}

function rebuild(ids: string[], W: number, H: number) {
  const n = Math.max(1, ids.length);
  const cx = W / 2;
  const cy = H / 2;
  const rad = Math.min(W, H) * 0.24;
  // conserva posiciones de los nodos que ya existían (evita saltos al añadir/quitar)
  const prev = fnodes;
  fnodes = ids.map((_, i) => {
    const old = prev[i];
    const a = (i / n) * TAU - Math.PI / 2;
    return (
      old ?? {
        x: cx + Math.cos(a) * rad,
        y: cy + Math.sin(a) * rad,
        vx: 0,
        vy: 0,
        disp: 0,
        slow: 0,
        flash: 0,
        hue: 0,
        tuned: false,
      }
    );
  });
  // recolorea (la paleta depende del nº total): cian → azul, sobrio
  fnodes.forEach((nd, i) => (nd.hue = 168 + (i / n) * 46));
}

const hsla = (h: number, s: number, l: number, a: number) => `hsla(${h.toFixed(0)},${s}%,${l}%,${a.toFixed(3)})`;

export function renderNodeField(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, ids: string[]): void {
  const dt = Math.min(0.05, Math.max(0.001, t - lastT));
  lastT = t;
  const fr = Math.min(2, Math.max(0.4, dt * 60));

  if (ids.join(',') !== sig) {
    sig = ids.join(',');
    rebuild(ids, W, H);
  }
  if (!fnodes.length) return;

  // estela tenue y sobria
  ctx.fillStyle = 'rgba(6,9,13,0.32)';
  ctx.fillRect(0, 0, W, H);

  const U = Math.min(W, H);
  const cx = W / 2;
  const cy = H / 2;
  const margin = U * 0.04;

  // --- audio: nivel y golpe por nodo (una lectura por source) ---
  let energy = 0;
  for (let i = 0; i < fnodes.length; i++) {
    const nd = fnodes[i];
    const an = getSourceAnalyser(ids[i]);
    let level = 0;
    if (an) {
      if (!nd.tuned) {
        try {
          an.smoothingTimeConstant = 0.6;
        } catch {
          /* fijo en algunos navegadores */
        }
        nd.tuned = true;
      }
      const fft = an.fftSize;
      if (!nd.tbuf || nd.tbuf.length !== fft) nd.tbuf = new Uint8Array(fft);
      an.getByteTimeDomainData(nd.tbuf);
      let sq = 0;
      for (let k = 0; k < fft; k++) {
        const v = (nd.tbuf[k] - 128) / 128;
        sq += v * v;
      }
      level = Math.min(1, Math.sqrt(sq / fft) * 2.7);
    }
    nd.disp = level > nd.disp ? level : nd.disp * 0.9 + level * 0.1;
    const onset = level - nd.slow;
    nd.slow = nd.slow * 0.85 + level * 0.15;
    if (onset > 0.05 && level > 0.08) {
      nd.flash = Math.min(1, nd.flash + onset * 1.8);
      // empuje sutil hacia afuera del centro en su propio golpe
      const ox = nd.x - cx;
      const oy = nd.y - cy;
      const ol = Math.hypot(ox, oy) || 1;
      nd.vx += (ox / ol) * onset * U * 0.02;
      nd.vy += (oy / ol) * onset * U * 0.02;
    }
    nd.flash *= Math.pow(0.9, fr);
    energy += nd.disp;
  }
  energy /= fnodes.length;

  // --- fuerzas (force-directed): repulsión entre todos + cohesión por energía ---
  const minD = U * 0.045;
  const KR = 0.08; // repulsión (amplía el reposo: los nodos ocupan más el cuadro)
  const cf = 0.003 + energy * 0.018; // cohesión hacia el centro (más fuerte si suena)
  for (let i = 0; i < fnodes.length; i++) {
    const a = fnodes[i];
    // cohesión: el conjunto se contrae al centro con la música, se suelta en silencio
    a.vx += (cx - a.x) * cf * fr;
    a.vy += (cy - a.y) * cf * fr;
    for (let j = i + 1; j < fnodes.length; j++) {
      const b = fnodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d = Math.hypot(dx, dy);
      if (d < 0.001) {
        dx = (Math.random() - 0.5) * 0.1;
        dy = (Math.random() - 0.5) * 0.1;
        d = 0.1;
      }
      const dd = Math.max(d, minD);
      const f = (KR * U) / dd; // magnitud de repulsión (1/d): nunca se tocan
      const ux = dx / d;
      const uy = dy / d;
      a.vx += ux * f * fr;
      a.vy += uy * f * fr;
      b.vx -= ux * f * fr;
      b.vy -= uy * f * fr;
    }
  }

  // integración + amortiguación fuerte (se asienta) + límite + rebote suave
  const maxV = U * 0.05;
  for (const nd of fnodes) {
    nd.vx *= Math.pow(0.8, fr);
    nd.vy *= Math.pow(0.8, fr);
    const sp = Math.hypot(nd.vx, nd.vy);
    if (sp > maxV) {
      nd.vx = (nd.vx / sp) * maxV;
      nd.vy = (nd.vy / sp) * maxV;
    }
    nd.x += nd.vx * fr;
    nd.y += nd.vy * fr;
    if (nd.x < margin) {
      nd.x = margin;
      nd.vx = Math.abs(nd.vx) * 0.5;
    } else if (nd.x > W - margin) {
      nd.x = W - margin;
      nd.vx = -Math.abs(nd.vx) * 0.5;
    }
    if (nd.y < margin) {
      nd.y = margin;
      nd.vy = Math.abs(nd.vy) * 0.5;
    } else if (nd.y > H - margin) {
      nd.y = H - margin;
      nd.vy = -Math.abs(nd.vy) * 0.5;
    }
  }

  // --- enlaces: finos, tensan con la energía combinada ---
  ctx.lineWidth = 0.7;
  const LINK = U * 0.5;
  for (let i = 0; i < fnodes.length; i++) {
    const a = fnodes[i];
    for (let j = i + 1; j < fnodes.length; j++) {
      const b = fnodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > LINK) continue;
      const prox = 1 - d / LINK;
      const lv = (a.disp + b.disp) * 0.5;
      const alpha = prox * (0.05 + lv * 0.22);
      if (alpha < 0.012) continue;
      ctx.strokeStyle = hsla((a.hue + b.hue) * 0.5, 58, 60, alpha);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // --- nodos: el detalle. Núcleo nítido (tamaño/brillo = su nivel) + halo sutil ---
  for (const nd of fnodes) {
    const e = Math.min(1, nd.disp + nd.flash * 0.4);
    const r = U * 0.007 + e * U * 0.011;
    ctx.fillStyle = hsla(nd.hue, 62, 56, 0.04 + e * 0.1);
    ctx.beginPath();
    ctx.arc(nd.x, nd.y, r * 2.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = hsla(nd.hue, 78, 70, 0.16 + e * 0.62);
    ctx.beginPath();
    ctx.arc(nd.x, nd.y, r, 0, TAU);
    ctx.fill();
  }
}
