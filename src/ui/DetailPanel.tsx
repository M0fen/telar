import { useEffect, useRef } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useDetailStore } from '../store/useDetailStore';
import { useTrackColor } from '../store/useTrackColorStore';
import { StepSeq } from '../nodes/StepSeq';
import { SeqBigContext } from '../nodes/seqBig';
import { ErrorBoundary } from './ErrorBoundary';

// PANEL DE DETALLE (Fase 9.2): abajo, entre los paneles laterales, el editor de la pista elegida en
// grande — el mismo secuenciador del nodo (secciones, variación, rejilla o piano roll) con celdas
// grandes, carriles por paso y herramientas de patrón. Se abre con doble clic en un bloque del DAW,
// con E sobre un bloque o con «abajo» en el nodo; el borde de arriba cambia su alto; Esc lo cierra.
export function DetailPanel() {
  const nodeId = useDetailStore((s) => s.nodeId);
  const arm = useDetailStore((s) => s.arm);
  const nonce = useDetailStore((s) => s.nonce);
  const close = useDetailStore((s) => s.close);
  const setH = useDetailStore((s) => s.setH);
  const node = useGraphStore((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId) : undefined));
  const color = useTrackColor(nodeId ?? '');
  const drag = useRef<{ y0: number; h0: number } | null>(null);
  // si la pista se borra, el panel se cierra
  useEffect(() => { if (nodeId && !node) close(); }, [nodeId, node, close]);
  useEffect(() => {
    if (!nodeId) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('.cm-editor'))) return;
      if (e.key === 'Escape' && document.querySelector('.detail')?.contains(document.activeElement ?? null)) close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [nodeId, close]);
  if (!nodeId || !node) return null;
  const name = (node.data.name ?? '').trim() || node.id;
  return (
    <section className="detail" aria-label={`editor de ${name}`} style={color ? { ['--tc' as string]: color } : undefined}>
      <div
        className="detail-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="alto del panel de detalle"
        title="arrastra para cambiar el alto"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y0: e.clientY, h0: useDetailStore.getState().h }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setH(d.h0 + (d.y0 - e.clientY)); }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      />
      <header className="detail-head">
        <span className="detail-dot" />
        <b className="detail-name">{name}</b>
        <span className="detail-hint">edición en grande · los cambios suenan al instante · Esc cierra</span>
        <button className="detail-x" onClick={close} title="cerrar el editor (Esc)" aria-label="cerrar el editor">×</button>
      </header>
      <div className="detail-body">
        <ErrorBoundary variant="panel" label="editor" onClose={close}>
          <SeqBigContext.Provider value={true}>
            <StepSeq id={node.id} code={node.data.code ?? ''} arm={arm} armNonce={nonce} />
          </SeqBigContext.Provider>
        </ErrorBoundary>
      </div>
    </section>
  );
}
