import { create } from 'zustand';
import {
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react';
import type { NodeData, NodeKind } from '../graph/types';
import { OPS_BY_ID, defaultParams } from '../graph/ops';
import { compileGraph, applyMaster, sanitizeMasterFx, type MasterFx } from '../graph/compile';
import { toast } from './useNotifyStore';
import { swapPattern, stopAudio, ensureEngine, ensureAudioReady, setCps, onEngineError, registerWavetables, setMasterBus, setChannelEqs } from '../audio/engine';
import { registerIrReverbs } from '../audio/irReverb';
import { registerUserPacks } from '../lib/userPacks';
import { registerCloudBank } from '../lib/cloudBank';
import { resolveSampleUrl } from '../lib/sampleResolve';
import { sampleDuration } from '../lib/audioMeta';
import { bareSampleName } from '../lib/sampleFit';
import { getLufs } from '../audio/lufsMeter';
import { setSpans, startHighlightLoop } from '../nodes/highlight';
import { loadProject, saveProjectDebounced, maxIdCounter, type ProjectSnapshot } from '../lib/projectStore';
import { registerDownloadedSamples } from './useDownloadsStore';

export type GNode = Node<NodeData>;

// Item que se está arrastrando desde la paleta (para el "imán" al cable).
export interface DragItem {
  kind: NodeKind;
  opId?: string;
}

let idCounter = 0;
const nextId = (k: string) => `${k}_${++idCounter}`;

// Máster por defecto COMPLETO. Toda carga (proyecto/demo/IA/compartido) pasa por aquí
// mezclado con lo que traiga el snapshot: un `master` PARCIAL (p.ej. el que devuelve la
// IA con solo {gain,room,drive}) dejaba campos en undefined → los Knob del máster hacían
// `undefined.toFixed()` y tumbaban la app. Mezclar defaults garantiza todos los campos.
const DEFAULT_MASTER: MasterFx = {
  gain: 1, filter: 0, room: 0, drive: 0, delay: 0, crush: 0,
  swing: 0, humanize: 0, limit: 0, eqLow: 0, eqMid: 0, eqHigh: 0, space: '',
};

// Grafo de ejemplo objetivo (master-prompt §5): s("bd*4") → lpf 800 → Out.
const initialNodes: GNode[] = [
  { id: 'src_0', type: 'source', position: { x: 80, y: 160 }, data: { kind: 'source', code: 's("bd*4")' } },
  { id: 'fx_0', type: 'fx', position: { x: 420, y: 160 }, data: { kind: 'fx', opId: 'lpf', params: { cutoff: 800 } } },
  { id: 'out_0', type: 'out', position: { x: 760, y: 160 }, data: { kind: 'out' } },
];
const initialEdges: Edge[] = [
  { id: 'e0', source: 'src_0', target: 'fx_0' },
  { id: 'e1', source: 'fx_0', target: 'out_0' },
];

// Restaura el último proyecto si existe (autoguardado en localStorage).
const saved = loadProject();
const startNodes: GNode[] = (saved?.nodes as GNode[] | undefined) ?? initialNodes;
const startEdges: Edge[] = saved?.edges ?? initialEdges;
idCounter = maxIdCounter(startNodes); // evita colisiones de id al crear nodos

interface GraphState {
  nodes: GNode[];
  edges: Edge[];
  cps: number;
  // tiempos por ciclo ("/4"): solo afecta la conversión BPM↔cps que ve el usuario
  // (el cps es el valor real). Opcional en la UI; por defecto 4.
  beatsPerCycle: number;
  setBeatsPerCycle: (n: number) => void;
  // "tono" global en semitonos: transpone el material con altura (note(…)).
  transpose: number;
  setTranspose: (n: number) => void;
  // crossfader DJ (0..1): mezcla los decks asignados al lado A (0) y B (1). 0.5 = centro.
  xfader: number;
  setXfader: (n: number) => void;
  // editor de voces DEDICADO (área propia): id del Source que se está editando.
  voiceEditId: string | null;
  setVoiceEdit: (id: string | null) => void;
  // estudio de synth DEDICADO (panel grande): id del Source que se está editando.
  synthEditId: string | null;
  setSynthEdit: (id: string | null) => void;
  // piano roll / clip DEDICADO: id del Source cuyo patrón de notas se edita.
  clipEditId: string | null;
  setClipEdit: (id: string | null) => void;
  playing: boolean;
  initializing: boolean; // cargando AudioWorklets/samples en el primer Play
  compileError: string | null; // error de compilación del grafo (DAG, nodo vacío…)
  runtimeError: string | null; // error de Strudel al evaluar/programar el patrón
  lastCode: string | null;
  // historial deshacer/rehacer (pilas de snapshots del grafo).
  past: { nodes: GNode[]; edges: Edge[] }[];
  future: { nodes: GNode[]; edges: Edge[] }[];
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  // duplica los nodos seleccionados (con sus cables internos) desplazados.
  duplicateSelected: () => void;
  // portapapeles de nodos: copiar la selección y pegarla (varias veces).
  copySelected: () => void;
  pasteClipboard: () => void;
  // arrastre magnético: item en vuelo + cable resaltado como destino de inserción.
  dragItem: DragItem | null;
  hoverEdgeId: string | null;
  // capa de performance: macros maestros aplicados al Out en vivo.
  master: MasterFx;
  setMaster: (patch: Partial<MasterFx>) => void;
  // AUTO-MASTER: mide el LUFS y ajusta cadena de máster (limiter+EQ pulido) + ganancia
  // para dejar la mezcla al objetivo (streaming/club) sin clipear. Requiere estar sonando.
  mastering: boolean;
  autoMaster: (target?: number) => Promise<void>;
  // vistas: 'standard' = grafo para crear; 'dj' = canales lado a lado para mezclar.
  mode: 'standard' | 'dj';
  djOrientation: 'vertical' | 'horizontal';
  djShowCode: boolean; // modo DJ: mostrar los editores de código (off = colapsados)
  setMode: (m: 'standard' | 'dj') => void;
  setDjOrientation: (o: 'vertical' | 'horizontal') => void;
  setDjShowCode: (v: boolean) => void;
  // modo de visualización de las ondas (índice de shader).
  vizMode: number;
  setVizMode: (m: number) => void;
  // alto de la pantalla de visualizadores (px), arrastrable desde el borde.
  vizHeight: number;
  setVizHeight: (h: number) => void;
  // contenedor del visualizador: visible (minimizar=ocultar / menú derecho=mostrar),
  // headless (lienzo puro sin bisel/HUD) y estilo de milkdrop (free | telar).
  vizVisible: boolean;
  vizHeadless: boolean;
  vizMilkStyle: 'free' | 'telar';
  setVizVisible: (v: boolean) => void;
  setVizHeadless: (v: boolean) => void;
  setVizMilkStyle: (s: 'free' | 'telar') => void;
  // crea un Source con código/nombre dados (recall de la biblioteca de patrones).
  // Por defecto lo CONECTA al Out (opts.connectToOut, def true) y recompila para que
  // SUENE al instante — antes quedaba suelto en el lienzo y no se oía (voz IA/sfx).
  // AiSong pasa connectToOut:false porque gestiona su propio grafo/edges.
  addPattern: (code: string, name?: string, extra?: Partial<NodeData>, pos?: { x: number; y: number }, opts?: { connectToOut?: boolean }) => string;
  // congela (bounce) una rama: crea el Source del sample frozen (`s(name).loopAt(cyc)`),
  // lo conecta a cada Out (el stem ya trae los FX) y mutea el original. Devuelve su id.
  commitFreeze: (originalId: string, name: string, cycles: number) => string;
  // inserta un sidechain DUCK entre una fuente (a duckear) y su Out, disparado por otra
  // fuente (el kick). Devuelve el id del nodo sidechain o null si no se pudo. (mezcla IA)
  insertSidechain: (targetId: string, triggerId: string, depth?: number, attack?: number) => string | null;
  // desplaza un conjunto de nodos por (dx,dy). Lo usa el arrastre del Out, que
  // mueve todo su grafo aguas arriba como una unidad.
  moveNodesBy: (ids: string[] | Set<string>, dx: number, dy: number) => void;
  // aplica un mapa nodeId→parche de data (lo usan las escenas) en un solo paso.
  applyNodeStates: (states: Record<string, Partial<NodeData>>) => void;

  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  addNode: (kind: NodeKind, opId?: string, position?: { x: number; y: number }) => void;
  // crea un canal (source) conectado directo al Out — usado por el modo DJ.
  addSourceToOut: () => void;
  updateNodeData: (id: string, patch: Partial<NodeData>) => void;
  removeNode: (id: string) => void;
  // Reemplaza la operación de un nodo fx/transform (params a sus valores por defecto).
  replaceOp: (id: string, opId: string) => void;
  // Inserta un nodo FX/transform partiendo un cable existente (inserción en vivo).
  insertOnEdge: (edgeId: string, kind: NodeKind, opId: string, position: { x: number; y: number }) => void;
  setDragItem: (item: DragItem | null) => void;
  setHoverEdge: (id: string | null) => void;
  setCpsValue: (cps: number) => void;
  play: () => Promise<void>;
  stop: () => Promise<void>;
  // repara sources que son un sample largo pelado (les pone loopAt para que no se solapen).
  autoFitLongSamples: () => Promise<void>;
  recompile: () => void;
  // menú de proyecto: limpiar a un lienzo nuevo / cargar un proyecto importado.
  resetProject: () => void;
  loadSnapshot: (snap: Partial<ProjectSnapshot>) => void;
  // contador que sube en cada carga de grafo (demo/proyecto/IA/reset). La vista lo
  // observa para RE-ENCUADRAR el lienzo (fitView) y que el grafo nuevo se vea siempre
  // — antes quedaba fuera de cuadro y parecía "pantalla en negro" tras generar con IA.
  loadNonce: number;
}

export const useGraphStore = create<GraphState>((set, get) => {
  // Los errores de evaluación de Strudel llegan por callback (no por throw).
  onEngineError((msg) => set({ runtimeError: msg }));

  // Recompila el grafo y, si está sonando, hace hot-swap del patrón maestro.
  // Recompilación incremental ligera: sólo reemitimos al scheduler en marcha,
  // el reloj nunca se detiene. (master-prompt §3, §7)
  // Anti-glitch: el EQ por canal solo se re-churnea cuando las rutas CAMBIAN
  // (setChannelEqs reconstruye filtros + agenda reintentos → caro). El applyChannelEqs
  // que ya corre tras cada swap mantiene el EQ vivo si un orbit se recrea, así que saltar
  // el re-churn cuando las rutas no cambian es seguro.
  let lastEqKey = '';
  const recompile = () => {
    const { nodes, edges, cps, playing, master, transpose, xfader } = get();
    const { code, error, spans, channelEqs } = compileGraph(nodes, edges, { transpose, xfader });
    setSpans(spans); // mapeo de eventos → editores para el resaltado
    const eqKey = JSON.stringify(channelEqs);
    if (eqKey !== lastEqKey) { lastEqKey = eqKey; setChannelEqs(channelEqs); }
    set({ compileError: error, lastCode: code });
    if (playing && code) void swapPattern(applyMaster(code, master), cps);
  };

  // Recompilado THROTTLED (borde inicial + final, ~70 ms): un arrastre de perilla
  // dispara decenas de cambios/seg; re-evaluar el patrón 60×/s satura el hilo principal
  // y hambrea el worklet de audio → clics/cortes. A ~14×/s el barrido sigue fluido y el
  // audio deja de glitchear; el valor FINAL siempre aterriza (borde final). Los cambios
  // estructurales (add/remove/mute) llaman a recompile() directo, sin throttle.
  const SWAP_MIN_MS = 70;
  let swapTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSwapAt = 0;
  const scheduleRecompile = () => {
    if (swapTimer !== undefined) return; // ya hay uno en cola (borde final)
    const since = performance.now() - lastSwapAt;
    if (since >= SWAP_MIN_MS) {
      lastSwapAt = performance.now();
      recompile();
    } else {
      swapTimer = setTimeout(() => {
        swapTimer = undefined;
        lastSwapAt = performance.now();
        recompile();
      }, SWAP_MIN_MS - since);
    }
  };

  // --- historial (deshacer/rehacer) -----------------------------------------
  // Snapshot profundo de nodos/edges (sin funciones → structuredClone es seguro).
  const snap = () => ({ nodes: structuredClone(get().nodes), edges: structuredClone(get().edges) });
  // Empuja el estado ACTUAL a la pila `past` ANTES de una mutación. Coalescido:
  // los arrastres de sliders (muchos updateNodeData/frame) generan 1 paso, no 60
  // (a menos que `force`, para cambios estructurales: crear/borrar/conectar).
  // portapapeles de nodos (copiar/pegar). Vive fuera del estado (no persiste).
  let clipboard: { nodes: GNode[]; edges: Edge[] } | null = null;
  let lastPush = 0;
  const pushPast = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPush < 500) return;
    lastPush = now;
    set({ past: [...get().past.slice(-49), snap()], future: [] });
  };

  return {
    nodes: startNodes,
    edges: startEdges,
    cps: saved?.cps ?? 0.5,
    beatsPerCycle: saved?.beatsPerCycle ?? 4,
    transpose: saved?.transpose ?? 0,
    xfader: 0.5,
    voiceEditId: null,
    synthEditId: null,
    clipEditId: null,
    playing: false,
    initializing: false,
    compileError: null,
    runtimeError: null,
    lastCode: null,
    past: [],
    future: [],
    dragItem: null,
    hoverEdgeId: null,
    master: { ...DEFAULT_MASTER, ...(saved?.master ?? {}) },
    mastering: false,
    mode: saved?.mode ?? 'standard',
    djOrientation: saved?.djOrientation ?? 'vertical',
    djShowCode: false, // decks arrancan en ONDAS (compacto); el editor es opt-in por deck
    vizMode: saved?.vizMode ?? 0,
    vizHeight: saved?.vizHeight ?? 236,
    vizVisible: saved?.vizVisible ?? true,
    vizHeadless: saved?.vizHeadless ?? false,
    vizMilkStyle: saved?.vizMilkStyle ?? 'telar',
    loadNonce: 0,

    onNodesChange: (changes) => {
      // borrar nodos (tecla Supr de React Flow) es undoable y debe recompilar.
      const removes = changes.some((c) => c.type === 'remove');
      if (removes) pushPast(true);
      set({ nodes: applyNodeChanges(changes, get().nodes) as GNode[] });
      if (removes) get().recompile();
    },
    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) pushPast(true);
      set({ edges: applyEdgeChanges(changes, get().edges) });
      // un cambio de cable (conectar/borrar) afecta la compilación
      if (changes.some((c) => c.type === 'remove')) get().recompile();
    },
    onConnect: (conn) => {
      pushPast(true);
      set({ edges: addEdge({ ...conn }, get().edges) });
      get().recompile();
    },

    addNode: (kind, opId, position) => {
      pushPast(true);
      const id = nextId(kind);
      const data: NodeData = { kind };
      if (kind === 'source') data.code = 's("hh*8")';
      if ((kind === 'fx' || kind === 'transform') && opId) {
        data.opId = opId;
        data.params = defaultParams(OPS_BY_ID[opId]);
      }
      const node: GNode = {
        id,
        type: kind,
        position: position ?? { x: 200 + Math.random() * 200, y: 320 + Math.random() * 120 },
        data,
      };
      set({ nodes: [...get().nodes, node] });
    },

    insertSidechain: (targetId, triggerId, depth = 0.7, attack = 0.1) => {
      const nodes = get().nodes;
      const edges = get().edges;
      const target = nodes.find((n) => n.id === targetId && n.data.kind === 'source');
      const trigger = nodes.find((n) => n.id === triggerId && n.data.kind === 'source');
      if (!target || !trigger || targetId === triggerId) return null;
      // el target debe alimentar al menos un Out para insertar el sidechain en medio.
      const outEdges = edges.filter((e) => e.source === targetId && nodes.some((n) => n.id === e.target && n.data.kind === 'out'));
      if (!outEdges.length) return null;
      // evita duplicar: si ya hay un sidechain 'duck' colgado del target, no crea otro.
      const already = nodes.some((n) => n.data.kind === 'fx' && n.data.opId === 'sidechain' && n.data.params?.mode === 'duck' && edges.some((e) => e.source === targetId && e.target === n.id));
      if (already) return null;
      pushPast(true);
      const id = nextId('fx');
      const scNode: GNode = {
        id,
        type: 'fx',
        position: { x: target.position.x + 150, y: target.position.y + 46 },
        data: {
          kind: 'fx',
          opId: 'sidechain',
          params: {
            mode: 'duck',
            trigger: triggerId,
            depth: Math.max(0.05, Math.min(0.95, depth)),
            attack: Math.max(0.005, Math.min(0.5, attack)),
          },
        },
      };
      // recablea: target → sidechain → (cada Out al que iba el target).
      const kept = edges.filter((e) => !outEdges.includes(e));
      kept.push({ id: `e_${targetId}_${id}`, source: targetId, target: id });
      for (const oe of outEdges) kept.push({ id: `e_${id}_${oe.target}`, source: id, target: oe.target });
      set({ nodes: [...nodes, scNode], edges: kept });
      get().recompile();
      return id;
    },

    addSourceToOut: () => {
      pushPast(true);
      const id = nextId('source');
      const nodes = [...get().nodes];
      const edges = [...get().edges];
      const src: GNode = {
        id,
        type: 'source',
        position: { x: 120 + Math.random() * 280, y: 200 + Math.random() * 220 },
        data: { kind: 'source', code: 's("hh*8")' },
      };
      nodes.push(src);
      let out = nodes.find((n) => n.data.kind === 'out');
      if (!out) {
        const oid = nextId('out');
        out = { id: oid, type: 'out', position: { x: 760, y: 200 }, data: { kind: 'out' } };
        nodes.push(out);
      }
      edges.push({ id: `e_${id}`, source: id, target: out.id });
      set({ nodes, edges });
      get().recompile();
    },

    updateNodeData: (id, patch) => {
      // registro para deshacer: coalescido (un arrastre de slider = 1 paso). Los
      // cambios puramente visuales (nombre/plegado) también se registran pero el
      // throttle evita spam; deshacerlos es inocuo.
      pushPast();
      set({
        nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      });
      // Sólo recompilamos (y re-evaluamos el audio) si el cambio afecta el sonido.
      // Renombrar o plegar son puramente visuales: no deben hacer hot-swap.
      // params/gain/chFilter cambian al arrastrar perillas → coalescido;
      // code/opId/mute → inmediato.
      // code/params/gain/chFilter/begin/end cambian al teclear o arrastrar
      // (perilla/slider) → coalescido a 1/frame; opId/mute → inmediato.
      if (
        'params' in patch ||
        'gain' in patch ||
        'chFilter' in patch ||
        'chPan' in patch || // paneo de canal (superficie de mezcla V3) → .pan()
        'chRoom' in patch || // reverb send de canal (V3) → .room()
        'begin' in patch ||
        'end' in patch ||
        'code' in patch ||
        'synth' in patch ||
        'synthNote' in patch ||
        'voice' in patch ||
        'eq' in patch || // EQ por canal: enruta a un orbit + setChannelEqs (antes NO recompilaba → EQ inerte)
        'perf' in patch || // FX de deck momentáneos (DJ): roll/gate/echo
        'xfa' in patch // asignación de crossfader
      )
        scheduleRecompile();
      // showScope/showSynth/showVoice añaden/quitan código compilado.
      else if (
        'opId' in patch ||
        'mute' in patch ||
        'solo' in patch ||
        'seqPreviewCode' in patch || // audición de sección: cambiar de pestaña con ▶ activo hot-swapea al instante
        'showScope' in patch ||
        'synthOn' in patch ||
        'showVoice' in patch
      )
        get().recompile();
      // showSynth es solo visibilidad de panel: no recompila (no cambia el sonido).
    },

    removeNode: (id) => {
      pushPast(true);
      set({
        nodes: get().nodes.filter((n) => n.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      });
      get().recompile();
    },

    replaceOp: (id, opId) => {
      pushPast(true);
      set({
        nodes: get().nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, opId, params: defaultParams(OPS_BY_ID[opId]) } }
            : n
        ),
      });
      get().recompile();
    },

    // deshacer/rehacer: intercambia el presente con la cima de la pila.
    undo: () => {
      const { past } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ nodes: prev.nodes, edges: prev.edges, past: past.slice(0, -1), future: [snap(), ...get().future].slice(0, 50) });
      get().recompile();
    },
    redo: () => {
      const { future } = get();
      if (!future.length) return;
      const next = future[0];
      set({ nodes: next.nodes, edges: next.edges, future: future.slice(1), past: [...get().past, snap()].slice(-50) });
      get().recompile();
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    // duplica los nodos SELECCIONADOS (y sus cables internos), desplazados; el Out
    // no se duplica (solo hay uno lógico). Los clones quedan seleccionados.
    duplicateSelected: () => {
      const { nodes, edges } = get();
      const sel = nodes.filter((n) => n.selected && n.data.kind !== 'out');
      if (!sel.length) return;
      pushPast(true);
      const idMap = new Map<string, string>();
      const clones: GNode[] = sel.map((n) => {
        const nid = nextId(n.data.kind);
        idMap.set(n.id, nid);
        return { ...n, id: nid, position: { x: n.position.x + 44, y: n.position.y + 44 }, data: structuredClone(n.data), selected: true };
      });
      const newEdges: Edge[] = edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({ ...e, id: `e_${idMap.get(e.source)}_${idMap.get(e.target)}`, source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
      set({
        nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...clones],
        edges: [...edges, ...newEdges],
      });
      get().recompile();
    },

    copySelected: () => {
      const { nodes, edges } = get();
      const sel = nodes.filter((n) => n.selected && n.data.kind !== 'out');
      if (!sel.length) { clipboard = null; return; }
      const ids = new Set(sel.map((n) => n.id));
      clipboard = {
        nodes: sel.map((n) => structuredClone(n)),
        edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => structuredClone(e)),
      };
    },
    pasteClipboard: () => {
      if (!clipboard || !clipboard.nodes.length) return;
      pushPast(true);
      const { nodes, edges } = get();
      const idMap = new Map<string, string>();
      const clones: GNode[] = clipboard.nodes.map((n) => {
        const nid = nextId(n.data.kind);
        idMap.set(n.id, nid);
        return { ...structuredClone(n), id: nid, position: { x: n.position.x + 48, y: n.position.y + 48 }, selected: true };
      });
      const newEdges: Edge[] = clipboard.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({ ...e, id: `e_${idMap.get(e.source)}_${idMap.get(e.target)}`, source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
      set({ nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...clones], edges: [...edges, ...newEdges] });
      get().recompile();
    },

    setDragItem: (item) => set({ dragItem: item }),
    setHoverEdge: (id) => {
      if (get().hoverEdgeId !== id) set({ hoverEdgeId: id });
    },

    setMaster: (patch) => {
      const master = { ...get().master, ...patch };
      set({ master });
      // EQ/limiter/glue/sat/width del máster van al BUS del motor (no al código); los demás recompilan.
      if ('limit' in patch || 'glue' in patch || 'sat' in patch || 'width' in patch || 'punch' in patch || 'eqLow' in patch || 'eqMid' in patch || 'eqHigh' in patch)
        setMasterBus({ limit: master.limit ?? 0, glue: master.glue ?? 0, sat: master.sat ?? 0, width: master.width ?? 1, punch: master.punch ?? 0, low: master.eqLow ?? 0, mid: master.eqMid ?? 0, high: master.eqHigh ?? 0 });
      scheduleRecompile(); // hot-swap en vivo, coalescido por frame
    },

    autoMaster: async (target = -14) => {
      if (get().mastering || !get().playing) return; // necesita señal sonando
      set({ mastering: true });
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const set2 = get().setMaster;
      try {
        // 1) cadena de masterización "pulido": glue-comp gentil (pega la mezcla) + limitador
        //    medio (controla picos) + realce sutil de graves y agudos (peso + aire).
        set2({ glue: 0.35, limit: 0.55, eqLow: 1.2, eqMid: 0, eqHigh: 1.6 });
        await sleep(1800); // deja que la ventana short (3 s) refleje la cadena
        // 2) converge la GANANCIA al objetivo LUFS con control ADAPTATIVO. La ganancia en
        //    dB mueve el loudness casi 1:1; el limiter mete algo de no-linealidad. Paso
        //    proporcional (≈0.9× del error → converge rápido, no al 0.8 lento de antes),
        //    acotado a ±6 dB/pasada, y si NOS PASAMOS (el signo del error se invierte)
        //    reducimos el paso a la mitad para asentar sin oscilar. Máx 6 pasadas, ±0.5 LU.
        let damp = 0.9;
        let prevSign = 0;
        for (let i = 0; i < 6; i++) {
          const cur = getLufs().short;
          if (!isFinite(cur)) { await sleep(700); continue; } // silencio momentáneo
          const delta = target - cur;
          if (Math.abs(delta) < 0.5) break;
          const sign = Math.sign(delta);
          if (prevSign !== 0 && sign !== prevSign) damp = Math.max(0.35, damp * 0.5); // sobrepaso → frena
          prevSign = sign;
          const g = get().master.gain ?? 1;
          const stepDb = Math.max(-6, Math.min(6, delta * damp)); // acota el salto por pasada
          const next = Math.max(0.15, Math.min(3.5, g * Math.pow(10, stepDb / 20)));
          if (Math.abs(next - g) < 0.004) break; // ya en el tope o sin margen de mejora
          set2({ gain: next });
          await sleep(1500); // la ventana short (3 s) refleja la mayor parte del cambio
        }
      } finally {
        set({ mastering: false });
      }
    },

    setMode: (mode) => set({ mode }),
    setDjOrientation: (djOrientation) => set({ djOrientation }),
    setDjShowCode: (djShowCode) => set({ djShowCode }),
    setVizMode: (vizMode) => set({ vizMode }),
    setVizHeight: (vizHeight) => set({ vizHeight }),
    setVizVisible: (vizVisible) => set({ vizVisible }),
    setVizHeadless: (vizHeadless) => set({ vizHeadless }),
    setVizMilkStyle: (vizMilkStyle) => set({ vizMilkStyle }),

    addPattern: (code, name, extra, pos, opts) => {
      pushPast(true);
      const id = nextId('source');
      const node: GNode = {
        id,
        type: 'source',
        position: pos ?? { x: 120 + Math.random() * 260, y: 220 + Math.random() * 200 },
        data: { kind: 'source', code, name, ...extra },
      };
      const { nodes, edges } = get();
      // AUTO-CONEXIÓN al Out (por defecto): un Source suelto no suena; conectarlo hace
      // que se oiga al instante. Conecta a TODOS los Out existentes. Si no hay Out o se
      // desactiva (AiSong), queda suelto como antes.
      const connect = opts?.connectToOut ?? true;
      const outs = connect ? nodes.filter((n) => n.data.kind === 'out') : [];
      const newEdges: Edge[] = outs.map((o) => ({ id: `e_${id}_${o.id}`, source: id, target: o.id }));
      set({ nodes: [...nodes, node], edges: newEdges.length ? [...edges, ...newEdges] : edges });
      if (newEdges.length) get().recompile(); // suena ya (sin esperar a conectar a mano)
      return id;
    },

    commitFreeze: (originalId, name, cycles) => {
      pushPast(true);
      const { nodes, edges } = get();
      const orig = nodes.find((n) => n.id === originalId);
      const cyc = Math.max(1, Math.round(cycles));
      const id = nextId('source');
      const node: GNode = {
        id,
        type: 'source',
        position: orig
          ? { x: orig.position.x + 40, y: orig.position.y + 96 }
          : { x: 140 + Math.random() * 240, y: 260 + Math.random() * 160 },
        data: { kind: 'source', code: `s("${name}").loopAt(${cyc})`, name: ('freeze ' + (orig?.data.name?.trim() || '')).trim() },
      };
      // conectar el nodo congelado a cada Out (el stem ya trae los FX aguas abajo);
      // mutear el original para que no se duplique el sonido (queda como respaldo).
      const outs = nodes.filter((n) => n.data.kind === 'out');
      const newEdges: Edge[] = outs.map((o) => ({ id: `e_${id}_${o.id}`, source: id, target: o.id }));
      set({
        nodes: [...nodes.map((n) => (n.id === originalId ? { ...n, data: { ...n.data, mute: true } } : n)), node],
        edges: [...edges, ...newEdges],
      });
      get().recompile();
      return id;
    },

    moveNodesBy: (ids, dx, dy) => {
      const idset = ids instanceof Set ? ids : new Set(ids);
      if (idset.size === 0 || (dx === 0 && dy === 0)) return;
      set({
        nodes: get().nodes.map((n) =>
          idset.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n
        ),
      });
    },

    applyNodeStates: (states) => {
      // aplica de golpe un mapa nodeId→parche de data (escenas) y recompila UNA vez,
      // en lugar de N updateNodeData (que recompilarían N veces). Mezcla params.
      set({
        nodes: get().nodes.map((n) => {
          const p = states[n.id];
          if (!p) return n;
          const params = p.params ? { ...n.data.params, ...p.params } : n.data.params;
          return { ...n, data: { ...n.data, ...p, params } };
        }),
      });
      get().recompile();
    },

    insertOnEdge: (edgeId, kind, opId, position) => {
      const edge = get().edges.find((e) => e.id === edgeId);
      if (!edge) return;
      pushPast(true);
      const id = nextId(kind);
      const data: NodeData = { kind, opId, params: defaultParams(OPS_BY_ID[opId]) };
      const node: GNode = { id, type: kind, position, data };
      const newEdges = get().edges.filter((e) => e.id !== edgeId);
      newEdges.push({ id: `e_${id}_in`, source: edge.source, target: id });
      newEdges.push({ id: `e_${id}_out`, source: id, target: edge.target });
      set({ nodes: [...get().nodes, node], edges: newEdges });
      get().recompile();
    },

    setCpsValue: (cps) => {
      set({ cps });
      setCps(cps);
      get().recompile();
    },

    setBeatsPerCycle: (n) => {
      const bpc = Math.max(1, Math.min(16, Math.round(n)));
      const { cps, beatsPerCycle } = get();
      // al cambiar el "/N" mantenemos el BPM que ve el usuario constante: ajustamos
      // el cps real (más/menos tiempos por ciclo = ciclos más largos/cortos).
      const newCps = (cps * beatsPerCycle) / bpc;
      set({ beatsPerCycle: bpc, cps: newCps });
      setCps(newCps);
      get().recompile();
    },

    setTranspose: (n) => {
      set({ transpose: Math.max(-24, Math.min(24, Math.round(n)) || 0) });
      get().recompile(); // el tono cambia el código compilado (note(…) transpuesto)
    },

    setXfader: (n) => {
      set({ xfader: Math.max(0, Math.min(1, n)) });
      scheduleRecompile(); // hot-swap en vivo, coalescido por frame (arrastre del fader)
    },

    // los tres estudios son modales: abrir uno cierra los otros (no se apilan).
    setVoiceEdit: (voiceEditId) => set({ voiceEditId, synthEditId: null, clipEditId: null }),
    setSynthEdit: (synthEditId) => set({ synthEditId, voiceEditId: null, clipEditId: null }),
    setClipEdit: (clipEditId) => set({ clipEditId, voiceEditId: null, synthEditId: null }),

    // AUTO-ENCAJE: repara sources que son un SAMPLE LARGO pelado (p.ej. s("phono_groove_largo1")).
    // Un s("x") pelado se re-dispara CADA ciclo; si el sample dura más que ~1 ciclo, se solapa
    // consigo mismo. Le ponemos .slow(N) (N = su duración en ciclos) → se re-dispara justo al
    // terminar: SIN solape y a su TEMPO NATURAL (manda el BPM del sample; NO varispeed como
    // loopAt). También NORMALIZA un .loopAt(x)/.slow(x) previo (single sample) a .slow(N) fresco
    // — así sana el nodo que la versión anterior había puesto con loopAt (cambiaba el tempo).
    // Salta: nodos con synthOn (los gestiona el estudio), patrones (bd*4, "a b"), indexados
    // (bd:3), cadenas con más métodos (.chop/.gain/…), y los que no se pueden medir.
    autoFitLongSamples: async () => {
      const cps = get().cps || 0.5;
      const updates: { id: string; code: string }[] = [];
      for (const n of get().nodes) {
        if (n.data.kind !== 'source' || n.data.synthOn) continue;
        const code = (n.data.code ?? '').trim();
        // un ÚNICO sample pelado (opc. ya con .loopAt/.slow); salta patrones/indexados/cadenas.
        const name = bareSampleName(code);
        if (!name) continue;
        const url = resolveSampleUrl(name);
        if (!url) continue;
        const dur = await sampleDuration(url).catch(() => 0);
        const cycles = dur * cps;
        if (dur && cycles > 1.2) {
          const N = Math.max(1, Math.round(cycles * 100) / 100);
          const next = `s("${name}").slow(${N})`;
          if (next !== code) updates.push({ id: n.id, code: next });
        }
      }
      if (updates.length) {
        set({
          nodes: get().nodes.map((n) => {
            const u = updates.find((x) => x.id === n.id);
            return u ? { ...n, data: { ...n.data, code: u.code } } : n;
          }),
        });
      }
    },

    play: async () => {
      set({ initializing: true });
      await ensureEngine();
      // Reanuda el contexto Y espera la carga de los AudioWorklets de efectos
      // ANTES de sonar (si no, el audio sale sin procesamiento). Gesto de Play.
      await ensureAudioReady();
      await registerDownloadedSamples(); // re-registra samples de YouTube guardados
      await registerWavetables(); // wavetables propias (wt_telar_*)
      await registerIrReverbs(); // espacios de reverb por IR (ir_hall, ir_plate…)
      await registerUserPacks(); // packs del usuario guardados (IndexedDB) → s("…")
      await registerCloudBank(); // banco propio en la nube (R2) → s("…") vía proxy
      await get().autoFitLongSamples(); // repara samples largos pelados (evita el solape)
      startHighlightLoop(); // resaltado de eventos activos en el código
      const m = get().master; // aplica el bus de máster (EQ+limiter+glue+sat+width+punch) guardado
      setMasterBus({ limit: m.limit ?? 0, glue: m.glue ?? 0, sat: m.sat ?? 0, width: m.width ?? 1, punch: m.punch ?? 0, low: m.eqLow ?? 0, mid: m.eqMid ?? 0, high: m.eqHigh ?? 0 });
      set({ playing: true, initializing: false });
      get().recompile(); // compila + hot-swap (aplica los macros maestros)
    },

    stop: async () => {
      await stopAudio();
      set({ playing: false });
    },

    resetProject: () => {
      // lienzo nuevo: un Source vacío conectado al Out, listo para empezar.
      const src: GNode = { id: 'src_1', type: 'source', position: { x: 140, y: 180 }, data: { kind: 'source', code: 's("bd*4")' } };
      const out: GNode = { id: 'out_1', type: 'out', position: { x: 560, y: 180 }, data: { kind: 'out' } };
      idCounter = 1;
      set({
        nodes: [src, out],
        edges: [{ id: 'e_reset', source: 'src_1', target: 'out_1' }],
        compileError: null,
        runtimeError: null,
        loadNonce: get().loadNonce + 1,
      });
      get().recompile();
    },

    loadSnapshot: (snap) => {
      pushPast(true); // cargar (demo/proyecto/copiloto IA) es deshacible con Ctrl+Z
      const rawNodes = (snap.nodes as GNode[] | undefined) ?? get().nodes;
      // Al CARGAR un proyecto/demo, los Source aparecen COLAPSADOS: lienzo limpio y
      // legible de un vistazo (se expanden con clic). Pedido del usuario.
      const nodes = rawNodes.map((n) =>
        // seqPreviewCode es TRANSITORIO (audición de sección): jamás debe sobrevivir
        // a una carga — un valor rancio con solo activo tocaría el patrón equivocado.
        n.data.kind === 'source' ? { ...n, data: { ...n.data, collapsed: true, seqPreviewCode: undefined } } : n,
      );
      const edges = snap.edges ?? get().edges;
      idCounter = maxIdCounter(nodes);
      // sanea el modo: solo 'standard'|'dj' son válidos. Un valor inválido (p.ej.
      // "studio") hacía que la app cayera al layout DJ (roto para proyectos de grafo).
      const mode = snap.mode === 'dj' ? 'dj' : 'standard';
      // MÁSTER: rellena defaults + ACOTA a rango válido (un import de otra IA / JSON a mano
      // puede traer valores que suenan raro o silencian, p.ej. filter:-2 → mudo). Se avisa
      // qué se ajustó para que el usuario sepa por qué y afine desde una perilla sana.
      let master = get().master;
      let masterNotes: string[] = [];
      if (snap.master) {
        const sane = sanitizeMasterFx({ ...DEFAULT_MASTER, ...snap.master });
        master = sane.master; masterNotes = sane.notes;
      }
      set({
        nodes,
        edges,
        cps: snap.cps ?? get().cps,
        beatsPerCycle: snap.beatsPerCycle ?? 4,
        transpose: snap.transpose ?? 0,
        master,
        mode,
        djOrientation: snap.djOrientation ?? get().djOrientation,
        vizMode: snap.vizMode ?? get().vizMode,
        vizHeight: snap.vizHeight ?? get().vizHeight,
        vizVisible: snap.vizVisible ?? get().vizVisible,
        vizHeadless: snap.vizHeadless ?? get().vizHeadless,
        vizMilkStyle: snap.vizMilkStyle ?? get().vizMilkStyle,
        compileError: null,
        runtimeError: null,
        loadNonce: get().loadNonce + 1,
      });
      if (snap.cps != null) setCps(snap.cps);
      get().recompile();
      // avisa (sin bloquear) si hubo que acotar el máster del proyecto importado.
      if (masterNotes.length) {
        toast.warn(`Ajusté el máster de este proyecto para que suene (venía fuera de rango): ${masterNotes.join(', ')}. Ábrelo para afinar.`);
      }
    },

    recompile,
  };
});

// Autoguardado: persiste el proyecto (debounced) ante cualquier cambio relevante.
useGraphStore.subscribe((s) => {
  saveProjectDebounced({
    nodes: s.nodes,
    edges: s.edges,
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
  });
});
