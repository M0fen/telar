import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import './DawView.css';
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { useScenesStore } from '../store/useScenesStore';
import { buildDawModel, playheadAt, toggleBlockCode, type DawBlock, type DawTrack } from '../lib/dawModel';
import { playSong, playFrom, setRegionLoop } from '../lib/songTransport';
import { timelinePos } from '../lib/songClock';
import { heardCycle } from '../audio/engine';
import { DawSectionBar } from './DawSectionBar';
import { DawBlockMenu } from './DawBlockMenu';
import { DawAutoLane } from './DawAutoLane';
import { DawTransitions } from './DawTransitions';
import { fxParamsDownstream, fxCurve } from '../lib/fxAutomation';
import { DawExport } from './DawExport';
import { useKeepInView } from './useKeepInView';
import { AUTO_RANGE, isActive, cleanAuto, TRACK_PARAMS, MASTER_PARAMS, type AutoParam, type AutoPoint } from '../lib/automation';
import { dawSection, dawBlock, blockVariation, createStructure, createFromTemplate, sceneSections, startJamRecording, stopJamRecording } from '../lib/dawActions';
import { useJamStore } from '../lib/jamRecorder';
import { STRUCTURE_TEMPLATES } from '../lib/arrangeEdit';
import { TrackMeter } from './TrackMeter';
import { GRID_OPTIONS, effectiveGrid, laneBackground, rulerBackground, rulerPlan, type GridId } from '../lib/dawGrid';
import { useDawUiStore } from '../store/useDawUiStore';

// VISTA DAW (Fase 1: vista, línea, bloques, tocar desde un compás · Fase 2: editar la estructura).
// La canción entera de un vistazo. Pistas en filas,
// compases en columnas, secciones arriba. Cada bloque ES un brazo del `arrange([n, patrón])`
// de esa pista (el código manda: buildDawModel lo reconstruye en cada cambio), así que lo
// que ves es lo que suena. Las pistas sin arrange suenan igual en todos los compases.

const ZOOM_KEY = 'telar.daw.zoom';
const ZOOM_MIN = 4; // 8.4: «toda la canción» cabe aunque sea larga
const ZOOM_MAX = 480; // 8.1: con zoom se ven pulsos y semicorcheas
const ZOOM_DEF = 28; // px por compás

function readZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : ZOOM_DEF;
  } catch {
    return ZOOM_DEF;
  }
}

const STATE_TXT: Record<DawBlock['state'], string> = { on: 'suena', off: 'apagada (conserva su patrón)', empty: 'vacía' };

// aviso en el tooltip si la ESCENA de alguna sección silencia este tramo (Fase 2.2)
function sceneMuteNote(t: DawTrack, b: DawBlock): string {
  const m = t.sceneMuted.filter((x) => b.start < x.start + x.bars && x.start < b.start + b.bars);
  return m.length ? `\n⚠ la escena ${[...new Set(m.map((x) => x.scene))].join(', ')} silencia esta pista aquí (la escena es la mezcla de la sección)` : '';
}

// ¿se puede encender/apagar con un clic? (Fase 1.3) — las pistas planas se parten en la Fase 2.
const clickable = (t: DawTrack, b: DawBlock) => !t.plain && b.arm >= 0 && (b.state !== 'empty' || t.seed >= 0);

function blockTitle(t: DawTrack, b: DawBlock): string {
  if (t.plain) return `${t.name} · sin secciones: suena igual en todos los compases\n${b.code.slice(0, 160)}`;
  const rep = b.ghost ? ` · repetición (su arrange dura ${t.bars} compases y vuelve a empezar)` : '';
  const act =
    b.state === 'on' ? 'clic: apagar esta sección (su patrón se conserva)'
    : b.state === 'off' ? 'clic: encender (vuelve tal cual)'
    : t.seed >= 0 ? `clic: entra con el patrón de la sección ${t.seed + 1}`
    : 'vacía y sin patrón en esta pista para sembrarla';
  const also = b.ghost && clickable(t, b) ? ' (cambia también sus repeticiones)' : '';
  return `${t.name} · sección ${b.arm + 1} · ${b.bars} compases · ${STATE_TXT[b.state]}${rep}\n${act}${also}\n${b.code.slice(0, 160)}`;
}

const MASTER_ROW = '__master__'; // clave del carril de automatización del máster (7.2)

