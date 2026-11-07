// Copia del autoguardado en IndexedDB. localStorage tiene unos 5 MB para TODO Telar (galería
// y copias incluidas): al llenarse, el autoguardado fallaba en silencio. IndexedDB tiene mucho
// más espacio; localStorage se sigue escribiendo porque es síncrono y alcanza a guardar al
// cerrar la pestaña. Al arrancar gana la copia más nueva (savedAt).
const DB = 'telar-proyecto';
const STORE = 'kv';
const KEY = 'actual';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
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

export async function idbGetProject(): Promise<string | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const rq = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    rq.onsuccess = () => resolve(typeof rq.result === 'string' ? rq.result : null);
    rq.onerror = () => reject(rq.error);
  });
}

export async function idbPutProject(json: string): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(json, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Pide al navegador que no borre lo guardado (Safari borra tras 7 días sin visita; Chrome y
// Firefox, cuando falta espacio). Firefox lo pregunta; por eso se pide cuando ya hay trabajo.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
