// Autoguardado del proyecto completo en localStorage (grafo + transporte +
// máster + vista + canción + escenas). Misma idea que patternStore: cambiar el backend aquí.
import type { SongKey } from './songKey';
import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '../graph/types';
import { sanitizeMasterFx, type MasterFx } from '../graph/compile';
import type { SongStep } from '../store/useSongStore';
import type { Scene, SceneState } from '../store/useScenesStore';

// La canción (secciones escena × compases) y el banco de escenas 1–9 son PARTE del
// proyecto: las escenas guardan estado por nodeId de ESTE grafo, así que fuera de él no
// significan nada. Viajan en el autoguardado, exportar/importar, compartir y la galería.
export interface SongMarker { id: string; bar: number; name: string } // marcador con nombre (10.5)
export interface ProjectSong {
  steps: SongStep[];
  loop: boolean;
  markers?: SongMarker[];
}
export function sanitizeMarkers(raw: unknown): SongMarker[] {
  if (!Array.isArray(raw)) return [];
  const out: SongMarker[] = [];
  for (const [i, x] of raw.entries()) {
    const o = x as Partial<SongMarker> | null;
    const bar = Math.round(Number(o?.bar) * 4) / 4;
    if (!o || !Number.isFinite(bar) || bar < 0) continue;
    out.push({ id: typeof o.id === 'string' && o.id ? o.id : `mk_imp_${i}`, bar, name: String(o.name ?? '').slice(0, 40) || `marcador ${i + 1}` });
    if (out.length >= 64) break;
  }
  return out.sort((a, b) => a.bar - b.bar);
}
export interface ProjectExtras {
  song: ProjectSong;
  scenes: Record<number, Scene>;
}

export interface ProjectSnapshot {
  nodes: Node<NodeData>[];
  edges: Edge[];
  cps: number;
  beatsPerCycle: number; // tiempos por ciclo ("/4"): conversión BPM↔cps (display)
  transpose: number; // "tono" global en semitonos (transpone note(…))
  master: MasterFx;
  mode: 'standard' | 'dj' | 'daw'; // vista: grafo · mezclador DJ · línea de tiempo DAW
  djOrientation: 'vertical' | 'horizontal';
  vizMode: number;
  vizHeight: number; // alto (px) de la pantalla de visualizadores, redimensionable
  vizVisible: boolean; // contenedor del visualizador mostrado/oculto
  vizHeadless: boolean; // lienzo puro (sin bisel/HUD)
  vizMilkStyle: 'free' | 'telar'; // estilo de los presets milkdrop
  title?: string; // nombre del tema (exportar)
  songKey?: SongKey | null; // tonalidad del tema (Fase 5.1)
  song?: ProjectSong; // canción; si falta al cargar, la canción queda vacía
  scenes?: Record<number, Scene>; // escenas 1–9; si faltan al cargar, quedan vacías
  foreign?: string; // proyecto AJENO (de dónde vino): su código se verifica antes de evaluarlo
}

const KEY = 'telar.project.v1';

export function loadProject(): Partial<ProjectSnapshot> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<ProjectSnapshot>;
  } catch {
    return null;
  }
}

// El proyecto guardado se lee UNA vez al arrancar y lo comparten los stores que siembran
// de él (grafo, canción, escenas): parsearlo tres veces sería tirar tiempo de arranque.
let savedCache: Partial<ProjectSnapshot> | null | undefined;
export function savedProject(): Partial<ProjectSnapshot> | null {
  if (savedCache === undefined) savedCache = loadProject();
  return savedCache;
}

// Solo lo que la canción sabe tocar: escena 1–9 y 1–64 compases (los topes de la UI). Un
// JSON importado, hecho a mano o por otra IA no debe romper el motor de secciones.
export function sanitizeSong(raw: unknown): ProjectSong | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { steps?: unknown; loop?: unknown };
  if (!Array.isArray(r.steps)) return null;
  const steps: SongStep[] = [];
  const ids = new Set<string>();
  r.steps.forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const o = x as Partial<SongStep>;
    const scene = Math.round(Number(o.scene));
    const bars = Math.round(Number(o.bars));
    if (!isFinite(scene) || !isFinite(bars)) return;
    let id = typeof o.id === 'string' && o.id ? o.id : `st_imp_${i}`;
    if (ids.has(id)) id = `${id}_${i}`;
    ids.add(id);
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 48) : undefined;
    steps.push({ id, scene: Math.min(9, Math.max(1, scene)), bars: Math.min(64, Math.max(1, bars)), ...(name ? { name } : {}) });
  });
  const markers = sanitizeMarkers((r as { markers?: unknown }).markers);
  return { steps, loop: r.loop !== false, ...(markers.length ? { markers } : {}) };
}

