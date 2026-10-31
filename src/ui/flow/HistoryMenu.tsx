import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { useSongStore } from '../../store/useSongStore';
import { describeChange, type Snap } from '../../lib/historyLabel';

// HISTORIAL DE DESHACER VISIBLE (Fase 12.3): la lista de pasos (los últimos 50) con lo que cambió en
// cada uno; clic en uno vuelve a ese momento (y se puede volver adelante, como Ctrl+⇧Z).
export function HistoryMenu() {
  const past = useGraphStore((s) => s.past);
  const future = useGraphStore((s) => s.future);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc); };
  }, [open]);
  // pasos: lo de antes (past) → AHORA → lo deshecho (future). Cada línea dice qué cambió al avanzar.
  const rows = useMemo(() => {
    if (!open) return [];
    const g = useGraphStore.getState();
    const now: Snap = { nodes: g.nodes, edges: g.edges, song: useSongStore.getState().steps };
    const snaps: Snap[] = [
      ...past.map((p) => ({ nodes: p.nodes, edges: p.edges, song: p.extras?.song.steps })),
      now,
      ...future.map((f) => ({ nodes: f.nodes, edges: f.edges, song: f.extras?.song.steps })),
    ];
    const out: { label: string; at: number }[] = [];
    for (let i = 0; i < snaps.length - 1; i++) {
      const a = snaps[i], b = snaps[i + 1];
      out.push({ label: describeChange({ ...a, song: a.song ?? (b.song !== undefined ? b.song : undefined) }, { ...b, song: b.song ?? a.song }), at: i + 1 });
    }
    return out;
  }, [open, past, future]);
  const cur = past.length; // índice del estado actual en la lista de estados
  const go = (target: number) => {
    const g = useGraphStore.getState();
    if (target < cur) for (let k = 0; k < cur - target; k++) g.undo();
    else for (let k = 0; k < target - cur; k++) g.redo();
    setOpen(false);
  };
  return (
    <div className="hist" ref={ref}>
      <button className={`et-btn${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} disabled={!past.length && !future.length} title="historial: todos los pasos, para volver a cualquiera" aria-expanded={open}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
      </button>
      {open && (
        <div className="hist-menu" role="menu">
          <span className="hist-h">historial · clic para volver ahí</span>
          <button role="menuitem" className={cur === 0 ? 'now' : ''} onClick={() => go(0)}>
            <i>0</i> inicio{cur === 0 ? ' · ahora' : ''}
          </button>
          {rows.map((r) => (
            <button key={r.at} role="menuitem" className={`${r.at === cur ? 'now' : ''}${r.at > cur ? ' undone' : ''}`} onClick={() => go(r.at)} title={r.at > cur ? 'deshecho: clic para rehacer hasta aquí' : ''}>
              <i>{r.at}</i> {r.label}{r.at === cur ? ' · ahora' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
