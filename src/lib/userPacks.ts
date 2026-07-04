import { samples } from '@strudel/web';
import { ensureEngine } from '../audio/engine';
import { useUserSoundsStore } from '../store/useUserSoundsStore';

// PACKS DEL USUARIO ("compra → autohospeda", versión local): arrastras .wav y quedan
// como s("nombre") en Telar. Se guardan en IndexedDB (blobs) y se re-registran al
// reproducir, así SOBREVIVEN a recargar (a diferencia del drag-drop suelto). También
// exporta un strudel.json para hospedarlos tú mismo (repo/bucket) cuando quieras.
//
// LICENCIAS: cargar/guardar en TU navegador o exportar para TU hosting privado es tu
// uso. Publicar samples de pago (Splice/Loopmasters) en un repo PÚBLICO = redistribución
// (prohibida). Para packs públicos usa CC0 (VCSL, Freesound-CC0, Signature Sounds).

export interface PackFile { fileName: string; soundName: string; note?: string; blob: Blob; bpm?: number; loop?: boolean }
export interface UserPack { id: string; name: string; createdAt: number; files: PackFile[] }
export interface PackMeta { id: string; name: string; createdAt: number; count: number; sounds: string[] }

const DB = 'telar-packs';
const STORE = 'packs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export async function listPacks(): Promise<PackMeta[]> {
  try {
    const all = await tx<UserPack[]>('readonly', (s) => s.getAll() as IDBRequest<UserPack[]>);
    return all
      .map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, count: p.files.length, sounds: [...new Set(p.files.map((f) => f.soundName))] }))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch { return []; }
}
export async function getPack(id: string): Promise<UserPack | undefined> {
  try { return await tx<UserPack>('readonly', (s) => s.get(id) as IDBRequest<UserPack>); } catch { return undefined; }
}
export async function putPack(pack: UserPack): Promise<void> { await tx('readwrite', (s) => s.put(pack)); }
export async function deletePack(id: string): Promise<void> { registered.delete(id); await tx('readwrite', (s) => s.delete(id)); }

// Construye el mapa de samples de un pack: agrupa por soundName. Si hay notas base →
// multisample (mapa nota→url); si no → lista indexada (s("name:0"), s("name:1")…).
function buildSampleMap(pack: UserPack): Record<string, string[] | Record<string, string>> {
  const groups = new Map<string, PackFile[]>();
  for (const f of pack.files) {
    const arr = groups.get(f.soundName) ?? [];
    arr.push(f); groups.set(f.soundName, arr);
  }
  const map: Record<string, string[] | Record<string, string>> = {};
  for (const [name, files] of groups) {
    if (files.some((f) => f.note)) {
      const m: Record<string, string> = {};
      for (const f of files) m[f.note || 'c3'] = URL.createObjectURL(f.blob);
      map[name] = m;
    } else {
      map[name] = files.map((f) => URL.createObjectURL(f.blob));
    }
  }
  return map;
}

// Registra UN archivo suelto como sample s("name") (para "añadir al lienzo"). Devuelve
// la objectURL (para decodificar duración, etc.).
export async function registerFile(name: string, blob: Blob): Promise<string> {
  await ensureEngine();
  const url = URL.createObjectURL(blob);
  await samples({ [name]: url });
  useUserSoundsStore.getState().add(name); // aparece en el secuenciador y demás selectores
  return url;
}

const registered = new Set<string>();
// Registra un pack en el motor (samples). force = re-registrar aunque ya estuviera.
export async function registerPack(pack: UserPack, force = false): Promise<string[]> {
  await ensureEngine();
  const names = [...new Set(pack.files.map((f) => f.soundName))];
  if (!force && registered.has(pack.id)) { useUserSoundsStore.getState().add(...names); return names; }
  await samples(buildSampleMap(pack));
  registered.add(pack.id);
  useUserSoundsStore.getState().add(...names); // aparece en el secuenciador y demás selectores
  return names;
}

// Hidrata la lista de sonidos del usuario (nombres) desde los packs guardados, SIN
// registrar audio ni abrir el motor. Para que el secuenciador ofrezca tus samples
// nada más arrancar (antes de darle a play). Barato: solo lee metadatos de IndexedDB.
export async function hydrateUserSounds(): Promise<void> {
  try {
    const metas = await listPacks();
    const names = metas.flatMap((m) => m.sounds);
    if (names.length) useUserSoundsStore.getState().add(...names);
  } catch { /* sin IndexedDB */ }
}

// Re-registra TODOS los packs guardados (se llama al reproducir). Idempotente por sesión.
export async function registerUserPacks(): Promise<void> {
  try {
    const metas = await listPacks();
    for (const m of metas) {
      if (registered.has(m.id)) continue;
      const p = await getPack(m.id);
      if (p) await registerPack(p);
    }
  } catch { /* sin IndexedDB → no packs */ }
}

// --- helpers de nombres/notas desde el filename ---
const NOTE_RE = /(?:^|[ _.\-])([a-gA-G])(#|s|b)?(-?[0-9])(?=$|[ _.\-])/;
export function parseNote(fileBase: string): string | undefined {
  const m = NOTE_RE.exec(fileBase);
  if (!m) return undefined;
  const acc = m[2] === 'b' ? 'b' : m[2] === '#' || m[2] === 's' ? '#' : '';
  return `${m[1].toLowerCase()}${acc}${m[3]}`;
}
export function suggestSoundName(fileName: string): string {
  let b = fileName.replace(/\.[^.]+$/, '');
  const note = parseNote(b);
  if (note) b = b.replace(NOTE_RE, '');
  const clean = b.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const noDigits = clean.replace(/_?\d+$/, ''); // agrupa one-shots kick01/kick02 → kick
  return noDigits || clean || 'sample';
}

// strudel.json exportable (referencia los ficheros por su nombre original; hospeda los
// .wav junto al json). Usa notas base si las hay (multisample).
export function packToStrudelJson(pack: UserPack): string {
  const groups = new Map<string, PackFile[]>();
  for (const f of pack.files) { const a = groups.get(f.soundName) ?? []; a.push(f); groups.set(f.soundName, a); }
  const out: Record<string, unknown> = { _base: '' };
  for (const [name, files] of groups) {
    if (files.some((f) => f.note)) {
      const m: Record<string, string> = {};
      for (const f of files) m[f.note || 'c3'] = f.fileName;
      out[name] = m;
    } else {
      out[name] = files.map((f) => f.fileName);
    }
  }
  return JSON.stringify(out, null, 2);
}
