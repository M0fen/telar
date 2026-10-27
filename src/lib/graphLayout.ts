// ORDEN DEL GRAFO (Fase 8.7) — lógica PURA (testeable en Node).
//
//   · layeredLayout: «ordenar» — columnas por profundidad (fuentes → efectos → salida). Cada nodo
//     va a la altura de quienes lo alimentan (las cadenas quedan en línea) sin pisar al de arriba;
//     las fuentes conservan el orden en que estaban (de arriba abajo).
//   · pushApart: un nodo que crece (se abre su secuenciador, su mezcla) o uno nuevo que cae encima
//     de otro empuja hacia abajo a los que tapa, en cascada. Nada se monta.

export interface LayoutNode {
  id: string;
  kind: string; // 'source' | 'fx' | 'transform' | 'out' | …
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutEdge {
  source: string;
  target: string;
}
export type Positions = Record<string, { x: number; y: number }>;

const COL_GAP = 90;
const ROW_GAP = 22;

export function layeredLayout(nodes: LayoutNode[], edges: LayoutEdge[], origin = { x: 40, y: 40 }): Positions {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    (parents.get(e.target) ?? parents.set(e.target, []).get(e.target)!).push(e.source);
    (children.get(e.source) ?? children.set(e.source, []).get(e.source)!).push(e.target);
  }
  // profundidad = el camino más largo desde una fuente (DAG; con un ciclo raro se corta)
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const dep = (id: string): number => {
    const known = depth.get(id);
    if (known != null) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = parents.get(id) ?? [];
    const d = ps.length ? Math.max(...ps.map(dep)) + 1 : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) dep(n.id);
  // las salidas siempre en la última columna
  const maxD = Math.max(0, ...nodes.filter((n) => n.kind !== 'out').map((n) => depth.get(n.id) ?? 0));
  for (const n of nodes) if (n.kind === 'out') depth.set(n.id, maxD + 1);
  const cols: LayoutNode[][] = [];
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    (cols[d] ??= []).push(n);
  }
  const pos: Positions = {};
  let x = origin.x;
  for (let c = 0; c < cols.length; c++) {
    const col = cols[c] ?? [];
    if (!col.length) continue;
    // orden: las fuentes como estaban; el resto por la altura media de quienes las alimentan
    const want = (n: LayoutNode) => {
      const ps = (parents.get(n.id) ?? []).filter((p) => pos[p]);
      if (!ps.length) return n.y;
      return ps.reduce((a, p) => a + pos[p].y + (byId.get(p)!.h - n.h) / 2, 0) / ps.length;
    };
    const order = c === 0 ? [...col].sort((a, b) => a.y - b.y || a.x - b.x) : [...col].sort((a, b) => want(a) - want(b) || a.y - b.y);
    let cursor = origin.y;
    for (const n of order) {
      const y = c === 0 ? cursor : Math.max(cursor, want(n));
      pos[n.id] = { x, y: Math.round(y) };
      cursor = y + n.h + ROW_GAP;
    }
    x += Math.max(...col.map((n) => n.w)) + COL_GAP;
  }
  return pos;
}

const xOverlap = (a: LayoutNode, b: LayoutNode) => a.x < b.x + b.w - 4 && b.x < a.x + a.w - 4;
const overlap = (a: LayoutNode, b: LayoutNode, gap: number) => xOverlap(a, b) && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

// empuja hacia abajo lo que tapan los nodos `changed` (y en cascada). Devuelve SOLO lo que se movió.
export function pushApart(nodes: LayoutNode[], changed: string[], gap = 14): Positions {
  const cur = new Map(nodes.map((n) => [n.id, { ...n }]));
  const moved: Positions = {};
  const queue = [...new Set(changed)].filter((id) => cur.has(id));
  let guard = nodes.length * nodes.length + 16;
  while (queue.length && guard-- > 0) {
    const a = cur.get(queue.shift()!)!;
    for (const b of cur.values()) {
      if (b.id === a.id || !overlap(a, b, gap - 1)) continue;
      // el de más abajo es el que baja (el que cae justo encima de otro, lo empuja)
      const [top, low] = b.y > a.y || (b.y === a.y && b.id > a.id) ? [a, b] : [b, a];
      const y = Math.round(top.y + top.h + gap);
      if (low.y >= y) continue;
      low.y = y;
      moved[low.id] = { x: low.x, y };
      queue.push(low.id);
    }
  }
  return moved;
}
