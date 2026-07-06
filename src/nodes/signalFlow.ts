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

import { getBranchMetric, isBranchMeteringOn } from '../audio/branchMeter';

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

// Feature-flags (useVizFlagsStore, vía setFlowEnabled): cuando ambas están off el bucle
// MUERE del todo (no-op real); con una off se saltan SUS escrituras. Por defecto on
// (= producción). No importamos el store aquí para no acoplar; App empuja el estado.
let enNode = true; // nodePulse (glow del nodo)
let enEdge = true; // edgeFlow (SignalEdge)

// El bucle no se detiene mientras haya algo que dibujar y alguna feature activa; en
// silencio hace early-return casi gratis. `running` evita doble-arranque.
function start() { if (!running) { running = true; requestAnimationFrame(tick); } }

export function setFlowEnabled(nodePulse: boolean, edgeFlow: boolean): void {
  // al APAGAR un canal, resetea sus elementos a 0 UNA vez (no queda nada encendido)
  try {
    if (enNode && !nodePulse) for (const el of nodeEls.values()) el.style.setProperty('--pulse', '0');
    if (enEdge && !edgeFlow) for (const { set } of edgeEls.values()) set(0);
  } catch { /* defensivo: nunca tumbar por un reset visual */ }
  const bothWereOff = !enNode && !enEdge;
  enNode = nodePulse; enEdge = edgeFlow;
  if (!enNode && !enEdge) { pulses.clear(); through.clear(); zeroedOnce = true; return; } // todo off: nada corre
  if (bothWereOff) { zeroedOnce = false; start(); } // reencender
}

// Un onset del Source `id` lo pone al máximo; el rAF lo hace caer. Con todo apagado ni
// siquiera acumulamos (coste cero).
export function bumpPulse(id: string): void {
  if (!enNode && !enEdge) return;
  pulses.set(id, 1); zeroedOnce = false; start();
}
// Pulso propagado de un nodo (lo usan otros visualizadores si lo necesitan).
export function getPulse(id: string): number { return through.get(id) ?? 0; }

export function registerFlowNode(id: string, el: HTMLElement): void { nodeEls.set(id, el); if (enNode || enEdge) start(); }
export function unregisterFlowNode(id: string): void { nodeEls.delete(id); }
export function registerFlowEdge(edgeId: string, source: string, set: (v: number) => void): void { edgeEls.set(edgeId, { source, set }); if (enNode || enEdge) start(); }
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
  if (!enNode && !enEdge) { running = false; return; } // ambas features off → el bucle muere
  requestAnimationFrame(tick);

  // 1) caída de los pulsos de onset
  for (const [id, v] of pulses) {
    const nv = v * DECAY;
    if (nv < FLOOR) pulses.delete(id); else pulses.set(id, nv);
  }

  // 2) propagación aguas abajo: through[n] = max(señal propia, señal de sus entradas).
  //    La señal propia de un Source = su pulso de ONSET y, si branchMetering está activo,
  //    su NIVEL real medido (V1b: el grosor del flujo y el glow del nodo siguen lo FUERTE
  //    que suena la rama, no solo el disparo). Sin branchMetering = solo el evento (V1a).
  const measured = isBranchMeteringOn();
  through.clear();
  for (const id of topoOrder) {
    let v = pulses.get(id) ?? 0;
    if (measured) { const bm = getBranchMetric(id); if (bm && bm.level > v) v = bm.level; }
    for (const u of upstream.get(id) ?? []) { const uv = through.get(u) ?? 0; if (uv > v) v = uv; }
    if (v >= FLOOR) through.set(id, v);
  }

  // 3) escribir a nodos y cables (si todo está en 0, escribimos 0 UNA vez y paramos).
  //    Cada canal solo escribe si su flag está activo → apagar uno elimina sus escrituras.
  if (through.size === 0 && zeroedOnce) return;
  if (enNode) for (const [id, el] of nodeEls) el.style.setProperty('--pulse', (through.get(id) ?? 0).toFixed(3));
  if (enEdge) for (const { source, set } of edgeEls.values()) set(through.get(source) ?? 0);
  zeroedOnce = through.size === 0;
}
