import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../../store/useGraphStore';
import { useSongStore } from '../../store/useSongStore';
import { useMetroStore } from '../../store/useMetroStore';
import { useDawUiStore } from '../../store/useDawUiStore';
import { useMixerStore } from '../../store/useMixerStore';
import { useDetailStore } from '../../store/useDetailStore';
import { dawSection, createFromTemplate } from '../../lib/dawActions';
import { STRUCTURE_TEMPLATES } from '../../lib/arrangeEdit';
import { playFrom, playSong } from '../../lib/songTransport';
import { newPadTrack } from '../../audio/padRecorder';
import { HelpLine } from './HelpLine';

// ATAJOS Y PALETA DE COMANDOS (Fase 12.1): Ctrl+K busca cualquier acción (escribe y Enter); «?»
// abre la hoja de atajos de teclado. Las acciones se arman al abrir (las secciones y las pistas de
// ahora también son acciones: «ir a drop», «editar bajo», «mezclar hats»…).

interface Cmd { id: string; label: string; group: string; keys?: string; run: () => void; words?: string }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function commands(): Cmd[] {
  const g = useGraphStore.getState();
  const song = useSongStore.getState();
  const metro = useMetroStore.getState();
  const daw = useDawUiStore.getState();
  const out: Cmd[] = [
    { id: 'play', group: 'transporte', label: g.playing ? '■ parar' : '▶ reproducir', keys: 'Espacio', run: () => { if (g.playing) void g.stop(); else void g.play(); } },
    { id: 'song', group: 'transporte', label: '▶ la canción desde el compás 1', run: () => void playSong(), words: 'cancion inicio principio' },
    { id: 'metro', group: 'transporte', label: `metrónomo ${metro.on ? 'apagado' : 'encendido'}`, run: () => metro.setOn(!metro.on), words: 'click clic' },
    { id: 'v-std', group: 'vistas', label: 'vista standard (grafo)', run: () => g.setMode('standard') },
    { id: 'v-dj', group: 'vistas', label: 'vista DJ (mesa)', run: () => g.setMode('dj') },
    { id: 'v-daw', group: 'vistas', label: 'vista DAW (línea de tiempo)', run: () => g.setMode('daw') },
    { id: 'mixer', group: 'vistas', label: 'mezclador', keys: 'X', run: () => useMixerStore.getState().toggle(), words: 'mixer tiras eq compresor' },
    { id: 'viz', group: 'vistas', label: g.vizVisible ? 'plegar el visualizador' : 'mostrar el visualizador', run: () => g.setVizVisible(!g.vizVisible) },
    { id: 'follow', group: 'DAW', label: daw.follow ? 'dejar de seguir el cabezal' : 'seguir el cabezal', keys: 'F', run: () => daw.setFollow(!daw.follow) },
    { id: 'folders', group: 'DAW', label: daw.folders ? 'quitar las carpetas' : 'agrupar pistas en carpetas', run: () => daw.setFolders(!daw.folders) },
    { id: 'undo', group: 'edición', label: 'deshacer', keys: 'Ctrl+Z', run: () => g.undo() },
    { id: 'redo', group: 'edición', label: 'rehacer', keys: 'Ctrl+⇧Z', run: () => g.redo() },
    { id: 'drum', group: 'pistas', label: '＋ pista de batería para grabar con pads', run: () => newPadTrack('drum'), words: 'nueva drums' },
    { id: 'mel', group: 'pistas', label: '＋ pista de melodía para grabar con pads', run: () => newPadTrack('melody'), words: 'nueva teclado' },
  ];
  if (song.steps.length) out.push({ id: 'sec+', group: 'DAW', label: '＋ sección vacía al final (8 compases)', run: () => dawSection.insertEmpty(song.steps.length - 1, 8) });
  else for (const t of STRUCTURE_TEMPLATES) out.push({ id: `tpl-${t.id}`, group: 'DAW', label: `crear estructura: ${t.label}`, run: () => createFromTemplate(t.sections) });
  let acc = 0;
  song.steps.forEach((st, i) => {
    const at = acc;
    acc += st.bars;
    out.push({ id: `go-${st.id}`, group: 'secciones', label: `ir a «${st.name || `sección ${i + 1}`}» (compás ${at + 1})`, run: () => void playFrom(at), words: 'tocar desde' });
  });
  for (const m of song.markers) out.push({ id: `mk-${m.id}`, group: 'marcadores', label: `ir al marcador «${m.name}» (compás ${Math.floor(m.bar) + 1})`, run: () => void playFrom(Math.floor(m.bar)) });
  for (const n of g.nodes) {
    if (n.data.kind !== 'source' || Array.isArray(n.data.transitions)) continue;
    const nm = (n.data.name ?? '').trim() || n.id;
    out.push({ id: `ed-${n.id}`, group: 'pistas', label: `editar «${nm}» en grande`, run: () => { if (g.mode === 'dj') g.setMode('daw'); useDetailStore.getState().open(n.id); } });
    out.push({ id: `mx-${n.id}`, group: 'pistas', label: `mezclar «${nm}» (EQ, compresor, cadena)`, run: () => { if (g.mode === 'dj') g.setMode('daw'); useMixerStore.getState().setOpen(true); useMixerStore.getState().select(n.id, 'eq'); } });
    out.push({ id: `mu-${n.id}`, group: 'pistas', label: `${n.data.mute ? 'quitar mute a' : 'mute a'} «${nm}»`, run: () => g.updateNodeData(n.id, { mute: !n.data.mute }) });
  }
  return out;
}

