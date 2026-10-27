import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store/useGraphStore';
import { useTrackColor } from '../store/useTrackColorStore';
import { TRACK_COLORS, KIND_LABEL, isHexColor, trackKind } from '../lib/trackColor';

// ELEGIR EL COLOR DE UNA PISTA (Fase 8.5): un botón con el color (en la cabecera del DAW y del
// nodo) abre la paleta; «automático» vuelve al color por tipo. Deshacible (Ctrl+Z). La paleta va en
// un portal al body: dentro del grafo, un `position: fixed` quedaría atado al zoom del lienzo.
export function TrackColorButton({ id, className, title }: { id: string; className?: string; title?: string }) {
  const color = useTrackColor(id);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === id));
  const update = useGraphStore((s) => s.updateNodeData);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setAt(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [at]);
  if (!node) return null;
  const own = isHexColor(node.data.color);
  const kind = trackKind(node.data.name, node.data.code);
  const pick = (c: string | undefined) => { update(id, { color: c }); setAt(null); };
  return (
    <>
      <button
        className={`tcolor-btn nodrag${className ? ` ${className}` : ''}`}
        style={{ background: color }}
        onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setAt(at ? null : { x: r.left, y: r.bottom + 4 }); }}
        onMouseDown={(e) => e.stopPropagation()}
        title={title ?? `color de la pista${own ? '' : ` (automático: ${KIND_LABEL[kind]})`} — clic para cambiarlo`}
        aria-label="color de la pista"
        aria-expanded={!!at}
      />
      {at && createPortal(
        <div
          ref={ref}
          className="tcolor-pop nodrag nowheel"
          role="dialog"
          aria-label="color de la pista"
          style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 196)), top: Math.min(at.y, window.innerHeight - 150) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="tcolor-grid">
            {TRACK_COLORS.map((c) => (
              <button key={c} className={`tcolor-sw${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => pick(c)} aria-label={c} title={c} />
            ))}
          </div>
          <button className={`tcolor-auto${own ? '' : ' on'}`} onClick={() => pick(undefined)} title="el color de su tipo (bombo, bajo, hats…)">
            automático · {KIND_LABEL[kind]}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
