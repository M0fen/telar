import { useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useGalleryStore } from '../store/useGalleryStore';
import type { ProjectSnapshot } from '../lib/projectStore';
import { DEMOS } from '../lib/demos';
import { buildShareUrl, shortenUrl } from '../lib/share';

// Menú de proyecto: guardar/abrir (.json), galería de proyectos (localStorage),
// copiar el código compilado y limpiar todo. El proyecto además se autoguarda en
// localStorage; esto es para respaldos con nombre y arrancar de cero.

// Snapshot completo del estado actual del mapa (incluye la config del visualizador).
// Guardamos el patch LIMPIO: React Flow añade en caliente measured/width/height/
// selected/dragging que no aportan y que inflan el JSON (y, sobre todo, el enlace
// de "Compartir por URL", donde cada byte cuenta). Sólo lo esencial del grafo.
function currentSnapshot(): Partial<ProjectSnapshot> {
  const s = useGraphStore.getState();
  return {
    nodes: s.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data,
    })),
    edges: s.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    })),
    cps: s.cps,
    beatsPerCycle: s.beatsPerCycle,
    transpose: s.transpose,
    master: s.master,
    mode: s.mode,
    djOrientation: s.djOrientation,
    vizMode: s.vizMode,
    vizHeight: s.vizHeight,
    vizVisible: s.vizVisible,
    vizHeadless: s.vizHeadless,
    vizMilkStyle: s.vizMilkStyle,
  };
}