const SHEET: { area: string; rows: [string, string][] }[] = [
  { area: 'en todas partes', rows: [['Espacio', 'reproducir / parar'], ['Ctrl+Z · Ctrl+⇧Z', 'deshacer · rehacer (⏱ historial: volver a cualquier paso)'], ['Ctrl+K', 'buscar cualquier acción'], ['?', 'esta hoja'], ['X', 'mezclador'], ['1–9 · ⇧1–9', 'disparar · capturar escena'], ['T', 'tap tempo'], ['Esc', 'soltar los solos']] },
  { area: 'DAW', rows: [['F', 'seguir el cabezal'], ['Z', 'zoom a la región o la sección'], ['L', 'bucle de la región'], ['M', 'marcador en el cabezal'], ['− · +', 'zoom (Ctrl+rueda: donde está el ratón)'], ['clic en la regla', 'tocar desde ese compás · arrastrar: región']] },
  { area: 'secciones (con una elegida)', rows: [['Ctrl+D', 'duplicar'], ['Supr', 'borrar'], ['Alt+← →', 'mover'], ['← →', 'elegir otra'], ['Esc', 'soltar']] },
  { area: 'clips', rows: [['arrastrar', 'mover (también a otra pista)'], ['borde derecho', 'estirar (el patrón se repite)'], ['Ctrl+E', 'partir'], ['Ctrl+J', 'unir con el siguiente'], ['Ctrl+D', 'duplicar detrás'], ['Ctrl+C · Ctrl+V', 'copiar · pegar (con su largo)'], ['Supr', 'vaciar'], ['doble clic · E', 'editar en grande'], ['clic', 'encender / apagar']] },
  { area: 'grafo', rows: [['M · S', 'mute · solo de lo elegido'], ['Ctrl+D', 'duplicar lo elegido'], ['Ctrl+C · Ctrl+V', 'copiar · pegar nodos']] },
  { area: 'DJ', rows: [['mute · solo', 'caen en el 1 del compás («al compás»)'], ['🎧', 'cue en los audífonos'], ['🎛 asignar', 'toca un control y mueve el del controlador']] },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.cm-editor'));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSheet(false); setOpen((o) => !o); setQ(''); setSel(0); return; }
      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') { e.preventDefault(); setOpen(false); setSheet((s) => !s); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const all = useMemo(() => (open ? commands() : []), [open]);
  const shown = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((c) => { const hay = norm(`${c.label} ${c.group} ${c.words ?? ''}`); return words.every((w) => hay.includes(w)); });
  }, [all, q]);
  useEffect(() => { listRef.current?.querySelector('.cmd-row.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const run = (c: Cmd | undefined) => { if (!c) return; setOpen(false); window.setTimeout(() => c.run(), 0); };
  return (
    <>
      <HelpLine onSheet={() => setSheet(true)} />
      {open && createPortal(
        <div className="cmd-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="cmd" role="dialog" aria-label="buscar una acción">
            <input className="cmd-in" autoFocus value={q} placeholder="buscar una acción… (mezclador, ir a drop, editar bajo, metrónomo)"
              onChange={(e) => { setQ(e.target.value); setSel(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
                else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }} />
            <div className="cmd-list" ref={listRef} role="listbox">
              {shown.length === 0 && <p className="cmd-empty">nada con «{q}»</p>}
              {shown.slice(0, 80).map((c, i) => (
                <button key={c.id} role="option" aria-selected={i === sel} className={`cmd-row${i === sel ? ' sel' : ''}`} onPointerMove={() => setSel(i)} onClick={() => run(c)}>
                  <span className="cmd-g">{c.group}</span>
                  <span className="cmd-l">{c.label}</span>
                  {c.keys && <kbd>{c.keys}</kbd>}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {sheet && createPortal(
        <div className="cmd-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setSheet(false); }}>
          <div className="cmd sheet" role="dialog" aria-label="atajos de teclado">
            <header className="sheet-h"><b>atajos de teclado</b><button onClick={() => setSheet(false)} aria-label="cerrar">×</button></header>
            <div className="sheet-grid">
              {SHEET.map((s) => (
                <section key={s.area}>
                  <h4>{s.area}</h4>
                  {s.rows.map(([k, v]) => <div key={k} className="sheet-row"><kbd>{k}</kbd><span>{v}</span></div>)}
                </section>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
