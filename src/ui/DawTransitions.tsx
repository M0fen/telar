import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { dawTransitions } from '../lib/dawActions';
import { TRANS_DEF, cleanTransitions, packTransitions, type TransItem, type TransKind } from '../lib/transitions';

// FILA DE TRANSICIONES del DAW (Fase 7.4): riser, reverso, impacto y barrido a tempo. Clic en la
// fila (también encima de otro) = menú para colocar uno en ese compás (los que suben TERMINAN ahí;
// el impacto EMPIEZA ahí) y, si caíste sobre uno, quitarlo; clic derecho o doble clic sobre uno =
// quitarlo directo. «＋ en cada sección» pone un riser y un impacto en cada cambio de sección.
// Todo es deshacible (Ctrl+Z).
const KIND_ORDER: TransKind[] = ['riser', 'reverse', 'impact', 'sweep'];
const keyOf = (it: TransItem) => `${it.kind}@${it.at}`;

export function DawTransitions({ total, px, width, gridBg }: { total: number; px: number; width: number; gridBg: CSSProperties }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.data.kind === 'source' && Array.isArray(n.data.transitions)));
  const update = useGraphStore((s) => s.updateNodeData);
  const items = cleanTransitions(node?.data.transitions);
  const [pick, setPick] = useState<{ bar: number; x: number; y: number; item?: TransItem } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pick) return;
    const down = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setPick(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPick(null); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [pick]);
  const place = (kind: TransKind, bars: number) => {
    if (!pick) return;
    dawTransitions.add({ kind, at: pick.bar, bars });
    setPick(null);
  };
  const muted = !!node?.data.mute;
  const { placed: packed, rows } = packTransitions(items, total);
  const rowPx = rows <= 2 ? 34 : 8 + rows * 13;
  const subH = (rowPx - 8 - (rows - 1) * 2) / rows;
  return (
    <div className="daw-row daw-trow" style={rows > 2 ? { height: rowPx } : undefined}>
      <div className="daw-tname">
        <span className="daw-tn" title="transiciones a tempo: riser, reverso, impacto y barrido del filtro">transiciones</span>
        {node && <button className={`daw-ms${muted ? ' on mute' : ''}`} onClick={() => update(node.id, { mute: !muted })} title="silenciar las transiciones">M</button>}
        <button className="daw-ms" onClick={() => dawTransitions.auto()} title="un riser de 4 compases que termina en cada cambio de sección y un impacto en su primer compás">＋</button>
        {items.length > 0 && <button className="daw-ms" onClick={() => dawTransitions.clear()} title="quitar todas las transiciones (Ctrl+Z lo deshace)">×</button>}
      </div>
      <div
        className="daw-lane daw-tlane"
        style={{ width, ...gridBg }}
        onClick={(e) => {
          const el = (e.target as Element).closest('.daw-titem') as HTMLElement | null;
          const item = el ? items.find((it) => keyOf(it) === el.dataset.k) : undefined;
          const r = e.currentTarget.getBoundingClientRect();
          const bar = Math.max(0, Math.min(total, Math.round((e.clientX - r.left) / px)));
          setPick({ bar, x: e.clientX, y: e.clientY, item });
        }}
        title="clic: poner una transición en este compás"
      >
        {packed.map(({ it, start, end, row }) => {
          // (lo que cae fuera de la canción no suena y no se dibuja)
          const d = TRANS_DEF[it.kind];
          const left = start * px;
          const w = Math.max(6, (end - start) * px - 2);
          return (
            <div
              key={keyOf(it)}
              data-k={keyOf(it)}
              className={`daw-titem ${it.kind}`}
              style={{ left, width: w, top: 4 + row * (subH + 2), height: subH, bottom: 'auto' }}
              title={`${d.label}${it.kind === 'impact' ? '' : ` · ${it.bars} compás${it.bars === 1 ? '' : 'es'}`} · ${it.kind === 'impact' ? 'en' : 'termina en'} el compás ${it.at + 1}\nclic: menú · clic derecho o doble clic: quitar`}
              onContextMenu={(e) => { e.preventDefault(); dawTransitions.remove(it); }}
              onDoubleClick={() => dawTransitions.remove(it)}
            >
              {w >= 34 && subH >= 10 && <span>{d.icon} {d.label}</span>}
            </div>
          );
        })}
      </div>
      {pick && (
        <div className="daw-menu daw-ctx daw-tmenu" ref={menuRef} role="menu" style={{ position: 'fixed', left: Math.min(pick.x, window.innerWidth - 270), top: Math.min(pick.y, window.innerHeight - 220) }}>
          <span className="daw-ctx-h">compás {pick.bar + 1}</span>
          {pick.item && (
            <button role="menuitem" className="daw-tdel" onClick={() => { dawTransitions.remove(pick.item!); setPick(null); }}>
              quitar {TRANS_DEF[pick.item.kind].icon} {TRANS_DEF[pick.item.kind].label}{pick.item.kind === 'impact' ? '' : ` de ${pick.item.bars}c`} <kbd>clic der.</kbd>
            </button>
          )}
          {KIND_ORDER.map((k) => {
            const d = TRANS_DEF[k];
            return (
              <div className="daw-ctx-var" key={k} title={d.title}>
                <span>{d.icon} {d.label}{k === 'impact' ? ' (aquí)' : ' (termina aquí)'}</span>
                {d.lengths.map((n) => (
                  <button key={n} role="menuitem" onClick={() => place(k, n)} disabled={k === 'impact' ? pick.bar >= total : pick.bar - n < 0}>{k === 'impact' ? '＋' : `${n}c`}</button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

