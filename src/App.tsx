import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  SelectionMode,
  type Edge,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore, type GNode } from './store/useGraphStore';
import { useScenesStore } from './store/useScenesStore';
import { tapTempo } from './lib/tapTempo';
import { registerLocalSample } from './audio/engine';
import { sampleDuration, sampleSourceCode } from './lib/audioMeta';
import { readSharedProject, clearShareHash } from './lib/share';
import { nodeTypes } from './nodes/nodeTypes';
import { SignalEdge } from './nodes/SignalEdge';
import { setFlowTopology } from './nodes/signalFlow';
import { Visualizer } from './viz/Visualizer';
import { Transport } from './ui/Transport';
import { Palette, type PaletteDrag } from './ui/Palette';
import { Performance } from './ui/Performance';
import { DjMixer } from './ui/DjMixer';
import { ProjectMenu } from './ui/ProjectMenu';
import { VoiceStudio } from './ui/VoiceStudio';
import { SynthStudio } from './ui/SynthStudio';
import { ClipStudio } from './ui/ClipStudio';
import { StepSequencer } from './ui/StepSequencer';
import { AudioRecorder } from './ui/AudioRecorder';
import { AudioInput } from './ui/AudioInput';
import { ToolsMenu } from './ui/ToolsMenu';
import { NodIa } from './ui/NodIa';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Toaster, DialogHost } from './ui/Notifications';
import { toast } from './store/useNotifyStore';
import { useSequencerStore } from './store/useSequencerStore';
import { useSamplePacksStore } from './store/useSamplePacksStore';
import { useDownloadsStore } from './store/useDownloadsStore';
import { loadSamplePack, registerSample } from './audio/engine';
import { hydrateUserSounds } from './lib/userPacks';
import { setVoiceUrl } from './lib/voiceUrls';
import { tokens } from './theme/tokens';

const MAGNET_RADIUS = 85; // radio del "imán" al cable (px en coords de flujo)

// distancia punto→segmento, para decidir si un drop cae sobre un cable.
function distToSeg(p: XYPosition, a: XYPosition, b: XYPosition): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

// Cables como conducto de señal (V1a). Referencia estable a nivel de módulo (React Flow
// exige que edgeTypes no cambie de identidad entre renders).
const edgeTypes = { signal: SignalEdge };

