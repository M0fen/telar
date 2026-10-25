// COPIAS AUTOMÁTICAS del proyecto. Cargar un ejemplo, generar con Nod-IA, abrir un archivo,
// la galería, un enlace compartido, el tutorial o «limpiar todo» REEMPLAZAN el proyecto; el
// autoguardado pisaba el anterior y, tras recargar, no había forma de volver. Ahora, justo
// antes de reemplazarlo, se guarda una copia del que había. Rotan las últimas BACKUPS_MAX.
// Recuperar una también deja copia del actual: nada es irreversible. Viven en localStorage
// (como la galería); si no caben se descartan las más viejas y, si aun así no, no se guarda:
// la copia JAMÁS bloquea la carga.
import type { ProjectSnapshot } from './projectStore';

export interface ProjectBackup {
  id: string;
  at: number; // cuándo se guardó (ms)
  reason: string; // qué lo iba a reemplazar («ejemplo · …», «Nod-IA», «abrir archivo»…)
  summary: string; // «8 pistas · kick, rumble, sub bass…»
  snap: Partial<ProjectSnapshot>;
}

export const BACKUPS_KEY = 'telar.backups.v1';
export const BACKUPS_MAX = 20;

type SnapLike = Partial<ProjectSnapshot>;
type NodeLike = { id: string; type?: string; position?: { x: number; y: number }; data?: Record<string, unknown> };

// Solo lo esencial de cada nodo (React Flow añade measured/selected/dragging en caliente).
export function compactSnap(snap: SnapLike): SnapLike {
  const nodes = ((snap.nodes ?? []) as unknown as NodeLike[]).map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : { x: 0, y: 0 },
    data: n.data ?? {},
  }));
  return { ...snap, nodes: nodes as unknown as ProjectSnapshot['nodes'] };
}

function sources(snap: SnapLike): NodeLike[] {
  return ((snap.nodes ?? []) as unknown as NodeLike[]).filter((n) => n.data?.kind === 'source');
}

// ¿Vale la pena copiarlo? Sin fuentes, o el lienzo en blanco de «limpiar todo» (un source
// s("bd*4") sin nombre y el Out), no hay nada que perder.
export function worthBackup(snap: SnapLike): boolean {
  const src = sources(snap);
  if (!src.length) return false;
  if (src.length === 1 && String(src[0].data?.code ?? '').trim() === 's("bd*4")' && !src[0].data?.name && !snap.song?.steps?.length) return false;
  return true;
}

export function summarizeSnap(snap: SnapLike): string {
  const src = sources(snap);
  const names = src.map((n) => String(n.data?.name ?? '').trim()).filter(Boolean);
  const bpm = typeof snap.cps === 'number' ? Math.round(snap.cps * 60 * (snap.beatsPerCycle || 4)) : null;
  const parts = [`${src.length} pista${src.length === 1 ? '' : 's'}`];
  if (bpm) parts.push(`${bpm} bpm`);
  if (names.length) parts.push(names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''));
  return parts.join(' · ');
}

// Contenido que importa para decidir si dos copias son la misma (sin plegados/selección).
function contentKey(snap: SnapLike): string {
  const nodes = ((snap.nodes ?? []) as unknown as NodeLike[]).map((n) => {
    const d = { ...(n.data ?? {}) };
    delete d.collapsed;
    delete d.seqPreviewCode;
    return [n.id, d];
  });
  return JSON.stringify([nodes, snap.edges ?? [], snap.cps, snap.master, snap.song?.steps ?? [], snap.scenes ?? {}]);
}

// Pone la copia más nueva primero; si es igual a la última, no la repite (cargar varios
// ejemplos seguidos no llena la lista con el mismo proyecto); recorta a `max`.
export function pushBackup(list: ProjectBackup[], entry: ProjectBackup, max = BACKUPS_MAX): ProjectBackup[] {
  if (list.length && contentKey(list[0].snap) === contentKey(entry.snap)) return list;
  return [entry, ...list].slice(0, max);
}

export function listBackups(): ProjectBackup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUPS_KEY) || '[]');
    return Array.isArray(raw) ? (raw as ProjectBackup[]).filter((b) => b && b.snap && Array.isArray(b.snap.nodes)) : [];
  } catch {
    return [];
  }
}

let n = 0;
// Guarda una copia del proyecto que se va a reemplazar. Devuelve true si quedó guardada (no
// la había ya, valía la pena y cupo). Nunca lanza.
export function backupProject(snap: SnapLike, reason: string): boolean {
  try {
    const compact = compactSnap(snap);
    if (!worthBackup(compact)) return false;
    const entry: ProjectBackup = { id: `bk_${Date.now().toString(36)}_${n++}`, at: Date.now(), reason, summary: summarizeSnap(compact), snap: compact };
    const before = listBackups();
    let list = pushBackup(before, entry);
    if (list === before) return false; // igual a la última copia
    // si no cabe en el almacenamiento, suelta las más viejas hasta que quepa
    while (list.length) {
      try {
        localStorage.setItem(BACKUPS_KEY, JSON.stringify(list));
        return list[0] === entry;
      } catch {
        if (list.length === 1) return false;
        list = list.slice(0, -1);
      }
    }
    return false;
  } catch {
    return false;
  }
}
