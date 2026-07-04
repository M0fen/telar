import { useMemo, useState } from 'react';
import type { NodeKind } from '../graph/types';
import { OPS } from '../graph/ops';
import { URBAN_KITS } from '../graph/instrumentKits';
import { useGraphStore } from '../store/useGraphStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { Downloader } from './Downloader';
import { Recorder } from './Recorder';
import { SampleBrowser } from './SampleBrowser';
import { CloudBank } from './CloudBank';

export interface PaletteDrag {
  kind: NodeKind;
  opId?: string;
}

// Paleta para crear nodos. Los FX/Transform se arrastran: soltarlos SOBRE un
// cable los inserta en vivo, o sobre un nodo fx para reemplazarlo (sensación
// magnética). Las secciones vienen COLAPSADAS: se abren con su cabecera o se
// revelan escribiendo en el buscador (menos ruido visual). (master-prompt §5)
function DragItem({ label, item, hint }: { label: string; item: PaletteDrag; hint?: string }) {
  const setDragItem = useGraphStore((s) => s.setDragItem);
  const setHoverEdge = useGraphStore((s) => s.setHoverEdge);
  return (
    <div
      className={`pal-item pal-${item.kind}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/telar', JSON.stringify(item));
        e.dataTransfer.effectAllowed = 'move';
        setDragItem(item); // habilita el resaltado del cable mientras se arrastra
      }}
      onDragEnd={() => {
        setDragItem(null);
        setHoverEdge(null);
      }}
      title={hint}
    >
      {label}
    </div>
  );
}

// Sección colapsable de la paleta (cabecera con chevron + contador).
function Sec({
  id,
  title,
  count,
  openSet,
  toggle,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  openSet: Record<string, boolean>;
  toggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const open = !!openSet[id];
  return (
    <section className="pal-sec">
      <button className={`pal-sec-head${open ? ' open' : ''}`} onClick={() => toggle(id)}>
        <span className="pal-sec-chev">▸</span>
        <span className="pal-sec-title">{title}</span>
        {count != null && <span className="pal-sec-count">{count}</span>}
      </button>
      {open && <div className="pal-sec-body">{children}</div>}
    </section>
  );
}

export function Palette() {
  const addNode = useGraphStore((s) => s.addNode);
  const addPattern = useGraphStore((s) => s.addPattern);
  const patterns = useLibraryStore((s) => s.patterns);
  const removePattern = useLibraryStore((s) => s.remove);
  const transforms = OPS.filter((o) => o.kind === 'transform');
  const fx = OPS.filter((o) => o.kind === 'fx');
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState('');
  const [openSet, setOpenSet] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpenSet((s) => ({ ...s, [id]: !s[id] }));

  const ql = q.trim().toLowerCase();
  // Resultados de búsqueda: fx + transform + items de kits que casen con el texto.
  const results = useMemo(() => {
    if (!ql) return null;
    const ops = OPS.filter((o) => o.label.toLowerCase().includes(ql) || o.id.toLowerCase().includes(ql));
    const kits = URBAN_KITS.flatMap((g) =>
      g.items
        .filter((it) => it.label.toLowerCase().includes(ql) || it.name.toLowerCase().includes(ql) || g.genre.toLowerCase().includes(ql))
        .map((it) => ({ ...it, genre: g.genre }))
    );
    return { ops, kits };
  }, [ql]);

  return (
    <aside className={`palette${open ? '' : ' collapsed'}`}>
      <button
        className="pal-collapse"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'colapsar paleta' : 'expandir paleta'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'none' : 'rotate(180deg)' }}>
          <polyline points="15 6 9 12 15 18" />
        </svg>
        <span className="pal-collapse-lbl">paleta</span>
      </button>
      {/* el cuerpo se OCULTA con CSS (no se desmonta) para no perder estado de la
          grabadora/descargador al colapsar. */}
      <div className="palette-body">
        <section>
          <h3>nodos</h3>
          <DragItem label="+ source" item={{ kind: 'source' }} hint="patrón / mini-notación" />
          <button className="pal-item pal-out" onClick={() => addNode('out')}>+ out</button>
        </section>

        <input
          className="pal-search"
          value={q}
          placeholder="buscar fx, transform, kit…"
          onChange={(e) => setQ(e.target.value)}
        />

        {results ? (
          // Modo búsqueda: lista plana de coincidencias (revela lo que estaba oculto).
          <section className="pal-results">
            {results.ops.length === 0 && results.kits.length === 0 ? (
              <p className="pal-empty">sin coincidencias</p>
            ) : (
              <>
                {results.ops.length > 0 && (
                  <div className="pal-grid">
                    {results.ops.map((o) => (
                      <DragItem key={o.id} label={o.label} item={{ kind: o.kind, opId: o.id }} hint={`${o.kind} · arrastra al cable`} />
                    ))}
                  </div>
                )}
                {results.kits.map((it) => (
                  <button key={it.label} className="pal-kit-item" title={it.code} onClick={() => addPattern(it.code, it.name)}>
                    {it.label} <span className="pal-kit-tag">{it.genre}</span>
                  </button>
                ))}
              </>
            )}
          </section>
        ) : (
          <>
            <Sec id="fx" title="fx · arrastra al cable" count={fx.length} openSet={openSet} toggle={toggle}>
              <div className="pal-grid">
                {fx.map((o) => (
                  <DragItem key={o.id} label={o.label} item={{ kind: 'fx', opId: o.id }} hint="suelta sobre un cable → inserción en vivo" />
                ))}
              </div>
            </Sec>
            <Sec id="transform" title="transform" count={transforms.length} openSet={openSet} toggle={toggle}>
              <div className="pal-grid">
                {transforms.map((o) => (
                  <DragItem key={o.id} label={o.label} item={{ kind: 'transform', opId: o.id }} hint="arrastra al lienzo o al cable" />
                ))}
              </div>
            </Sec>
            <Sec id="urbano" title="urbano · clic para añadir" openSet={openSet} toggle={toggle}>
              {URBAN_KITS.map((g) => (
                <div key={g.genre} className="pal-kit">
                  <div className="pal-kit-genre">{g.genre}</div>
                  <div className="pal-kit-items">
                    {g.items.map((it) => (
                      <button key={it.label} className="pal-kit-item" title={it.code} onClick={() => addPattern(it.code, it.name)}>
                        {it.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </Sec>
            <Sec id="guardados" title="patrones guardados" count={patterns.length || undefined} openSet={openSet} toggle={toggle}>
              {patterns.length === 0 ? (
                <p className="pal-empty">guarda un source con el disco ▣</p>
              ) : (
                <div className="pal-lib">
                  {patterns.map((p) => (
                    <div key={p.id} className="pal-saved" title={p.code}>
                      <button className="pal-saved-load" onClick={() => addPattern(p.code, p.name)}>
                        {p.name}
                      </button>
                      <button className="pal-saved-x" onClick={() => removePattern(p.id)} title="borrar">×</button>
                    </div>
                  ))}
                </div>
              )}
            </Sec>
          </>
        )}
        <SampleBrowser />
        <CloudBank />
        <Downloader />
        <Recorder />
      </div>
    </aside>
  );
}