export function DawView() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const update = useGraphStore((s) => s.updateNodeData);
  const stop = useGraphStore((s) => s.stop);
  const steps = useSongStore((s) => s.steps);
  const loop = useSongStore((s) => s.loop);
  const songPlaying = useSongStore((s) => s.playing);
  const setLoop = useSongStore((s) => s.setLoop);
  const scenes = useScenesStore((s) => s.scenes);
  const playing = useGraphStore((s) => s.playing);
  const beats = useGraphStore((s) => s.beatsPerCycle) || 4; // tiempos por compás (el 4 de 4/4)
  const grid = useDawUiStore((s) => s.grid);
  const setGrid = useDawUiStore((s) => s.setGrid);
  const follow = useDawUiStore((s) => s.follow);
  const setFollow = useDawUiStore((s) => s.setFollow);
  const [px, setPx] = useState<number>(readZoom);
  const pxRef = useRef(px);
  pxRef.current = px;
  const [secNow, setSecNow] = useState(-1); // sección que suena (resaltada)
  const [sel, setSel] = useState(-1); // sección seleccionada (Fase 2.2: su barra de edición)
  // carriles de automatización abiertos (Fase 3.1): pista → parámetro que se edita
  const [autoOpen, setAutoOpen] = useState<Record<string, string>>({});
  const jamRec = useJamStore((s) => s.recording);
  const jamBars = useJamStore((s) => s.bars);
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLSpanElement>(null);
  useKeepInView(createRef, createOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  const phRulerRef = useRef<HTMLDivElement>(null);
  const phRowsRef = useRef<HTMLDivElement>(null);

  // ZOOM (8.4): siempre anclado — el compás bajo el ratón (o el centro de la vista) se queda donde
  // está. La rueda con Ctrl/⌘ (o el pellizco del trackpad, que llega igual) y los dedos en pantallas
  // táctiles; − + y las teclas − + anclan al centro. El desplazamiento nuevo se aplica tras pintar.
  const pendingScroll = useRef<number | null>(null);
  const userScrollAt = useRef(0); // última vez que TÚ moviste la vista (el seguir espera un poco)
  const nameWOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).getPropertyValue('--daw-name-w')) || 168;
  const zoomTo = (target: number, clientX?: number) => {
    const v = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(target * 10) / 10));
    const cur = pxRef.current;
    if (Math.abs(v - cur) < 0.05) return;
    const body = bodyRef.current;
    if (body) {
      const r = body.getBoundingClientRect();
      const nameW = nameWOf(body);
      const xIn = clientX != null ? Math.max(0, clientX - r.left - nameW) : (body.clientWidth - nameW) / 2;
      const bar = (xIn + body.scrollLeft) / cur;
      pendingScroll.current = Math.max(0, bar * v - xIn);
    }
    pxRef.current = v;
    setPx(v);
    try { localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* sin almacenamiento: solo esta sesión */ }
  };
  const zoom = (dir: 1 | -1) => zoomTo(pxRef.current * (dir > 0 ? 1.25 : 0.8));
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && pendingScroll.current != null) body.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [px]);
  // ZOOM A UN TRAMO: que esos compases llenen la vista (la canción entera, la región o la sección)
  const fitBars = (start: number, bars: number) => {
    const body = bodyRef.current;
    if (!body || bars <= 0) return;
    const vis = body.clientWidth - nameWOf(body) - 24;
    const v = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor((vis / bars) * 10) / 10));
    pendingScroll.current = Math.max(0, start * v - 12);
    userScrollAt.current = performance.now();
    if (Math.abs(v - pxRef.current) < 0.05) { body.scrollLeft = pendingScroll.current; pendingScroll.current = null; return; }
    pxRef.current = v;
    setPx(v);
    try { localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* solo esta sesión */ }
  };

  // Solo lo que cambia el modelo: id, nombre, código, mute y solo de cada pista (mover una
  // perilla de ganancia o un nodo en el lienzo no lo recalcula).
  // la pista de transiciones (7.4) va en su propia fila
  const sources = nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions));
  const outNode = nodes.find((n) => n.data.kind === 'out');
  const srcSig = sources.map((n) => `${n.id}\u0000${n.data.name ?? ''}\u0000${n.data.code ?? ''}\u0000${n.data.mute ? 1 : 0}${n.data.solo ? 1 : 0}`).join('\u0001');
  const model = useMemo(
    () =>
      buildDawModel(
        sources.map((n) => ({ id: n.id, name: n.data.name, code: n.data.code, mute: n.data.mute, solo: n.data.solo })),
        steps,
        (sc) => scenes[sc]?.name ?? `escena ${sc}`,
        (sc) => scenes[sc]?.state,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [srcSig, steps, scenes],
  );

  const { sections, total, tracks, fromSong } = model;

  // la selección sigue siendo válida tras borrar/cargar
  const selIdx = fromSong && sel >= 0 && sel < steps.length ? sel : -1;
  useEffect(() => { if (sel >= 0 && selIdx < 0) setSel(-1); }, [sel, selIdx]);

  // ATAJOS DEL DAW (fase de captura: ganan a los globales del grafo mientras hay una sección
  // seleccionada): Ctrl+D duplicar · Supr borrar · Alt+←/→ mover · ←/→ elegir · Esc soltar.
  useEffect(() => {
    if (selIdx < 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('.cm-editor'))) return;
      const n = useSongStore.getState().steps.length;
      let done = true;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { if (dawSection.duplicate(selIdx)) setSel(selIdx + 1); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (dawSection.remove(selIdx)) setSel(Math.max(0, selIdx - 1)); }
      else if (e.altKey && e.key === 'ArrowLeft') { if (selIdx > 0 && dawSection.move(selIdx, selIdx - 1)) setSel(selIdx - 1); }
      else if (e.altKey && e.key === 'ArrowRight') { if (selIdx < n - 1 && dawSection.move(selIdx, selIdx + 1)) setSel(selIdx + 1); }
      else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft') setSel(Math.max(0, selIdx - 1));
      else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowRight') setSel(Math.min(n - 1, selIdx + 1));
      else if (e.key === 'Escape') setSel(-1);
      else done = false;
      if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selIdx]);

  const needsAlign = fromSong && tracks.some((t) => (t.plain && t.blocks[0]?.code) || t.mismatch);

  // ENCENDER / APAGAR (Fase 1.3): un empalme en el brazo vía updateNodeData → Ctrl+Z lo deshace.
  // Se lee el código del store en el momento del clic (no el del render) para no pisar un
  // cambio que haya llegado entre medias.
  const toggleBlock = (t: DawTrack, b: DawBlock) => {
    if (!clickable(t, b)) return;
    const code = useGraphStore.getState().nodes.find((n) => n.id === t.id)?.data.code ?? '';
    const next = toggleBlockCode(code, b.arm);
    if (next !== null && next !== code) update(t.id, { code: next });
  };

  // MENÚ Y TECLAS DEL BLOQUE (Fase 2.3): clic derecho / mantener pulsado (táctil) = menú;
  // con el bloque enfocado: Enter/Espacio ○/● · Ctrl+C · Ctrl+V · Supr vaciar · E editar.
  // LOOP DE REGIÓN (Fase 2.4): arrastrar sobre los números marca la región; clic sin arrastre
  // = tocar desde ese compás. ⟳ región (o L) la repite.
  const region = useSongStore((s) => s.region);
  const regionOn = useSongStore((s) => s.regionOn);
  const [drag, setDrag] = useState<{ a: number; b: number; x0: number; moved: boolean } | null>(null);
  const onBarsDown = (e: { clientX: number; currentTarget: Element; pointerId: number; button: number }) => {
    if (e.button !== 0) return;
    const a = barAt(e);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ a, b: a, x0: e.clientX, moved: false });
  };
  const onBarsMove = (e: { clientX: number; currentTarget: Element }) => {
    if (!drag) return;
    const b = barAt(e);
    const moved = drag.moved || Math.abs(e.clientX - drag.x0) > 4;
    if (b !== drag.b || moved !== drag.moved) setDrag({ ...drag, b, moved });
  };
  const onBarsUp = () => {
    if (!drag) return;
    if (drag.moved) useSongStore.getState().setRegion({ start: Math.min(drag.a, drag.b), bars: Math.abs(drag.b - drag.a) + 1 });
    else void playFrom(drag.a);
    setDrag(null);
  };
  // LLAVE DE BUCLE (8.4): arriba de la regla; el centro la mueve, los bordes cambian su largo (en
  // compases enteros) y un clic sin arrastrar la activa o la quita (como L). Si está sonando en
  // bucle, el cambio entra sin cortar (recompila).
  const [brace, setBrace] = useState<{ mode: 'move' | 'l' | 'r'; x0: number; start0: number; bars0: number; start: number; bars: number; moved: boolean } | null>(null);
  const braceDown = (e: { button: number; clientX: number; pointerId: number; currentTarget: Element; stopPropagation: () => void }, mode: 'move' | 'l' | 'r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const r = useSongStore.getState().region;
    if (!r) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setBrace({ mode, x0: e.clientX, start0: r.start, bars0: r.bars, start: r.start, bars: r.bars, moved: false });
  };
  const braceMove = (e: { clientX: number }) => {
    if (!brace) return;
    const d = Math.round((e.clientX - brace.x0) / px);
    let { start, bars } = brace;
    if (brace.mode === 'move') start = Math.max(0, Math.min(total - brace.bars0, brace.start0 + d));
    else if (brace.mode === 'l') { start = Math.max(0, Math.min(brace.start0 + brace.bars0 - 1, brace.start0 + d)); bars = brace.start0 + brace.bars0 - start; }
    else bars = Math.max(1, Math.min(total - brace.start0, brace.bars0 + d));
    const moved = brace.moved || Math.abs(e.clientX - brace.x0) > 3;
    if (start !== brace.start || bars !== brace.bars || moved !== brace.moved) setBrace({ ...brace, start, bars, moved });
  };
  const braceUp = () => {
    if (!brace) return;
    const b = brace;
    setBrace(null);
    const song = useSongStore.getState();
    if (b.moved) {
      if (b.start !== b.start0 || b.bars !== b.bars0) {
        song.setRegion({ start: b.start, bars: b.bars });
        if (song.regionOn && useGraphStore.getState().playing) useGraphStore.getState().recompile();
      }
    } else if (b.mode === 'move') void setRegionLoop(!song.regionOn);
  };
  const shownRegion = drag?.moved ? { start: Math.min(drag.a, drag.b), bars: Math.abs(drag.b - drag.a) + 1 } : brace ? { start: brace.start, bars: brace.bars } : region;
  // TECLAS DE LA VISTA (8.4): L bucle · Z zoom a la región/sección (o a toda la canción) · F seguir
  // el cabezal · − + zoom (anclado al centro)
  const keyCtx = useRef({ fitSel: () => {}, zoom: (_d: 1 | -1) => {} });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('.cm-editor'))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'l') {
        const s = useSongStore.getState();
        if (!s.region) return;
        e.preventDefault();
        void setRegionLoop(!s.regionOn);
      } else if (k === 'z') {
        e.preventDefault();
        keyCtx.current.fitSel();
      } else if (k === 'f') {
        e.preventDefault();
        const u = useDawUiStore.getState();
        u.setFollow(!u.follow);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        keyCtx.current.zoom(1);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        keyCtx.current.zoom(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [menu, setMenu] = useState<{ trackId: string; arm: number; start: number; x: number; y: number } | null>(null);
  const openMenu = (t: DawTrack, b: DawBlock, x: number, y: number) => setMenu({ trackId: t.id, arm: b.arm, start: b.start, x, y });
  const longPressed = useRef(false);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLongPress = (e: { pointerType: string; clientX: number; clientY: number }, t: DawTrack, b: DawBlock) => {
    if (e.pointerType !== 'touch') return;
    const { clientX, clientY } = e;
    longPressed.current = false;
    lpTimer.current = setTimeout(() => { longPressed.current = true; openMenu(t, b, clientX, clientY); }, 520);
  };
  const cancelLongPress = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  const onBlockKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; preventDefault: () => void; stopPropagation: () => void; currentTarget: Element }, t: DawTrack, b: DawBlock) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let done = true;
    if (!mod && (e.key === 'Enter' || e.key === ' ')) toggleBlock(t, b);
    else if (mod && k === 'c') dawBlock.copy(t.id, b.arm);
    else if (mod && k === 'v') dawBlock.paste(t.id, b.arm);
    else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) dawBlock.clear(t.id, b.arm);
    else if (!mod && k === 'e') dawBlock.edit(t.id, b.arm);
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const r = e.currentTarget.getBoundingClientRect(); openMenu(t, b, r.left + 8, r.bottom); }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };
  const menuTrack = menu ? tracks.find((x) => x.id === menu.trackId) : undefined;
  const menuBlock = menu && menuTrack ? menuTrack.blocks.find((x) => x.arm === menu.arm && x.start === menu.start) ?? menuTrack.blocks.find((x) => x.arm === menu.arm) : undefined;

  // TOCAR DESDE UN COMPÁS (Fase 1.4): clic en los números = desde ese compás; clic en una
  // sección = desde su primer compás. Reinicia el transporte (como un DAW).
  const barAt = (e: { clientX: number; currentTarget: Element }) =>
    Math.max(0, Math.min(total - 1, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / px)));

  // LÍNEA DE REPRODUCCIÓN: rAF que lee el ciclo del scheduler y mueve DOS elementos (marca en la
  // regla + línea sobre las pistas) con `transform`, sin re-renderizar la rejilla 60×/s. Solo
  // la sección resaltada pasa por React, y solo cuando cambia. Si la línea sale de la vista,
  // el scroll salta para dejarla al 10 % del borde izquierdo (no pelea con tu scroll mientras
  // la tengas a la vista).
  useEffect(() => {
    const marks = [phRulerRef.current, phRowsRef.current];
    if (!playing) {
      for (const m of marks) if (m) m.style.display = 'none';
      setSecNow(-1);
      return;
    }
    for (const m of marks) if (m) m.style.display = '';
    let raf = 0;
    let lastSec = -2;
    const tick = () => {
      // + from: tras «tocar desde aquí» el reloj arrancó en 0 pero suena el compás from + 1
      // en la cuenta previa (8.3) la línea espera en el compás de arranque
      const { pos, section } = playheadAt(Math.max(0, timelinePos(heardCycle(), useSongStore.getState())), total, sections);
      const x = pos * px;
      const t = `translateX(${x}px)`;
      for (const m of marks) if (m) m.style.transform = t;
      if (section !== lastSec) { lastSec = section; setSecNow(section); }
      const body = bodyRef.current;
      // SEGUIR (8.4): pasa de página cuando la línea se sale; espera 2 s si moviste la vista tú
      if (body && useDawUiStore.getState().follow && performance.now() - userScrollAt.current > 2000) {
        const nameW = parseFloat(getComputedStyle(body).getPropertyValue('--daw-name-w')) || 168;
        const vis = body.clientWidth - nameW;
        if (vis > 40 && (x < body.scrollLeft || x > body.scrollLeft + vis * 0.92)) body.scrollLeft = Math.max(0, x - vis * 0.1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, px, sections]);
  // ZOOM A LA SELECCIÓN (Z): la región si hay, si no la sección elegida, si no toda la canción
  const fitSel = () => {
    const r = useSongStore.getState().region;
    if (r) fitBars(r.start, r.bars);
    else if (selIdx >= 0 && sections[selIdx]) fitBars(sections[selIdx].start, sections[selIdx].bars);
    else fitBars(0, total);
  };
  keyCtx.current = { fitSel, zoom };
  // RUEDA Y PELLIZCO (8.4): Ctrl/⌘ + rueda (y el pellizco del trackpad) = zoom donde está el ratón;
  // la rueda sola desplaza (nativo). En pantallas táctiles, dos dedos = zoom.
  const hasBody = tracks.length > 0;
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (e: WheelEvent) => {
      userScrollAt.current = performance.now();
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomTo(pxRef.current * Math.exp(-dy * 0.0025), e.clientX);
    };
    let pinch: { d: number; px: number } | null = null;
    const spread = (t: TouchList) => Math.max(20, Math.abs(t[0].clientX - t[1].clientX));
    const onStart = (e: TouchEvent) => {
      userScrollAt.current = performance.now();
      if (e.touches.length === 2) pinch = { d: spread(e.touches), px: pxRef.current };
    };
    const onMove = (e: TouchEvent) => {
      userScrollAt.current = performance.now();
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      zoomTo((pinch.px * spread(e.touches)) / pinch.d, (e.touches[0].clientX + e.touches[1].clientX) / 2);
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    const onUser = () => { userScrollAt.current = performance.now(); };
    body.addEventListener('wheel', onWheel, { passive: false });
    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onMove, { passive: false });
    body.addEventListener('touchend', onEnd);
    body.addEventListener('touchcancel', onEnd);
    body.addEventListener('pointerdown', onUser);
    return () => {
      body.removeEventListener('wheel', onWheel);
      body.removeEventListener('touchstart', onStart);
      body.removeEventListener('touchmove', onMove);
      body.removeEventListener('touchend', onEnd);
      body.removeEventListener('touchcancel', onEnd);
      body.removeEventListener('pointerdown', onUser);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBody]);
  const width = total * px;
  const mism = tracks.filter((t) => t.mismatch);
  // REGLA Y REJILLA (8.1): compases → pulsos → semicorcheas según el zoom, sombra cada 4 compases
  const plan = rulerPlan(px, beats);
  const gridBg = useMemo(() => laneBackground(px, beats), [px, beats]);
  const rulerBg = useMemo(() => rulerBackground(px, beats), [px, beats]);
  const snap = effectiveGrid(grid, px, beats);
  const rulerLabels = useMemo(() => {
    const out: ReactElement[] = [];
    for (let i = 0; i < total; i++) {
      if (i % plan.labelEvery === 0) out.push(<span key={`b${i}`} className={`daw-barn${i % 4 === 0 ? ' phr' : ''}`} style={{ left: i * px }}>{i + 1}</span>);
      if (plan.beatLabels) for (let q = 1; q < beats; q++) out.push(<span key={`q${i}.${q}`} className="daw-beatn" style={{ left: i * px + (q * px) / beats }}>{i + 1}.{q + 1}</span>);
    }
    return out;
  }, [total, px, beats, plan.labelEvery, plan.beatLabels]);

  return (
    <div className="daw">
      <div className="daw-head">
        {steps.length > 0 ? (
          songPlaying ? (
            <button className="daw-btn on" onClick={() => void stop()} title="detener la canción y el transporte">■ canción</button>
          ) : (
            <button className="daw-btn" onClick={() => void playSong()} title="reproducir la canción desde el compás 1 (escenas e instrumentos juntos)">▶ canción</button>
          )
        ) : null}
        {steps.length > 0 && (
          <button className={`daw-btn${loop ? ' on' : ''}`} onClick={() => setLoop(!loop)} title="repetir la canción al terminar">⟳</button>
        )}
        {region ? (
          <span className="daw-regionctl">
            <button
              className={`daw-btn${regionOn ? ' on' : ''}`}
              onClick={() => void setRegionLoop(!regionOn)}
              title={regionOn ? 'quitar el bucle (L): sigue desde donde iba' : 'repetir la región en bucle, con sus escenas (L)'}
            >
              ⟳ región {region.start + 1}–{region.start + region.bars}
            </button>
            <button className="daw-btn ghost" onClick={() => { if (useSongStore.getState().regionOn) void setRegionLoop(false); useSongStore.getState().setRegion(null); }} title="borrar la región" aria-label="borrar la región">×</button>
          </span>
        ) : null}
        {tracks.length > 0 && (
          jamRec ? (
            <button className="daw-btn rec on" onClick={() => void stopJamRecording()} title="parar la toma y armar la canción con lo que tocaste">■ parar y armar · {jamBars} c.</button>
          ) : (
            <button className="daw-btn rec" onClick={() => void startJamRecording()} title="grabar el jam en la canción: arranca en el compás 1; dispara escenas, silencia/enciende pistas (aquí, en la vista estándar o la DJ, o con el MIDI). Al parar, los compases iguales seguidos forman las secciones y cada pista suena donde sonaba.">● grabar jam</button>
          )
        )}
        <span className="daw-info">
          {total} compases
          {fromSong ? ' · secciones de la canción' : sections.length ? ' · sin canción: secciones del primer arrange' : ''}
        </span>
        {steps.length === 0 && tracks.length > 0 && (
          <span className="daw-create">
            <button className={`daw-btn${createOpen ? ' on' : ''}`} onClick={() => setCreateOpen((o) => !o)} aria-expanded={createOpen} title="convertir este jam de bucles en una canción con secciones (todo suena igual; luego apagas lo que sobra)">
              crear estructura ▾
            </button>
            {createOpen && (
              <span className="daw-menu" role="menu" ref={createRef}>
                {STRUCTURE_TEMPLATES.map((tp) => (
                  <button key={tp.id} role="menuitem" onClick={() => { setCreateOpen(false); createFromTemplate(tp.sections); }}>
                    {tp.label}
                  </button>
                ))}
                {sceneSections().length > 0 && (
                  <button role="menuitem" onClick={() => { setCreateOpen(false); createStructure(sceneSections()); }}>
                    una sección por escena capturada ({sceneSections().length} × 8 compases)
                  </button>
                )}
              </span>
            )}
          </span>
        )}
        {steps.length > 0 && (
          <button className="daw-btn" onClick={() => { if (dawSection.insertEmpty(steps.length - 1, 8)) setSel(steps.length); }} title="añadir al final una sección vacía de 8 compases">+ sección</button>
        )}
        {needsAlign && (
          <button className="daw-btn warn" onClick={() => dawSection.alignAll()} title="alinear las pistas a las secciones de la canción: las planas suenan igual en cada sección; las cortas se completan con silencio">⇋ alinear pistas</button>
        )}
        {mism.length > 0 && (
          <span
            className="daw-warn"
            title={`no duran lo que la línea de tiempo (${total} compases): ${mism.map((t) => `${t.name} ${t.bars}`).join(' · ')}. Sus bloques se repiten desfasados (los ves en la fila). ${fromSong ? '«⇋ alinear pistas» los alinea.' : '«crear estructura ▾» arma la canción y los alinea.'}`}
          >
            ⚠ {mism.length} no cuadra{mism.length > 1 ? 'n' : ''}
          </span>
        )}
        {tracks.length > 0 && (() => {
          // pista en mute (o fuera de los solos) y ninguna escena de la canción cambia la mezcla →
          // su stem sería silencio: se ofrece desmarcada
          const scenesMix = steps.some((st) => { const m = scenes[st.scene]?.state; return !!m && Object.keys(m).length > 0; });
          const stemTracks = tracks.filter((t) => t.blocks.some((b) => b.code)).map((t) => ({ id: t.id, name: t.name, muted: !t.audible, silent: !t.audible && !scenesMix }));
          return <DawExport total={total} fromSong={fromSong} tracks={stemTracks} />;
        })()}
        <label className="daw-gridsel" title={`rejilla magnética: a qué se ajustan los puntos de automatización y las transiciones · ahora: ${snap.label}${grid === 'auto' ? ' (auto: la más fina que se lee con este zoom)' : ''}`}>
          <span>rejilla</span>
          <select value={grid} onChange={(e) => setGrid(e.target.value as GridId)} aria-label="rejilla magnética">
            {GRID_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} title={o.title}>{o.id === 'auto' ? `auto · ${snap.label}` : o.label}</option>
            ))}
          </select>
        </label>
        <button className={`daw-btn tog${follow ? ' on' : ''}`} onClick={() => setFollow(!follow)} aria-pressed={follow} title={follow ? 'la vista sigue al cabezal mientras suena (F para soltarlo)' : 'seguir el cabezal mientras suena (F)'}>
          ⇥ seguir
        </button>
        <span className="daw-zoom">
          <button className="daw-btn" onClick={() => fitBars(0, total)} title="ver toda la canción">⤢</button>
          <button className="daw-btn" onClick={fitSel} disabled={!region && selIdx < 0} title="zoom a la región o a la sección elegida (Z)">⊡</button>
          <button className="daw-btn" onClick={() => zoom(-1)} disabled={px <= ZOOM_MIN} title="alejar (−) · Ctrl + rueda o pellizco: zoom donde está el ratón">−</button>
          <button className="daw-btn" onClick={() => zoom(1)} disabled={px >= ZOOM_MAX} title="acercar (+) · Ctrl + rueda o pellizco: zoom donde está el ratón">+</button>
        </span>
      </div>
      {selIdx >= 0 && (
        <DawSectionBar index={selIdx} steps={steps} scenes={scenes} start={sections[selIdx]?.start ?? 0} onSelect={setSel} />
      )}

      {tracks.length === 0 ? (
        <div className="daw-empty">No hay pistas. Crea sources en la vista standard o carga un ejemplo desde «proyecto».</div>
      ) : (
        <div className="daw-body" ref={bodyRef}>
          <div className="daw-grid" style={{ width: `calc(var(--daw-name-w) + ${width}px)` }}>
            <div className="daw-ruler">
              <div className="daw-corner">{sections.length === 0 ? 'sin secciones' : 'secciones'}</div>
              <div className="daw-ruler-lane" style={{ width }}>
                <div className="daw-ph-mark" ref={phRulerRef} style={{ display: 'none' }} />
                <div
                  className="daw-bars"
                  style={rulerBg}
                  onPointerDown={onBarsDown}
                  onPointerMove={onBarsMove}
                  onPointerUp={onBarsUp}
                  onPointerCancel={() => setDrag(null)}
                  title="clic: tocar desde este compás (■ vuelve al compás 1) · arrastrar: marcar una región para repetirla (⟳ región o L)"
                >
                  {shownRegion && (
                    <div
                      className={`daw-region${regionOn ? ' on' : ''}${drag?.moved ? ' drag' : ''}`}
                      style={{ left: shownRegion.start * px, width: Math.max(2, shownRegion.bars * px) }}
                    />
                  )}
                  {shownRegion && !drag?.moved && (
                    <div
                      className={`daw-loop${regionOn ? ' on' : ''}${brace ? ' drag' : ''}`}
                      style={{ left: shownRegion.start * px, width: Math.max(6, shownRegion.bars * px) }}
                      onPointerDown={(e) => braceDown(e, 'move')}
                      onPointerMove={braceMove}
                      onPointerUp={braceUp}
                      onPointerCancel={() => setBrace(null)}
                      title={`bucle: compases ${shownRegion.start + 1}–${shownRegion.start + shownRegion.bars} (${shownRegion.bars})\nclic: ${regionOn ? 'quitar' : 'activar'} el bucle (L) · arrastrar: moverlo · bordes: cambiar su largo`}
                    >
                      <span className="daw-loop-h l" onPointerDown={(e) => braceDown(e, 'l')} />
                      <span className="daw-loop-h r" onPointerDown={(e) => braceDown(e, 'r')} />
                    </div>
                  )}
                  {rulerLabels}
                </div>
                <div className="daw-secs">
                  {sections.map((s, i) => (
                    <div
                      key={i}
                      className={`daw-sec${i % 2 ? ' alt' : ''}${i === secNow ? ' now' : ''}${i === selIdx ? ' sel' : ''}`}
                      style={{ left: s.start * px, width: Math.max(2, s.bars * px - 1) }}
                      title={`${s.label} · compases ${s.start + 1}–${s.start + s.bars} (${s.bars})${fromSong ? '\nclic: seleccionar para editarla · doble clic: tocar desde aquí' : '\ndoble clic: tocar desde aquí'}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={i === selIdx}
                      onClick={() => { if (fromSong) setSel(i === selIdx ? -1 : i); }}
                      onDoubleClick={() => void playFrom(s.start)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (fromSong) setSel(i); else void playFrom(s.start); } }}
                    >
                      {s.bars * px >= 36 && <span>{s.label}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="daw-rows">
            <div className="daw-ph" ref={phRowsRef} style={{ display: 'none' }} />
            {regionOn && region && (
              <div className="daw-region-rows" style={{ left: `calc(var(--daw-name-w) + ${region.start * px}px)`, width: region.bars * px }} />
            )}
            {tracks.map((t) => (
              <Fragment key={t.id}>
              <div className={`daw-row${t.audible ? '' : ' muted'}`}>
                <div className="daw-tname">
                  <span className="daw-tn" title={t.name}>{t.name}</span>
                  {t.mismatch && <span className="daw-tw" title={`su arrange dura ${t.bars} compases (la línea de tiempo ${total})`}>⚠{t.bars}</span>}
                  <button className={`daw-ms${t.mute ? ' on mute' : ''}`} onClick={() => update(t.id, { mute: !t.mute })} title="mute de la pista">M</button>
                  <button className={`daw-ms${t.solo ? ' on solo' : ''}`} onClick={() => update(t.id, { solo: !t.solo })} title="solo de la pista">S</button>
                  <TrackMeter id={t.id} className="tmeter-daw" />
                  {fromSong && (() => {
                    const au = cleanAuto(sources.find((n) => n.id === t.id)?.data.auto);
                    const has = TRACK_PARAMS.some((p) => isActive(au?.[p], p)) || fxParamsDownstream(t.id, nodes, edges).some((f) => { const fn = nodes.find((n) => n.id === f.nodeId); return !!fn && fxCurve(fn.data, f.key).length > 0; });
                    const open = !!autoOpen[t.id];
                    return (
                      <button
                        className={`daw-ms${open ? ' on' : ''}${has ? ' has' : ''}`}
                        aria-pressed={open}
                        onClick={() => setAutoOpen((o) => { const n = { ...o }; if (n[t.id]) delete n[t.id]; else n[t.id] = TRACK_PARAMS.find((p) => isActive(au?.[p], p)) ?? 'vol'; return n; })}
                        title={`automatización por compás (volumen, filtro, paneo, envíos a la reverb y al eco)${has ? ' · esta pista tiene curvas' : ''}`}
                      >
                        A
                      </button>
                    );
                  })()}
                </div>
                <div className="daw-lane" style={{ width, ...gridBg }}>
                  {t.blocks.map((b, i) => (
                    <div
                      key={i}
                      className={`daw-blk ${b.state}${b.ghost ? ' ghost' : ''}${t.plain ? ' plain' : ''}${clickable(t, b) ? ' click' : ''}`}
                      style={{ left: b.start * px, width: Math.max(2, b.bars * px - 2) }}
                      title={blockTitle(t, b) + sceneMuteNote(t, b) + '\nclic derecho (o mantener pulsado): copiar · pegar · vaciar · editar'}
                      role="button"
                      tabIndex={0}
                      aria-pressed={clickable(t, b) ? b.state === 'on' : undefined}
                      onClick={() => { if (!longPressed.current) toggleBlock(t, b); longPressed.current = false; }}
                      onContextMenu={(e) => { e.preventDefault(); openMenu(t, b, e.clientX, e.clientY); }}
                      onPointerDown={(e) => startLongPress(e, t, b)}
                      onPointerUp={cancelLongPress}
                      onPointerLeave={cancelLongPress}
                      onKeyDown={(e) => onBlockKey(e, t, b)}
                    >
                      {b.bars * px >= 30 && (
                        <span className="daw-blk-l">{t.plain ? 'suena siempre' : b.state === 'empty' ? 'vacía' : b.state === 'off' ? 'apagada' : `${b.arm + 1}`}</span>
                      )}
                      {/* fills de la variación (7.3): el último compás de cada N */}
                      {(() => {
                        const v = b.code ? blockVariation(b.code) : null;
                        if (!v) return null;
                        const marks: number[] = [];
                        for (let k = v.every - 1; k < b.bars && marks.length < 64; k += v.every) marks.push(k);
                        return marks.map((k) => (
                          <span key={k} className="daw-fillmk" style={{ left: (k + (v.half ? 0.5 : 0)) * px, width: Math.max(2, (v.half ? 0.5 : 1) * px - 1) }} title={`fill cada ${v.every} compases${v.half ? ' (media)' : ''}`} />
                        ));
                      })()}
                    </div>
                  ))}
                  {t.sceneMuted.map((m, i) => (
                    <div key={`m${i}`} className="daw-scmute" style={{ left: m.start * px, width: Math.max(2, m.bars * px - 2) }} />
                  ))}
                </div>
              </div>
              {autoOpen[t.id] && (() => {
                const sel = autoOpen[t.id];
                const au = cleanAuto(sources.find((n) => n.id === t.id)?.data.auto);
                // perillas de los FX por los que pasa la pista (7.2): «fx:<nodo>:<perilla>»
                const fxs = fxParamsDownstream(t.id, nodes, edges);
                const fx = sel.startsWith('fx:') ? fxs.find((f) => `fx:${f.nodeId}:${f.key}` === sel) : undefined;
                const param = (fx ? 'vol' : sel) as AutoParam;
                let pts: AutoPoint[];
                let setPts: (next: AutoPoint[]) => void;
                let label: string;
                if (fx) {
                  const fn = nodes.find((n) => n.id === fx.nodeId);
                  pts = fn ? fxCurve(fn.data, fx.key) : [];
                  setPts = (next) => update(fx.nodeId, { auto: { ...(fn?.data.auto ?? {}), [fx.key]: next } });
                  label = fx.label;
                } else {
                  pts = au[param] ?? [];
                  setPts = (next) => update(t.id, { auto: { ...au, [param]: next } });
                  label = AUTO_RANGE[param].label;
                }
                return (
                  <div className="daw-row auto" key={`${t.id}-auto`}>
                    <div className="daw-tname daw-autoname">
                      <select value={fx ? sel : param} onChange={(e) => setAutoOpen((o) => ({ ...o, [t.id]: e.target.value }))} aria-label="parámetro automatizado">
                        {TRACK_PARAMS.map((p) => <option key={p} value={p}>{AUTO_RANGE[p].label}{isActive(au[p], p) ? ' ●' : ''}</option>)}
                        {fxs.length > 0 && (
                          <optgroup label="FX de la pista">
                            {fxs.map((f) => {
                              const fn = nodes.find((n) => n.id === f.nodeId);
                              return <option key={`${f.nodeId}:${f.key}`} value={`fx:${f.nodeId}:${f.key}`}>{f.label}{fn && fxCurve(fn.data, f.key).length ? ' ●' : ''}</option>;
                            })}
                          </optgroup>
                        )}
                      </select>
                      <button className="daw-ms" onClick={() => setPts([])} disabled={!pts.length} title={`borrar la curva de ${label}`}>✕</button>
                    </div>
                    <div className="daw-lane" style={{ width, ...gridBg }}>
                      {fx ? (
                        <DawAutoLane points={pts} range={{ min: fx.min, max: fx.max, neutral: fx.value, label: fx.label, scale: fx.scale, unit: fx.key === 'cutoff' ? 'Hz' : undefined }} total={total} px={px} snap={snap.bars} beats={beats} onChange={setPts} />
                      ) : (
                        <DawAutoLane points={pts} param={param} total={total} px={px} snap={snap.bars} beats={beats} onChange={setPts} />
                      )}
                    </div>
                  </div>
                );
              })()}
            </Fragment>
            ))}
            {fromSong && <DawTransitions total={total} px={px} width={width} gridBg={gridBg} snap={snap.bars} beats={beats} />}
            {fromSong && outNode && (() => {
              // MÁSTER (7.2): filtro DJ, drive, reverb/eco/crush del máster y nivel de los retornos
              const au = cleanAuto(outNode.data.auto);
              const has = MASTER_PARAMS.some((p) => isActive(au[p], p));
              const open = autoOpen[MASTER_ROW];
              const param = (open ?? 'mfilt') as AutoParam;
              const pts: AutoPoint[] = au[param] ?? [];
              const setPts = (next: AutoPoint[]) => update(outNode.id, { auto: { ...au, [param]: next } });
              return (
                <>
                  <div className="daw-row daw-mrow">
                    <div className="daw-tname">
                      <span className="daw-tn" title="automatización del máster: filtro DJ, drive, reverb/eco/crush y nivel de los retornos">máster</span>
                      <button
                        className={`daw-ms${open ? ' on' : ''}${has ? ' has' : ''}`}
                        aria-pressed={!!open}
                        onClick={() => setAutoOpen((o) => { const n = { ...o }; if (n[MASTER_ROW]) delete n[MASTER_ROW]; else n[MASTER_ROW] = MASTER_PARAMS.find((p) => isActive(au[p], p)) ?? 'mfilt'; return n; })}
                        title={`automatización del máster por compás${has ? ' · tiene curvas' : ''}`}
                      >
                        A
                      </button>
                    </div>
                    <div className="daw-lane" style={{ width, ...gridBg }} />
                  </div>
                  {open && (
                    <div className="daw-row auto">
                      <div className="daw-tname daw-autoname">
                        <select value={param} onChange={(e) => setAutoOpen((o) => ({ ...o, [MASTER_ROW]: e.target.value as AutoParam }))} aria-label="parámetro del máster automatizado">
                          {MASTER_PARAMS.map((p) => <option key={p} value={p}>{AUTO_RANGE[p].label}{isActive(au[p], p) ? ' ●' : ''}</option>)}
                        </select>
                        <button className="daw-ms" onClick={() => setPts([])} disabled={!pts.length} title={`borrar la curva de ${AUTO_RANGE[param].label}`}>✕</button>
                      </div>
                      <div className="daw-lane" style={{ width, ...gridBg }}>
                        <DawAutoLane points={pts} param={param} total={total} px={px} snap={snap.bars} beats={beats} onChange={setPts} />
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
            </div>
          </div>
          {menu && menuTrack && menuBlock && (
            <DawBlockMenu
              x={menu.x}
              y={menu.y}
              track={menuTrack}
              block={menuBlock}
              canToggle={clickable(menuTrack, menuBlock)}
              onToggle={() => toggleBlock(menuTrack, menuBlock)}
              onClose={() => setMenu(null)}
            />
          )}
          {sections.length === 0 && (
            <div className="daw-hint">Sin secciones: los instrumentos suenan en bucle. Arma la canción aquí arriba: «crear estructura ▾» (todo suena igual y luego apagas bloques) o «● grabar jam» (se arma con lo que toques).</div>
          )}
        </div>
      )}
    </div>
  );
}
