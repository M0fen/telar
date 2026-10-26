// Autoguardado del proyecto completo en localStorage (grafo + transporte +
// máster + vista + canción + escenas). Misma idea que patternStore: cambiar el backend aquí.
import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '../graph/types';
import { sanitizeMasterFx, type MasterFx } from '../graph/compile';
import type { SongStep } from '../store/useSongStore';
import type { Scene } from '../store/useScenesStore';

// La canción (secciones escena × compases) y el banco de escenas 1–9 son PARTE del
// proyecto: las escenas guardan estado por nodeId de ESTE grafo, así que fuera de él no
// significan nada. Viajan en el autoguardado, exportar/importar, compartir y la galería.
export interface ProjectSong {
  steps: SongStep[];
  loop: boolean;
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
  song?: ProjectSong; // canción; si falta al cargar, la canción queda vacía
  scenes?: Record<number, Scene>; // escenas 1–9; si faltan al cargar, quedan vacías
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
  return { steps, loop: r.loop !== false };
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
      state: sc.state,
      savedAt: Number(sc.savedAt) || 0,
    };
    if (sc.master && typeof sc.master === 'object') scene.master = sanitizeMasterFx(sc.master as MasterFx).master;
    out[slot] = scene;
  }
  return out;
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
