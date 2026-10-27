import { create } from 'zustand';
import { useGraphStore, type GNode } from './useGraphStore';
import { trackColors } from '../lib/trackColor';

// COLORES DE LAS PISTAS (Fase 8.5), derivados del grafo: se recalculan solo cuando cambia algo que
// los decide (nombre, color propio o el comienzo del código de un Source), no en cada perilla.
export const useTrackColorStore = create<{ map: Record<string, string> }>(() => ({ map: {} }));

let lastSig = '';
function refresh(nodes: GNode[]): void {
  const src = nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions));
  const sig = src.map((n) => `${n.id}\u0000${n.data.name ?? ''}\u0000${n.data.color ?? ''}\u0000${(n.data.code ?? '').slice(0, 160)}`).join('\u0001');
  if (sig === lastSig) return;
  lastSig = sig;
  useTrackColorStore.setState({ map: trackColors(src.map((n) => ({ id: n.id, name: n.data.name, code: n.data.code, color: n.data.color }))) });
}
refresh(useGraphStore.getState().nodes);
useGraphStore.subscribe((s, p) => { if (s.nodes !== p.nodes) refresh(s.nodes); });

export const useTrackColor = (id: string): string | undefined => useTrackColorStore((s) => s.map[id]);
