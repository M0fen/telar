// Sonidos propios sueltos — un archivo soltado en una pista o en el grafo, lo grabado con «IN»,
// los efectos de IA y lo congelado —: antes vivían en una URL de memoria y al recargar la página
// el clip quedaba mudo sin aviso. Se guardan en IndexedDB y se vuelven a registrar antes de sonar.
const DB = 'telar-sonidos';
const STORE = 'archivos';
const MAX = 400; // como mucho: se sueltan los más viejos

interface Saved { name: string; blob: Blob; at: number }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'name' }); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('IndexedDB bloqueada'));
      } catch (e) {
        reject(e);
      }
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const rq = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(rq ? (rq.result as T) : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export async function saveLocalSound(name: string, blob: Blob): Promise<void> {
  await run('readwrite', (s) => s.put({ name, blob, at: Date.now() } satisfies Saved));
  const all = ((await run<Saved[]>('readonly', (s) => s.getAll() as IDBRequest<Saved[]>)) ?? []);
  if (all.length > MAX) {
    const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX);
    await run('readwrite', (s) => { for (const o of old) s.delete(o.name); });
  }
}

export async function loadLocalSounds(): Promise<Saved[]> {
  try {
    return ((await run<Saved[]>('readonly', (s) => s.getAll() as IDBRequest<Saved[]>)) ?? []).filter((x) => x && x.name && x.blob);
  } catch {
    return [];
  }
}
