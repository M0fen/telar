// Pulso de señal por el grafo (V1a — "el grafo como señal viva"). Cada onset de hap
// "enciende" su Source; el pulso cae suave y se PROPAGA aguas abajo por la topología
// real (source → fx/transform → out), de modo que la energía viaja por los cables reales
// hacia el Out. Alimenta el glow de cada nodo (variable CSS `--pulse`) y el flujo animado
// de cada cable (`SignalEdge`).
//
// Lo ALIMENTA el bucle de resaltado (`highlight.ts`), que ya consulta el patrón maestro
// cada frame y mapea cada disparo a su nodo — aquí solo mantenemos el nivel, lo hacemos
// caer, lo propagamos por la topología y lo escribimos a los elementos registrados. Todo
// imperativo (DOM/CSS-var), sin re-render de React por frame — mismo patrón que
// `meterEngine`/`highlight`.

const DECAY = 0.86; // caída por frame (~cola visible de 150 ms a 60 fps)
const FLOOR = 0.004; // por debajo de esto, apagado

const pulses = new Map<string, number>(); // pulso de ONSET crudo, solo Sources
const through = new Map<string, number>(); // pulso PROPAGADO por nodo (source→out)
const nodeEls = new Map<string, HTMLElement>(); // glow por nodo
type EdgeReg = { source: string; set: (v: number) => void };
const edgeEls = new Map<string, EdgeReg>(); // flujo por cable

// topología: se fija al cambiar el grafo (no por frame). `upstream` = ids que alimentan
// a cada nodo; `topoOrder` = orden topológico para propagar en una sola pasada.
let upstream = new Map<string, string[]>();
let topoOrder: string[] = [];
let topoSig = '';

let running = false;
let zeroedOnce = false; // evita reescribir 0 en cada frame de silencio

// El bucle no se detiene una vez arrancado (mientras haya nodos en pantalla): en silencio
// hace early-return casi gratis, como meterEngine. `running` evita doble-arranque.
function start() { if (!running) { running = true; requestAnimationFrame(tick); } }

// Un onset del Source `id` lo pone al máximo; el rAF lo hace caer.
export function bumpPulse(id: string): void { pulses.set(id, 1); zeroedOnce = false; start(); }
// Pulso propagado de un nodo (lo usan otros visualizadores si lo necesitan).
export function getPulse(id: string): number { return through.get(id) ?? 0; }

export function registerFlowNode(id: string, el: HTMLElement): void { nodeEls.set(id, el); start(); }
export function unregisterFlowNode(id: string): void { nodeEls.delete(id); }
export function registerFlowEdge(edgeId: string, source: string, set: (v: number) => void): void { edgeEls.set(edgeId, { source, set }); start(); }
export function unregisterFlowEdge(edgeId: string): void { edgeEls.delete(edgeId); }

// Fija la topología del grafo (barato: solo recalcula si cambió la estructura, no al
// arrastrar). Orden topológico por Kahn; si hay ciclo, cae a un orden trivial (el grafo
// nunca compila con ciclo, pero no queremos colgar el bucle).
export function setFlowTopology(nodes: { id: string }[], edges: { source: string; target: string }[]): void {
  const sig = edges.map((e) => e.source + '>' + e.target).sort().join('|') + '#' + nodes.map((n) => n.id).sort().join(',');
  if (sig === topoSig) return;
  topoSig = sig;

  const up = new Map<string, string[]>();
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { up.set(n.id, []); adj.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (!adj.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    up.get(e.target)!.push(e.source);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const q: string[] = [];
  for (const [id, d] of indeg) if (d === 0) q.push(id);
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const t of adj.get(id) ?? []) {
      const d = (indeg.get(t) ?? 1) - 1;
      indeg.set(t, d);
      if (d === 0) q.push(t);
    }
  }
  upstream = up;
  topoOrder = order.length === nodes.length ? order : nodes.map((n) => n.id);
}

function tick() {
  requestAnimationFrame(tick);

  // 1) caída de los pulsos de onset
  for (const [id, v] of pulses) {
    const nv = v * DECAY;
    if (nv < FLOOR) pulses.delete(id); else pulses.set(id, nv);
  }

  // 2) propagación aguas abajo: through[n] = max(pulso propio, pulso de sus entradas)
  through.clear();
  for (const id of topoOrder) {
    let v = pulses.get(id) ?? 0;
    for (const u of upstream.get(id) ?? []) { const uv = through.get(u) ?? 0; if (uv > v) v = uv; }
    if (v >= FLOOR) through.set(id, v);
  }

  // 3) escribir a nodos y cables (si todo está en 0, escribimos 0 UNA vez y paramos)
  if (through.size === 0 && zeroedOnce) return;
  for (const [id, el] of nodeEls) el.style.setProperty('--pulse', (through.get(id) ?? 0).toFixed(3));
  for (const { source, set } of edgeEls.values()) set(through.get(source) ?? 0);
  zeroedOnce = through.size === 0;
}