export default function App() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const addNode = useGraphStore((s) => s.addNode);
  const addPattern = useGraphStore((s) => s.addPattern);
  const insertOnEdge = useGraphStore((s) => s.insertOnEdge);
  const replaceOp = useGraphStore((s) => s.replaceOp);
  const dragItem = useGraphStore((s) => s.dragItem);
  const hoverEdgeId = useGraphStore((s) => s.hoverEdgeId);
  const setDragItem = useGraphStore((s) => s.setDragItem);
  const setHoverEdge = useGraphStore((s) => s.setHoverEdge);
  const mode = useGraphStore((s) => s.mode);
  const setMode = useGraphStore((s) => s.setMode);
  const djOrientation = useGraphStore((s) => s.djOrientation);
  const setDjOrientation = useGraphStore((s) => s.setDjOrientation);
  const vizHeight = useGraphStore((s) => s.vizHeight);
  const vizVisible = useGraphStore((s) => s.vizVisible);
  const setVizVisible = useGraphStore((s) => s.setVizVisible);
  const moveNodesBy = useGraphStore((s) => s.moveNodesBy);
  const loadSnapshot = useGraphStore((s) => s.loadSnapshot);
  const loadNonce = useGraphStore((s) => s.loadNonce);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const duplicateSelected = useGraphStore((s) => s.duplicateSelected);
  const canUndo = useGraphStore((s) => s.past.length > 0);
  const canRedo = useGraphStore((s) => s.future.length > 0);
  const hasSelection = useGraphStore((s) => s.nodes.some((n) => n.selected && n.data.kind !== 'out'));
  const [rightOpen, setRightOpen] = useState(true);
  const rfRef = useRef<ReactFlowInstance<GNode> | null>(null);
  // arrastre del Out: cachea su posición previa + el conjunto aguas arriba.
  const outDrag = useRef<{ x: number; y: number; ids: Set<string> } | null>(null);

  // Todos los nodos que alimentan (transitivamente) a un nodo, vía los cables.
  const upstreamOf = useCallback(
    (targetId: string): Set<string> => {
      const sourcesOf = new Map<string, string[]>();
      for (const e of edges) {
        const arr = sourcesOf.get(e.target) ?? [];
        arr.push(e.source);
        sourcesOf.set(e.target, arr);
      }
      const seen = new Set<string>();
      const stack = [targetId];
      while (stack.length) {
        const id = stack.pop()!;
        for (const src of sourcesOf.get(id) ?? [])
          if (!seen.has(src)) {
            seen.add(src);
            stack.push(src);
          }
      }
      return seen; // excluye el propio nodo
    },
    [edges]
  );

  // Arrastre del Out:
  //   • normal           → mueve SÓLO el Out (reposicionar a gusto, como cualquier nodo).
  //   • Alt + arrastrar  → mueve TODO el grafo aguas arriba como una unidad (mover el patch).
  // (Alt y no Shift: Shift en React Flow activa la selección por rectángulo.)
  const onNodeDragStart = useCallback(
    (e: MouseEvent | TouchEvent, node: GNode) => {
      outDrag.current = null;
      if (node.data.kind !== 'out') return;
      const moveAll = 'altKey' in e && e.altKey; // sólo en ratón; touch = mover sólo el Out
      if (!moveAll) return;
      outDrag.current = { x: node.position.x, y: node.position.y, ids: upstreamOf(node.id) };
    },
    [upstreamOf]
  );
  const onNodeDrag = useCallback(
    (_e: MouseEvent | TouchEvent, node: GNode) => {
      const d = outDrag.current;
      if (node.data.kind !== 'out' || !d) return;
      const dx = node.position.x - d.x;
      const dy = node.position.y - d.y;
      if (!dx && !dy) return;
      d.x = node.position.x;
      d.y = node.position.y;
      moveNodesBy(d.ids, dx, dy);
    },
    [moveNodesBy]
  );
  const onNodeDragStop = useCallback(() => {
    outDrag.current = null;
  }, []);

  // Atajos de teclado para tocar en vivo (sin soltar el ratón del grafo):
  //   espacio  play/stop · M  mute · S  solo · ⎋  quita todos los solos.
  // M/S actúan sobre los nodos seleccionados (varios a la vez). Se ignoran si
  // estás tecleando en un editor/campo (CodeMirror, input, select…).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!(
        t &&
        (t.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
          t.closest('.cm-editor'))
      );
      const st = useGraphStore.getState();
      // Ctrl/Cmd: deshacer (Z) · rehacer (⇧Z / Y) · duplicar (D). Fuera de campos de
      // texto (ahí el navegador maneja su propio deshacer).
      if ((e.metaKey || e.ctrlKey) && !inField) {
        const c = e.key.toLowerCase();
        if (c === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
        if (c === 'y') { e.preventDefault(); st.redo(); return; }
        if (c === 'd') { e.preventDefault(); st.duplicateSelected(); return; }
        if (c === 'c') { st.copySelected(); return; } // no preventDefault: deja copiar texto si no hay selección de nodos
        if (c === 'v') { e.preventDefault(); st.pasteClipboard(); return; }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // con un estudio modal (voz/synth) abierto, sus teclas mandan: no dispares
      // los atajos de una tecla del grafo (evita que 's'/'m' choquen con el teclado).
      if (st.synthEditId || st.voiceEditId || st.clipEditId) return;
      if (inField) return;
      const key = e.key.toLowerCase();
      if (e.key === ' ') {
        e.preventDefault();
        if (st.playing) void st.stop();
        else void st.play();
        return;
      }
      if (key === 'm' || key === 's') {
        const sel = st.nodes.filter((n) => n.selected);
        if (!sel.length) return;
        e.preventDefault();
        if (key === 'm') {
          // mute: alterna sobre la selección (si hay mezcla, los enciende todos).
          const anyOff = sel.some((n) => !n.data.mute);
          for (const n of sel) st.updateNodeData(n.id, { mute: anyOff });
        } else {
          // solo: sólo aplica a sources; alterna igual que el mute.
          const srcs = sel.filter((n) => n.data.kind === 'source');
          if (!srcs.length) return;
          const anyOff = srcs.some((n) => !n.data.solo);
          for (const n of srcs) st.updateNodeData(n.id, { solo: anyOff });
        }
        return;
      }
      if (key === 't') {
        // tap tempo: pulsa al ritmo para fijar el BPM.
        e.preventDefault();
        const c = tapTempo();
        if (c) st.setCpsValue(c);
        return;
      }
      // escenas 1–9 (usamos e.code: independiente del layout y de Shift): dispara,
      // o con Shift captura el estado actual en esa ranura.
      const dm = /^Digit([1-9])$/.exec(e.code);
      if (dm) {
        e.preventDefault();
        const slot = Number(dm[1]);
        const sc = useScenesStore.getState();
        if (e.shiftKey) sc.capture(slot);
        else sc.trigger(slot);
        return;
      }
      if (e.key === 'Escape') {
        // limpia todos los solos del grafo de un golpe.
        const soloed = st.nodes.filter((n) => n.data.solo);
        if (soloed.length) {
          e.preventDefault();
          for (const n of soloed) st.updateNodeData(n.id, { solo: false });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Recarga los packs de sonidos que el usuario cargó en sesiones anteriores +
  // registra el vocal de la demo "Master show" (s("voxmaster")).
  useEffect(() => {
    for (const p of useSamplePacksStore.getState().packs) void loadSamplePack(p);
    void hydrateUserSounds(); // tus samples guardados aparecen en el secuenciador desde el arranque
    void registerSample('voxmaster', '/telar-mastershow-vocal.mp3').catch(() => {});
    // el ESTUDIO DE VOZ saca la onda del registro propio (voiceUrls) — funciona en prod
    // sin depender del servidor de downloads. Se añade también a downloadsStore (legacy).
    setVoiceUrl('voxmaster', '/telar-mastershow-vocal.mp3');
    useDownloadsStore.setState((s) =>
      s.tracks.some((t) => t.name === 'voxmaster')
        ? s
        : { tracks: [{ id: 'voxmaster', name: 'voxmaster', title: 'voz · Master show', file: '/telar-mastershow-vocal.mp3', createdAt: Date.now() }, ...s.tracks] },
    );
  }, []);

  // Manejadores GLOBALES de error: cualquier excepción no capturada o promesa rechazada
  // (audio, WASM, red…) se muestra como toast en vez de fallar en silencio o solo en la
  // consola. Así el sistema SIEMPRE avisa qué pasó ante algo extraordinario.
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      const m = e.message || String(e.error ?? 'error');
      if (/ResizeObserver|Script error/i.test(m)) return; // ruido benigno del navegador
      toast.err('Error inesperado: ' + m.slice(0, 180));
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      const m = r instanceof Error ? r.message : String(r);
      if (/AbortError|The play\(\) request/i.test(m)) return; // benignos (autoplay/abort)
      toast.err('Fallo no controlado: ' + m.slice(0, 180));
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }, []);

  // Tras CARGAR un grafo (demo/proyecto/IA/reset), re-encuadra el lienzo para que el
  // grafo nuevo quede a la vista. Sin esto, ReactFlow conserva el encuadre anterior y
  // los nodos nuevos (p.ej. los de la IA, cerca del origen) podían quedar fuera de
  // pantalla → parecía que "todo se ponía en negro" aunque la música sonaba. Se salta
  // el montaje inicial (nonce 0), que ya lo cubre el prop `fitView`.
  useEffect(() => {
    if (loadNonce === 0) return;
    const t = setTimeout(() => {
      void rfRef.current?.fitView({ padding: 0.2, duration: 400, maxZoom: 1.2 });
    }, 80);
    return () => clearTimeout(t);
  }, [loadNonce]);

  // Al abrir, si la URL trae un proyecto compartido (#p=…), lo carga y limpia el hash.
  useEffect(() => {
    void readSharedProject().then((snap) => {
      if (snap) {
        loadSnapshot(snap);
        clearShareHash();
      }
    });
  }, [loadSnapshot]);

  // Cable más cercano a un punto (en coords de flujo), dentro del radio imán.
  const nearestEdge = useCallback(
    (pos: XYPosition): string | null => {
      const inst = rfRef.current;
      if (!inst) return null;
      const byId = new Map(inst.getNodes().map((n) => [n.id, n]));
      let best: { id: string; d: number } | null = null;
      for (const ed of edges) {
        const s = byId.get(ed.source);
        const t = byId.get(ed.target);
        if (!s || !t) continue;
        const sw = s.measured?.width ?? 180;
        const h = (s.measured?.height ?? 80) / 2;
        const a = { x: s.position.x + sw, y: s.position.y + h };
        const b = { x: t.position.x, y: t.position.y + (t.measured?.height ?? 80) / 2 };
        const d = distToSeg(pos, a, b);
        if (!best || d < best.d) best = { id: ed.id, d };
      }
      return best && best.d < MAGNET_RADIUS ? best.id : null;
    },
    [edges]
  );

  // Nodo fx/transform bajo el puntero (para reemplazo al soltar encima).
  const nodeAt = useCallback((pos: XYPosition): GNode | null => {
    const inst = rfRef.current;
    if (!inst) return null;
    for (const n of inst.getNodes() as GNode[]) {
      if (n.data.kind !== 'fx' && n.data.kind !== 'transform') continue;
      const w = n.measured?.width ?? 180;
      const h = n.measured?.height ?? 80;
      if (pos.x >= n.position.x && pos.x <= n.position.x + w && pos.y >= n.position.y && pos.y <= n.position.y + h)
        return n;
    }
    return null;
  }, []);

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const inst = rfRef.current;
      if (!inst || !dragItem || (dragItem.kind !== 'fx' && dragItem.kind !== 'transform')) {
        setHoverEdge(null);
        return;
      }
      const pos = inst.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // si está sobre un nodo reemplazable, no resaltamos cable (será reemplazo)
      setHoverEdge(nodeAt(pos) ? null : nearestEdge(pos));
    },
    [dragItem, nearestEdge, nodeAt, setHoverEdge]
  );

  // Suelta archivos de audio locales sobre el lienzo → los registra como samples
  // y crea un Source `s("local_…")` por cada uno, en el punto del drop.
  const onDropFiles = useCallback(
    (files: FileList, at: XYPosition) => {
      const audio = Array.from(files).filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|aac|m4a|webm)$/i.test(f.name));
      audio.forEach((f, i) => {
        const base = f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sample';
        const name = `local_${base}`.slice(0, 40);
        // Registrar ANTES de compilar (si no, el 1er compile no encuentra el sample →
        // suena mudo) y medir la duración: un sample LARGO va con loopAt(N) para que no
        // se re-dispare cada ciclo y se solape consigo mismo. Los cortos quedan s("name").
        void (async () => {
          await registerLocalSample(name, f).catch(() => {});
          const cps = useGraphStore.getState().cps || 0.5;
          const dur = await sampleDuration(URL.createObjectURL(f)).catch(() => 0);
          const code = sampleSourceCode(name, dur, cps);
          addPattern(code, base, undefined, { x: at.x - 60 + i * 24, y: at.y - 30 + i * 24 });
        })();
      });
    },
    [addPattern]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setHoverEdge(null);
      setDragItem(null);
      // 0) archivos de audio locales arrastrados desde el sistema
      if (e.dataTransfer.files?.length && rfRef.current) {
        onDropFiles(e.dataTransfer.files, rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        return;
      }
      const raw = e.dataTransfer.getData('application/telar');
      if (!raw || !rfRef.current) return;
      const item = JSON.parse(raw) as PaletteDrag;
      const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });

      if (item.kind === 'fx' || item.kind === 'transform') {
        // 1) soltar encima de un fx/transform existente → reemplazar su operación
        const over = nodeAt(pos);
        if (over && item.opId) {
          replaceOp(over.id, item.opId);
          return;
        }
        // 2) soltar sobre un cable (imán) → inserción en vivo partiendo ese cable
        const edgeId = nearestEdge(pos);
        if (edgeId && item.opId) {
          insertOnEdge(edgeId, item.kind, item.opId, { x: pos.x - 60, y: pos.y - 30 });
          return;
        }
      }
      addNode(item.kind, item.opId, { x: pos.x - 60, y: pos.y - 30 });
    },
    [addNode, insertOnEdge, replaceOp, nearestEdge, nodeAt, setHoverEdge, setDragItem, onDropFiles]
  );

  // Inyecta el resaltado "imán" en el cable destino mientras se arrastra. Todos los
  // cables usan el edge de señal (V1a): la energía viaja por ellos hacia el Out.
  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.map((ed) =>
        ed.id === hoverEdgeId
          ? { ...ed, type: 'signal', className: 'edge-magnet', animated: true, style: { stroke: tokens.accent, strokeWidth: 3 } }
          : { ...ed, type: 'signal' }
      ),
    [edges, hoverEdgeId]
  );

  // V1a: fija la topología del grafo en signalFlow para propagar el pulso source→out.
  // Solo recalcula al cambiar la ESTRUCTURA (no al arrastrar): setFlowTopology compara
  // una firma y sale temprano si no cambió.
  useEffect(() => { setFlowTopology(nodes, edges); }, [nodes, edges]);

  return (
    <div className="app" style={{ background: tokens.bg, ['--viz-h' as string]: `${vizVisible ? vizHeight : 0}px` }}>
      {/* Standard: lienzo de grafo para crear. DJ: canales lado a lado para mezclar.
          El visualizador vive en su pantalla acoplada abajo (bisel Pioneer). */}
      {mode === 'standard' ? (
        <>
          <div className="graph-layer">
            <ReactFlow<GNode>
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onInit={(inst) => (rfRef.current = inst)}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={() => setHoverEdge(null)}
              defaultEdgeOptions={{ animated: true, style: { stroke: tokens.edge, strokeWidth: 1.4 } }}
              proOptions={{ hideAttribution: true }}
              fitView
              minZoom={0.3}
              maxZoom={2}
              /* clic izq (sobre vacío) = seleccionar por área; botón central/derecho =
                 mover el lienzo (panear). Los nodos se siguen arrastrando con clic izq. */
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              panOnDrag={[1, 2]}
              multiSelectionKeyCode="Shift"
            >
              <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color={tokens.grid} />
            </ReactFlow>
          </div>
          <ErrorBoundary variant="panel" label="paleta"><Palette /></ErrorBoundary>
          <ErrorBoundary variant="panel" label="máster"><Performance /></ErrorBoundary>
        </>
      ) : (
        <ErrorBoundary variant="panel" label="modo DJ" onClose={() => setMode('standard')}><DjMixer /></ErrorBoundary>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="logo">Telar</span>
        </div>
        <div className={`topbar-right${rightOpen ? '' : ' collapsed'}`}>
          <button
            className="rt-collapse"
            onClick={() => setRightOpen((o) => !o)}
            title={rightOpen ? 'colapsar menú' : 'expandir menú'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: rightOpen ? 'none' : 'rotate(180deg)' }}>
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          <div className="rt-group">
          {mode === 'standard' && (
            <div className="edit-tools">
              <button className="et-btn" onClick={undo} disabled={!canUndo} title="deshacer (Ctrl+Z)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 7 4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-1" /></svg>
              </button>
              <button className="et-btn" onClick={redo} disabled={!canRedo} title="rehacer (Ctrl+Shift+Z)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7l5 5-5 5" /><path d="M20 12H9a5 5 0 0 0 0 10h1" /></svg>
              </button>
              <button className="et-btn" onClick={duplicateSelected} disabled={!hasSelection} title="duplicar selección (Ctrl+D)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
              </button>
            </div>
          )}
          <div className="mode-switch">
            <div className="seg">
              <button className={mode === 'standard' ? 'on' : ''} onClick={() => setMode('standard')}>standard</button>
              <button className={mode === 'dj' ? 'on' : ''} onClick={() => setMode('dj')}>dj</button>
            </div>
            {mode === 'dj' && (
              <div className="seg sub">
                <button className={djOrientation === 'vertical' ? 'on' : ''} onClick={() => setDjOrientation('vertical')} title="canales verticales">▥</button>
                <button className={djOrientation === 'horizontal' ? 'on' : ''} onClick={() => setDjOrientation('horizontal')} title="canales horizontales">▤</button>
              </div>
            )}
          </div>
          <button
            className={`viz-toggle${vizVisible ? ' on' : ''}`}
            onClick={() => setVizVisible(!vizVisible)}
            title={vizVisible ? 'ocultar pantalla de visualizadores' : 'mostrar pantalla de visualizadores'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="13" rx="1.5" />
              <line x1="8" y1="20" x2="16" y2="20" />
              <line x1="12" y1="17" x2="12" y2="20" />
            </svg>
          </button>
          <AudioInput />
          <AudioRecorder />
          <ErrorBoundary variant="panel" label="herramientas"><ToolsMenu /></ErrorBoundary>
          <ErrorBoundary variant="panel" label="proyecto"><ProjectMenu /></ErrorBoundary>
          </div>
          <Transport />
        </div>
      </header>
      <ErrorBoundary variant="panel" label="visualizador"><Visualizer /></ErrorBoundary>
      <ErrorBoundary variant="panel" label="Nod-IA"><NodIa /></ErrorBoundary>
      <ErrorBoundary variant="panel" label="estudio de voz" onClose={() => useGraphStore.getState().setVoiceEdit(null)}><VoiceStudio /></ErrorBoundary>
      <ErrorBoundary variant="panel" label="estudio de sonido" onClose={() => useGraphStore.getState().setSynthEdit(null)}><SynthStudio /></ErrorBoundary>
      <ErrorBoundary variant="panel" label="clip studio" onClose={() => useGraphStore.getState().setClipEdit(null)}><ClipStudio /></ErrorBoundary>
      <ErrorBoundary variant="panel" label="secuenciador" onClose={() => useSequencerStore.getState().setOpen(false)}><StepSequencer /></ErrorBoundary>
      <Toaster />
      <DialogHost />
    </div>
  );
}
