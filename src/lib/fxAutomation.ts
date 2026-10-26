// AUTOMATIZAR LAS PERILLAS DE LOS FX (Fase 7.2): un nodo de FX de una sola perilla numérica (lpf,
// hpf, bpf, room, delay, crush, gain, pan) puede llevar una curva por compás en `data.auto[clave]`;
// el compilador emite su argumento como `signal(…)` en vez del número. En el DAW aparecen en el
// carril A de cada pista que pasa por ese nodo.
import type { Edge } from '@xyflow/react';
import type { NodeData, OpDef } from '../graph/types';
import { OPS_BY_ID } from '../graph/ops';
import { cleanPoints, type AutoPoint } from './automation';

export const AUTOMATABLE_FX = new Set(['lpf', 'hpf', 'bpf', 'room', 'delay', 'crush', 'gain', 'pan']);

export interface FxParam {
  nodeId: string;
  key: string;
  label: string; // «lpf · cutoff Hz»
  min: number;
  max: number;
  scale?: 'exp';
  value: number; // el de la perilla
}

const paramDef = (op: OpDef | undefined, key: string) => op?.params.find((p) => p.key === key && p.kind === 'number');

// la curva limpia de una perilla de FX ([] si no hay o el nodo no es automatizable)
export function fxCurve(data: Pick<NodeData, 'opId' | 'auto'>, key: string): AutoPoint[] {
  if (!data.opId || !AUTOMATABLE_FX.has(data.opId)) return [];
  const d = paramDef(OPS_BY_ID[data.opId], key);
  if (!d || d.min == null || d.max == null) return [];
  return cleanPoints((data.auto as Record<string, unknown> | undefined)?.[key], { min: d.min, max: d.max });
}

// perillas de FX automatizables por las que pasa una pista (desde la pista hacia la salida)
export function fxParamsDownstream(sourceId: string, nodes: { id: string; data: NodeData }[], edges: Pick<Edge, 'source' | 'target'>[]): FxParam[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: FxParam[] = [];
  const seen = new Set<string>([sourceId]);
  const queue = [sourceId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.source !== id || seen.has(e.target)) continue;
      seen.add(e.target);
      queue.push(e.target);
      const n = byId.get(e.target);
      if (!n || n.data.kind !== 'fx' || !n.data.opId || !AUTOMATABLE_FX.has(n.data.opId)) continue;
      const op = OPS_BY_ID[n.data.opId];
      for (const p of op?.params ?? []) {
        if (p.kind !== 'number' || p.min == null || p.max == null) continue;
        out.push({ nodeId: n.id, key: p.key, label: `${op!.label} · ${p.label}`, min: p.min, max: p.max, scale: p.scale === 'exp' ? 'exp' : undefined, value: Number(n.data.params?.[p.key] ?? p.default) });
      }
    }
  }
  return out;
}