export function ProjectMenu() {
  const resetProject = useGraphStore((s) => s.resetProject);
  const loadSnapshot = useGraphStore((s) => s.loadSnapshot);
  const gallery = useGalleryStore((s) => s.entries);
  const galSave = useGalleryStore((s) => s.save);
  const galRemove = useGalleryStore((s) => s.remove);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Diálogo de compartir: muestra el enlace en un campo seleccionable (no
  // dependemos solo del portapapeles, que falla tras el await de red).
  const [share, setShare] = useState<{ url: string; short: boolean } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const shareInputRef = useRef<HTMLInputElement | null>(null);

  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(null), 1600);
  };

  const save = () => {
    const blob = new Blob([JSON.stringify(currentSnapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `telar-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setOpen(false);
    flash('proyecto guardado');
  };

  const openFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        loadSnapshot(JSON.parse(await f.text()));
        flash('proyecto cargado');
      } catch {
        flash('archivo inválido');
      }
    };
    input.click();
    setOpen(false);
  };

  // Guarda el mapa actual en la galería (localStorage), pidiendo un nombre.
  const saveToGallery = () => {
    const name = window.prompt('Nombre del proyecto en la galería:', `proyecto ${gallery.length + 1}`);
    if (name == null) return; // cancelado
    galSave(name, currentSnapshot());
    flash('guardado en galería');
  };

  const loadFromGallery = (id: string) => {
    const entry = gallery.find((e) => e.id === id);
    if (!entry) return;
    loadSnapshot(entry.snap);
    setOpen(false);
    flash(`cargado · ${entry.name}`);
  };

  const loadDemo = (id: string) => {
    const demo = DEMOS.find((d) => d.id === id);
    if (!demo) return;
    loadSnapshot(demo.snap);
    setOpen(false);
    flash(`ejemplo · ${demo.title}`);
  };

  const clearAll = () => {
    setOpen(false);
    if (window.confirm('¿Limpiar todo el proyecto? (esto reemplaza el grafo actual)')) {
      resetProject();
      flash('lienzo nuevo');
    }
  };

  const copyCode = async () => {
    setOpen(false);
    const code = useGraphStore.getState().lastCode;
    if (code) {
      try {
        await navigator.clipboard.writeText(code);
        flash('código copiado');
      } catch {
        flash('no se pudo copiar');
      }
    } else flash('nada que copiar');
  };

  const shareUrl = async () => {
    setOpen(false);
    setShare(null);
    setShareBusy(true);
    try {
      // El enlace "largo" lleva el patch entero comprimido en el hash (#p=…):
      // funciona siempre pero mide ~1.3–1.8 KB y los chats lo parten al enviarlo.
      // Lo acortamos con el proxy /api/shorten (da.gd): la redirección conserva el
      // #p=… intacto. Mostramos el resultado en un campo seleccionable (no basta con
      // el portapapeles: writeText tras un await de red puede fallar en silencio).
      const longUrl = await buildShareUrl(currentSnapshot());
      const short = await shortenUrl(longUrl);
      const url = short ?? longUrl;
      setShare({ url, short: !!short });
      // intento de copia automática (best-effort; el campo es el respaldo fiable).
      try {
        await navigator.clipboard.writeText(url);
        flash(short ? 'enlace corto copiado ✓' : 'enlace copiado');
      } catch {
        flash('enlace listo — cópialo del campo');
      }
      // seleccionar el texto para copiar a mano de inmediato.
      setTimeout(() => shareInputRef.current?.select(), 30);
    } catch {
      flash('no se pudo generar el enlace');
    } finally {
      setShareBusy(false);
    }
  };

  // Copia desde el campo visible (con respaldo a execCommand para contextos donde
  // navigator.clipboard no está disponible).
  const copyShare = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      flash('enlace copiado ✓');
    } catch {
      const el = shareInputRef.current;
      if (el) {
        el.select();
        try {
          document.execCommand('copy');
          flash('enlace copiado ✓');
        } catch {
          flash('selecciona y copia (Ctrl+C)');
        }
      }
    }
  };

  return (
    <div className="pm">
      <button className={`pm-btn${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        proyecto ▾
      </button>
      {note && <span className="pm-note">{note}</span>}
      {open && (
        <>
          <div className="pm-backdrop" onClick={() => setOpen(false)} />
          <div className="pm-menu">
            <button onClick={save}>Guardar proyecto<span>.json</span></button>
            <button onClick={openFile}>Abrir proyecto<span>.json</span></button>
            <button onClick={() => void shareUrl()}>Compartir por URL<span>enlace</span></button>
            <button onClick={copyCode}>Copiar código<span>strudel</span></button>
            <div className="pm-sep" />
            <div className="pm-section">ejemplos</div>
            <div className="pm-demos">
              {DEMOS.map((d) => (
                <button key={d.id} className="pm-demo" onClick={() => loadDemo(d.id)} title={d.note}>
                  <span className="pm-demo-title">{d.title}</span>
                  <span className="pm-demo-note">{d.note}</span>
                </button>
              ))}
            </div>
            <div className="pm-sep" />
            <div className="pm-section">galería</div>
            <button onClick={saveToGallery}>Guardar en galería<span>+</span></button>
            {gallery.length > 0 && (
              <div className="pm-gallery">
                {gallery.map((e) => (
                  <div key={e.id} className="pm-gal-item">
                    <button className="pm-gal-load" title={`cargar · ${new Date(e.savedAt).toLocaleString()}`} onClick={() => loadFromGallery(e.id)}>
                      {e.name}
                    </button>
                    <button className="pm-gal-x" title="eliminar de la galería" onClick={() => galRemove(e.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="pm-sep" />
            <button className="danger" onClick={clearAll}>Limpiar todo</button>
          </div>
        </>
      )}
      {shareBusy && <span className="pm-note">generando enlace…</span>}
      {share && (
        <>
          <div className="pm-backdrop" onClick={() => setShare(null)} />
          <div className="pm-share">
            <div className="pm-share-head">
              <span>enlace para compartir</span>
              <button className="pm-share-x" onClick={() => setShare(null)} title="cerrar">×</button>
            </div>
            <div className="pm-share-row">
              <input
                ref={shareInputRef}
                className="pm-share-url"
                readOnly
                value={share.url}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="pm-share-copy" onClick={() => void copyShare()}>copiar</button>
            </div>
            <p className="pm-share-hint">
              {share.short
                ? 'enlace corto: lo abres y se carga el proyecto (sin samples locales).'
                : 'no se pudo acortar (¿sin conexión?); este enlace largo igual funciona.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
