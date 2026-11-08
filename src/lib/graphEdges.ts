// Ediciones puras de cables del grafo (sin store): reconectar al quitar un nodo del medio y
// detectar ciclos antes de aceptar una conexión.
import type { Edge } from '@xyflow/react';

type NodeKind = { id: string; data: { kind?: string } };

// Al quitar nodos de una cadena, lo que entraba a un FX/transform quitado pasa directo a lo que
// él alimentaba (como insertOnEdge, al revés). Pura: devuelve los cables nuevos (sin duplicados).
export function bridgeEdges(nodes: NodeKind[], edges: Edge[], gone: ReadonlySet<string>): Edge[] {
  const isOp = (id: string) => { const k = nodes.find((n) => n.id === id)?.data.kind; return k === 'fx' || k === 'transform'; };
  const out = [...edges];
  const has = (s: string, t: string) => out.some((e) => e.source === s && e.target === t);
  for (const id of gone) {
    if (!isOp(id)) continue;
    const ins = edges.filter((e) => e.target === id && !gone.has(e.source)).map((e) => e.source);
    const outs = edges.filter((e) => e.source === id && !gone.has(e.target)).map((e) => e.target);
    for (const s of ins) for (const t of outs) if (s !== t && !has(s, t)) out.push({ id: `e_${s}_${t}_${out.length}`, source: s, target: t });
  }
  return out;
}

// ¿Conectar a → b cerraría un ciclo? (b ya llega a a por los cables existentes)
export function wouldCycle(edges: Pick<Edge, 'source' | 'target'>[], a: string, b: string): boolean {
  if (a === b) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  const seen = new Set<string>([b]);
  const stack = [b];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === a) return true;
    for (const y of next.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return false;
}

// ¿Algún Source llega a algún Out por los cables? (si no, no hay nada que pueda sonar)
export function reachesOut(nodes: NodeKind[], edges: Pick<Edge, 'source' | 'target'>[]): boolean {
  const kind = new Map(nodes.map((n) => [n.id, n.data.kind]));
  const prev = new Map<string, string[]>();
  for (const e of edges) prev.set(e.target, [...(prev.get(e.target) ?? []), e.source]);
  const stack = nodes.filter((n) => n.data.kind === 'out').map((n) => n.id);
  const seen = new Set(stack);
  while (stack.length) {
    const x = stack.pop()!;
    if (kind.get(x) === 'source') return true;
    for (const y of prev.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return false;
}
