// CARPETAS Y CABECERAS DE PISTA (Fase 9.6) — lógica PURA (testeable en Node).
//
// Las pistas se agrupan en carpetas por lo que son (batería, bajos, sintes, loops, voces, efectos)
// — la misma detección que da su color (8.5) — o en la que elijas (`data.folder`). Una carpeta se
// pliega, y su mute / solo actúan sobre todas sus pistas. El alto de cada fila es de la pista
// (`data.laneH`) y el volumen se muestra en dB.
import { trackKind, type TrackKind } from './trackColor';

export type FolderId = 'drums' | 'bass' | 'synth' | 'loops' | 'vocal' | 'fx' | 'other';
export const FOLDERS: FolderId[] = ['drums', 'bass', 'synth', 'loops', 'vocal', 'fx', 'other'];
export const FOLDER_LABEL: Record<FolderId, string> = {
  drums: 'batería', bass: 'bajos', synth: 'sintes', loops: 'loops', vocal: 'voces', fx: 'efectos', other: 'otros',
};
const BY_KIND: Record<TrackKind, FolderId> = {
  kick: 'drums', snare: 'drums', hat: 'drums', perc: 'drums', bass: 'bass', synth: 'synth', loop: 'loops',
  vocal: 'vocal', fx: 'fx', other: 'other',
};
export const isFolderId = (x: unknown): x is FolderId => typeof x === 'string' && (FOLDERS as string[]).includes(x);

export function folderOf(d: { name?: string; code?: string; folder?: unknown }): FolderId {
  return isFolderId(d.folder) ? d.folder : BY_KIND[trackKind(d.name, d.code)];
}

export type RowItem<T> = { kind: 'folder'; id: FolderId; label: string; ids: string[]; open: boolean } | { kind: 'track'; t: T; folder: FolderId | null };

// filas del DAW: sin carpetas, las pistas tal cual; con carpetas, cada carpeta (en el orden en que
// aparece su primera pista) seguida de sus pistas, salvo si está plegada
export function groupRows<T extends { id: string }>(tracks: T[], folderOfId: (id: string) => FolderId, on: boolean, closed: ReadonlySet<string>): RowItem<T>[] {
  if (!on) return tracks.map((t) => ({ kind: 'track', t, folder: null }));
  const order: FolderId[] = [];
  const members = new Map<FolderId, T[]>();
  for (const t of tracks) {
    const f = folderOfId(t.id);
    if (!members.has(f)) { members.set(f, []); order.push(f); }
    members.get(f)!.push(t);
  }
  const out: RowItem<T>[] = [];
  for (const f of order) {
    const ts = members.get(f)!;
    const open = !closed.has(f);
    out.push({ kind: 'folder', id: f, label: FOLDER_LABEL[f], ids: ts.map((t) => t.id), open });
    if (open) for (const t of ts) out.push({ kind: 'track', t, folder: f });
  }
  return out;
}

// mute / solo de la carpeta: si TODAS sus pistas lo tienen, se quita; si no, se pone en todas
export function folderToggle(ids: string[], has: (id: string) => boolean): boolean {
  return !(ids.length > 0 && ids.every(has));
}

// ALTO DE FILA: 26 … 180 px (34 = compacta, como antes). Con 52 o más, la cabecera muestra volumen,
// paneo y el medidor vertical.
export const LANE_H = { min: 26, compact: 34, mid: 58, tall: 96, max: 180 } as const;
export const laneH = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(LANE_H.min, Math.min(LANE_H.max, Math.round(n))) : LANE_H.compact;
};
export const isTall = (h: number) => h >= 52;

// VOLUMEN en dB ↔ ganancia (el fader de la pista es lineal: `.mul(velocity(x))`)
export const DB_FLOOR = -60;
export const gainToDb = (g: number) => (g > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(g)) : DB_FLOOR);
export const dbToGain = (db: number) => (db <= DB_FLOOR + 0.05 ? 0 : Math.pow(10, db / 20));
export const fmtDbShort = (db: number) => (db <= DB_FLOOR + 0.05 ? '−∞' : `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)}`);
// paneo 0..1 (0,5 = centro) → «I 30» / «C» / «D 30»
export const fmtPan = (p: number) => {
  const v = Math.round((p - 0.5) * 200);
  return Math.abs(v) < 2 ? 'C' : v < 0 ? `I ${-v}` : `D ${v}`;
};
