// Autoguardado del proyecto completo en localStorage (grafo + transporte +
// máster + vista). Misma idea que patternStore: cambiar el backend aquí.
import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '../graph/types';
import type { MasterFx } from '../graph/compile';

export interface ProjectSnapshot {
  nodes: Node<NodeData>[];
  edges: Edge[];
  cps: number;
  beatsPerCycle: number; // tiempos por ciclo ("/4"): conversión BPM↔cps (display)
  transpose: number; // "tono" global en semitonos (transpone note(…))
  master: MasterFx;
  mode: 'standard' | 'dj';
  djOrientation: 'vertical' | 'horizontal';
  vizMode: number;
  vizHeight: number; // alto (px) de la pantalla de visualizadores, redimensionable
  vizVisible: boolean; // contenedor del visualizador mostrado/oculto
  vizHeadless: boolean; // lienzo puro (sin bisel/HUD)
  vizMilkStyle: 'free' | 'telar'; // estilo de los presets milkdrop
}

const KEY = 'telar.project.v1';

export function loadProject(): Partial<ProjectSnapshot> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<ProjectSnapshot>;
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function saveProjectDebounced(s: ProjectSnapshot): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {
      console.warn('projectStore: no se pudo guardar', e);
    }
  }, 500);
}

// Mayor sufijo numérico de los ids cargados, para que nextId no colisione.
export function maxIdCounter(nodes: { id: string }[]): number {
  let max = 0;
  for (const n of nodes) {
    const m = /_(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