// Estado de mezcla de una escena: SOLO lo que una escena captura (mute, solo, gain, filtro,
// paneo, EQ, compresor, envíos y params). applyNodeStates mezcla el parche sobre el nodo,
// así que un campo de más (p.ej. `code` en un .json ajeno) cambiaría el código al disparar.
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
// Solo las claves conocidas: números finitos y `on` como booleano.
const pick = (v: unknown, keys: readonly string[]): Record<string, number | boolean> | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const src = v as Record<string, unknown>;
  const o: Record<string, number | boolean> = {};
  for (const k of keys) {
    if (k === 'on') { if (typeof src.on === 'boolean') o.on = src.on; continue; }
    const n = num(src[k]); if (n !== undefined) o[k] = n;
  }
  return o;
};
const EQ_KEYS = ['on', 'low', 'mid', 'high', 'midFreq'] as const;
const COMP_KEYS = ['on', 'thr', 'ratio', 'att', 'rel', 'makeup'] as const;
const SEND_KEYS = ['rev', 'del'] as const;
export function sanitizeSceneStates(raw: unknown): Record<string, SceneState> {
  const out: Record<string, SceneState> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const s = v as Record<string, unknown>;
    const st: SceneState = { mute: !!s.mute, solo: !!s.solo };
    for (const k of ['gain', 'chFilter', 'chPan'] as const) { const n = num(s[k]); if (n !== undefined) st[k] = n; }
    const eq = pick(s.eq, EQ_KEYS); if (eq) st.eq = eq as SceneState['eq'];
    const comp = pick(s.comp, COMP_KEYS); if (comp) st.comp = comp as SceneState['comp'];
    const sends = pick(s.sends, SEND_KEYS); if (sends) st.sends = sends as SceneState['sends'];
    if (s.params && typeof s.params === 'object' && !Array.isArray(s.params)) {
      const p: Record<string, number | string> = {};
      for (const [k, x] of Object.entries(s.params as Record<string, unknown>)) {
        if (typeof x === 'number' && Number.isFinite(x)) p[k] = x;
        else if (typeof x === 'string' && x.length <= 400) p[k] = x; // señal (p.ej. sine.range(…)): se verifica al abrir
      }
      st.params = p;
    }
    out[id] = st;
  }
  return out;
}

// Escenas 1–9 con su estado de mezcla. El máster de cada escena pasa por el mismo saneo
// que el del proyecto: un filtro −3 de otra IA dejaría muda la canción al dispararla.
export function sanitizeScenes(raw: unknown): Record<number, Scene> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<number, Scene> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const slot = Number(k);
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) continue;
    if (!v || typeof v !== 'object') continue;
    const sc = v as Partial<Scene>;
    if (!sc.state || typeof sc.state !== 'object' || Array.isArray(sc.state)) continue;
    const scene: Scene = {
      slot,
      name: typeof sc.name === 'string' && sc.name.trim() ? sc.name : `escena ${slot}`,
      state: sanitizeSceneStates(sc.state),
      savedAt: Number(sc.savedAt) || 0,
    };
    if (sc.master && typeof sc.master === 'object') scene.master = sanitizeMasterFx(sc.master as MasterFx).master;
    out[slot] = scene;
  }
  return out;
}

