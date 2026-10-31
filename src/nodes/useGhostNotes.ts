import { useEffect, useMemo, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { previewPattern, eventsOf } from '../audio/patternPreview';

// NOTAS FANTASMA (9.4, y desde 12 también en el piano roll pequeño del nodo): lo que tocan las demás
// pistas en el mismo tramo de la canción, para escribir encima sin chocar. `start` = compás de la
// canción donde empieza lo que se edita (la sección), `cycles` = cuántos compases dura.

export interface Ghost { t: number; d: number; note: number; id: string }

export function useGhostNotes(id: string, on: boolean, start: number, cycles: number): { ghosts: Ghost[]; names: Map<string, string> } {
  const others = useGraphStore((s) => s.nodes
    .filter((n) => n.id !== id && n.data.kind === 'source' && !n.data.mute && !Array.isArray(n.data.transitions) && (n.data.code ?? '').trim())
    .map((n) => `${n.id}\u0000${n.data.name ?? ''}\u0000${n.data.code ?? ''}`)
    .join('\u0001'));
  const names = useMemo(() => new Map((others ? others.split('\u0001') : []).map((x) => { const [a, b] = x.split('\u0000'); return [a, b || a] as const; })), [others]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  useEffect(() => {
    if (!on || !others) { setGhosts([]); return; }
    let alive = true;
    const t = window.setTimeout(async () => {
      const out: Ghost[] = [];
      for (const pair of others.split('\u0001')) {
        const [nid, , c] = pair.split('\u0000');
        const pat = await previewPattern(c);
        if (!pat) continue;
        for (const e of eventsOf(pat, start, start + cycles)) {
          if (e.note == null || out.length >= 1500) continue;
          out.push({ t: e.t, d: e.d, note: Math.round(e.note), id: nid });
        }
      }
      if (alive) setGhosts(out);
    }, 150);
    return () => { alive = false; window.clearTimeout(t); };
  }, [on, others, start, cycles]);
  return { ghosts, names };
}
