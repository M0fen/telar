import { useEffect, useMemo, useRef, useState } from 'react';
import { OPS } from '../../graph/ops';
import { URBAN_KITS } from '../../graph/instrumentKits';
import { useGraphStore } from '../../store/useGraphStore';

// BUSCAR Y AÑADIR EN EL LIENZO: doble clic en un lugar vacío abre esta cajita donde estás. Escribe
// («lpf», «reverb», «trap»…), ↑↓ y Enter. Un Source o un kit entra ahí mismo, conectado al Out; un
// FX/transform entra en el cable más cercano a donde hiciste doble clic (o, si no hay ninguno
// cerca, después de lo elegido / antes del Out), ya puesto en la cadena.

type XY = { x: number; y: number };
interface Entry { key: string; label: string; tag: string; run: () => void }

export function QuickAdd({ at, flow, edgeId, onClose }: { at: XY; flow: XY; edgeId: string | null; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo<Entry[]>(() => {
    const g = () => useGraphStore.getState();
    const out: Entry[] = [{ key: 'source', label: 'source', tag: 'patrón nuevo', run: () => void g().addPattern('s("hh*8")', undefined, undefined, flow) }];
    for (const o of OPS) {
      out.push({
        key: `op-${o.id}`, label: o.label, tag: o.kind === 'fx' ? 'efecto' : 'transform',
        run: () => (edgeId ? g().insertOnEdge(edgeId, o.kind, o.id, flow) : g().addOpChained(o.kind, o.id, flow)),
      });
    }
    for (const k of URBAN_KITS) for (const it of k.items) {
      out.push({ key: `kit-${k.genre}-${it.label}`, label: it.label, tag: k.genre, run: () => void g().addPattern(it.code, it.name, undefined, flow) });
    }
    return out;
  }, [flow, edgeId]);
  const ql = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!ql) return entries.slice(0, 10);
    const starts = entries.filter((e) => e.label.toLowerCase().startsWith(ql));
    const rest = entries.filter((e) => !starts.includes(e) && `${e.label} ${e.tag}`.toLowerCase().includes(ql));
    return [...starts, ...rest].slice(0, 12);
  }, [entries, ql]);
  useEffect(() => setI(0), [ql]);
  useEffect(() => { listRef.current?.children[i]?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const pick = (e: Entry | undefined) => { if (!e) return; e.run(); onClose(); };
  // dentro de la ventana: si está cerca del borde, se abre hacia el otro lado
  const left = Math.min(at.x, window.innerWidth - 260);
  const top = Math.min(at.y, window.innerHeight - 330);
  return (
    <div className="qa-backdrop" onMouseDown={onClose}>
      <div className="qa" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="añadir un nodo">
        <input
          autoFocus
          className="qa-in"
          value={q}
          placeholder="añadir: source, lpf, reverb, trap…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(shown[i]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            e.stopPropagation();
          }}
        />
        <div className="qa-list" ref={listRef} role="listbox">
          {shown.length === 0 && <div className="qa-empty">nada con «{q}»</div>}
          {shown.map((e, k) => (
            <button key={e.key} role="option" aria-selected={k === i} className={`qa-item${k === i ? ' on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => pick(e)}>
              <span>{e.label}</span>
              <i>{e.tag}</i>
            </button>
          ))}
        </div>
        <div className="qa-foot">{edgeId ? 'un efecto entra en el cable que tocaste' : 'un efecto entra después de lo elegido (o antes del Out)'} · Esc cierra</div>
      </div>
    </div>
  );
}
