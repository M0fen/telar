// Piano tiles por instrumento (estética algorave: _switch_angel / strudel punchcard).
//
// Camino B (sin doble evaluación): una sola consulta por frame al patrón maestro
// vivo sobre una ventana de ciclos [now-BEHIND, now+AHEAD]; cada hap trae
// `context.locations` que mapeamos a su nodo Source (highlight.nodeIdForLoc). Los
// haps se reparten por nodo y cada canvas dibuja sus eventos como tiles que
// avanzan hacia el playhead, encendiéndose cuando suenan. Sincronizado por el
// reloj del scheduler (getScheduler().now() en ciclos).
import { getScheduler, type Hap } from '../audio/engine';
import { nodeIdForLoc } from './highlight';

const BEHIND = 0.5; // ciclos visibles a la izquierda del playhead (pasado)
const AHEAD = 2.5; // ciclos a la derecha (futuro)

// Pianoroll minimalista (estética _switch_angel): puntitos dispersos monocromos,
// nota = punto por tiempo (x) y altura (y). Sin rejilla ni etiqueta.
const NOW = 'rgba(61,240,208,0.95)'; // sonando ahora
const PAST = 'rgba(61,240,208,0.28)'; // ya sonó (se desvanece a la izquierda)
const FUTURE = 'rgba(61,240,208,0.5)'; // por venir
const PLAYHEAD = 'rgba(234,255,251,0.28)';
const IDLE_DOT = 'rgba(61,240,208,0.14)';

const canvases = new Map<string, HTMLCanvasElement>();
let running = false;
let raf = 0;

export function registerTiles(nodeId: string, canvas: HTMLCanvasElement): void {
  canvases.set(nodeId, canvas);
  if (!running) {
    running = true;
    raf = requestAnimationFrame(tick);
  }
}
export function unregisterTiles(nodeId: string): void {
  canvases.delete(nodeId);
  if (canvases.size === 0) {
    running = false;
    cancelAnimationFrame(raf);
  }
}

const NOTE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteToMidi(s: string): number | null {
  const m = /^([a-gA-G])([#sb]?)(-?\d+)?$/.exec(s.trim());
  if (!m) return null;
  let n = NOTE[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === 's') n++;
  else if (m[2] === 'b') n--;
  const oct = m[3] != null ? parseInt(m[3], 10) : 3;
  return n + (oct + 1) * 12;
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
// Fila vertical del tile: nota (pitch) si existe, si no índice de sample, si no
// un hash estable del nombre del sonido (cada percusión en su carril).
function rowOf(h: Hap): number {
  const v = (h as unknown as { value?: Record<string, unknown> }).value ?? {};
  if (typeof v.note === 'number') return v.note;
  if (typeof v.note === 'string') {
    const m = noteToMidi(v.note);
    if (m != null) return m;
  }
  if (typeof v.n === 'number') return 36 + v.n;
  if (typeof v.s === 'string') return hashStr(v.s) % 24;
  return 0;
}

interface Tile {
  begin: number;
  end: number;
  row: number;
}

function draw(canvas: HTMLCanvasElement, tiles: Tile[], now: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const t0 = now - BEHIND;
  const span = BEHIND + AHEAD;
  const x = (t: number) => ((t - t0) / span) * W;

  // rango de filas (autorange) → mapea pitch/carril al alto del canvas
  let min = Infinity;
  let max = -Infinity;
  for (const t of tiles) {
    if (t.row < min) min = t.row;
    if (t.row > max) max = t.row;
  }
  if (!isFinite(min)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = Math.min(4, H * 0.18);
  const dot = Math.max(2, Math.min(3.5, H / 9)); // tamaño del punto
  const y = (r: number) => H - pad - ((r - min) / (max - min)) * (H - 2 * pad);

  // playhead (línea muy tenue)
  const px = x(now);
  ctx.fillStyle = PLAYHEAD;
  ctx.fillRect(px, 0, 1, H);

  // un punto por evento; notas largas → guion corto. Color por pasado/ahora/futuro.
  for (const t of tiles) {
    const playing = now >= t.begin && now < t.end;
    ctx.fillStyle = playing ? NOW : t.begin < now ? PAST : FUTURE;
    const x0 = x(t.begin);
    const w = Math.max(dot, Math.min(x(t.end) - x0, W)); // dura más → guion
    const cy = y(t.row);
    if (w <= dot * 1.4) {
      // punto redondo
      ctx.beginPath();
      ctx.arc(x0 + dot / 2, cy, dot / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // guion redondeado (nota sostenida)
      const r = dot / 2;
      ctx.beginPath();
      ctx.roundRect(x0, cy - r, w, dot, r);
      ctx.fill();
    }
  }
}

// Ajusta el buffer del canvas a su tamaño en pantalla (defensa contra 0px en el
// primer layout / StrictMode). Devuelve false si aún no tiene tamaño.
function fit(canvas: HTMLCanvasElement): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor((canvas.clientWidth || 0) * dpr);
  const h = Math.floor((canvas.clientHeight || 0) * dpr);
  if (w === 0 || h === 0) return false;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return true;
}

// En reposo (sin sonar): fila tenue de puntitos a lo largo, monocroma y mínima,
// para indicar que el pianoroll está activo sin saturar.
function drawIdle(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = IDLE_DOT;
  const r = Math.max(1, Math.min(1.6, H / 18));
  const n = 16;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(((i + 0.5) / n) * W, H / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function tick() {
  raf = requestAnimationFrame(tick);
  const sched = getScheduler();
  const started = !!(sched?.started && sched.pattern);
  const buckets = new Map<string, Tile[]>();
  let now = 0;

  if (started) {
    now = sched!.now();
    try {
      const haps = sched!.pattern!.queryArc(now - BEHIND, now + AHEAD);
      // NO filtramos por hasOnset(): una nota larga (p.ej. pad con .slow(2)) deja de
      // tener su onset dentro de la ventana en cuanto este pasa el playhead, pero
      // SIGUE sonando — hay que dibujarla por su duración real (whole). Como queryArc
      // puede devolver varios fragmentos del mismo evento, deduplicamos.
      const seen = new Set<string>();
      for (const h of haps) {
        const begin = h.whole?.begin;
        const end = h.whole?.end;
        if (begin == null || end == null) continue;
        let nodeId: string | undefined;
        for (const loc of h.context?.locations ?? []) {
          nodeId = nodeIdForLoc(loc.start, loc.end);
          if (nodeId) break;
        }
        if (!nodeId || !canvases.has(nodeId)) continue;
        const row = rowOf(h);
        const key = `${nodeId}|${begin}|${end}|${row}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const arr = buckets.get(nodeId) ?? [];
        arr.push({ begin, end, row });
        buckets.set(nodeId, arr);
      }
    } catch {
      /* el patrón puede fallar al consultar durante un swap: cae a idle */
    }
  }

  for (const [nodeId, canvas] of canvases) {
    if (!fit(canvas)) continue;
    if (started) draw(canvas, buckets.get(nodeId) ?? [], now);
    else drawIdle(canvas);
  }
}