// GRAFO SANO al cargar (autoguardado, archivo, enlace, galería, copia): un proyecto mal
// formado rompía la app para siempre (tras recargar volvía a romperse). Se quedan solo los
// nodos de un tipo que existe, con id único y datos; posición finita; los campos que se
// pintan tal cual, del tipo correcto. Las conexiones, solo entre nodos que quedaron.
const NODE_TYPES = new Set(['source', 'transform', 'fx', 'out']);
const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : 0);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function sanitizeGraph(rawNodes: unknown, rawEdges: unknown): { nodes: Node<NodeData>[]; edges: Edge[]; dropped: number } {
  const nodes: Node<NodeData>[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const n of Array.isArray(rawNodes) ? rawNodes : []) {
    if (!isObj(n) || !isObj(n.data)) { dropped++; continue; }
    const id = typeof n.id === 'string' ? n.id : typeof n.id === 'number' ? String(n.id) : '';
    const kind = typeof n.data.kind === 'string' ? n.data.kind : typeof n.type === 'string' ? n.type : '';
    if (!id || id.length > 120 || ids.has(id) || !NODE_TYPES.has(kind)) { dropped++; continue; }
    ids.add(id);
    const data: Record<string, unknown> = { ...n.data, kind };
    for (const k of ['label', 'name', 'code', 'lastCode']) if (k in data && typeof data[k] !== 'string') delete data[k];
    for (const k of ['mute', 'solo', 'collapsed']) if (k in data && typeof data[k] !== 'boolean') delete data[k];
    for (const k of ['gain', 'chFilter', 'chPan', 'laneH']) if (k in data && !(typeof data[k] === 'number' && Number.isFinite(data[k]))) delete data[k];
    if ('params' in data && !isObj(data.params)) delete data.params;
    const p = isObj(n.position) ? n.position : {};
    nodes.push({ id, type: kind, position: { x: fin(p.x), y: fin(p.y) }, data: data as unknown as NodeData });
  }
  const edges: Edge[] = [];
  const eids = new Set<string>();
  for (const [i, e] of (Array.isArray(rawEdges) ? rawEdges : []).entries()) {
    if (!isObj(e) || typeof e.source !== 'string' || typeof e.target !== 'string' || !ids.has(e.source) || !ids.has(e.target)) { dropped++; continue; }
    let id = typeof e.id === 'string' && e.id ? e.id : `e_${e.source}_${e.target}_${i}`;
    if (eids.has(id)) id = `${id}_${i}`;
    eids.add(id);
    edges.push({
      id, source: e.source, target: e.target,
      ...(typeof e.sourceHandle === 'string' ? { sourceHandle: e.sourceHandle } : {}),
      ...(typeof e.targetHandle === 'string' ? { targetHandle: e.targetHandle } : {}),
    });
  }
  return { nodes, edges, dropped };
}

// Lo que sale de Telar (.json, enlace, galería) = lo MISMO que el autoguardado, compacto:
// posiciones redondeadas, sin estado de React Flow (selección, medidas) y sin canción ni
// escenas vacías. Antes se armaba aparte y perdía título, tonalidad y marcadores.
// La marca de ajeno solo se queda en la galería (es de este navegador).
export function compactSnapshot(full: ProjectSnapshot, opts: { keepForeign?: boolean } = {}): Partial<ProjectSnapshot> {
  const { foreign, song, scenes, nodes, edges, ...rest } = full;
  return {
    ...rest,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    })),
    ...(song && (song.steps.length || song.markers?.length) ? { song } : {}),
    ...(scenes && Object.keys(scenes).length ? { scenes } : {}),
    ...(opts.keepForeign && foreign ? { foreign } : {}),
  };
}

// Canción y escenas de un snapshot. Si no las trae, VACÍAS: eran de otro grafo.
export function projectExtras(snap: Partial<ProjectSnapshot> | null | undefined): ProjectExtras {
  return {
    song: sanitizeSong(snap?.song) ?? { steps: [], loop: true },
    scenes: sanitizeScenes(snap?.scenes) ?? {},
  };
}

// Al ARRANCAR: las del proyecto guardado. Un proyecto de antes de que viajaran con él no
// las trae → se adoptan UNA vez las de las claves viejas (telar.song.v1 / telar.scenes.v1,
// que no se borran); desde el primer autoguardado ya viven en el proyecto.
export const LEGACY_SONG_KEY = 'telar.song.v1';
export const LEGACY_SCENES_KEY = 'telar.scenes.v1';
export function startupSong(saved: Partial<ProjectSnapshot> | null, legacyRaw: string | null): ProjectSong {
  if (saved?.song) return sanitizeSong(saved.song) ?? { steps: [], loop: true };
  return sanitizeSong(parseJson(legacyRaw)) ?? { steps: [], loop: true };
}
export function startupScenes(saved: Partial<ProjectSnapshot> | null, legacyRaw: string | null): Record<number, Scene> {
  if (saved?.scenes) return sanitizeScenes(saved.scenes) ?? {};
  return sanitizeScenes(parseJson(legacyRaw)) ?? {};
}
export function readLegacy(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: ProjectSnapshot | null = null;
function writeProject(s: ProjectSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('projectStore: no se pudo guardar', e);
  }
}
export function saveProjectDebounced(s: ProjectSnapshot): void {
  pending = s;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushProjectSave, 500);
}

// Guarda YA lo que espera el medio segundo del autoguardado. Se llama al cerrar o recargar la
// pestaña y al ocultarla (en el teléfono, cambiar de app): sin esto, el último cambio hecho
// justo antes se perdía. Sin nada pendiente no hace nada.
export function flushProjectSave(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const s = pending;
  pending = null;
  if (s) writeProject(s);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', flushProjectSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProjectSave();
  });
}

// Mayor sufijo numérico de los ids cargados, para que nextId no colisione.
export function maxIdCounter(nodes: { id: string }[]): number {
  let max = 0;
  for (const n of nodes) {
    const m = /_(\d+)$/.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
