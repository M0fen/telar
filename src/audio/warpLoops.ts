// LOOPS AL TEMPO DEL TEMA (Fase 5.2) — la parte con audio. La lógica pura (tempo y largo del
// loop, código, recortes) está en lib/loopWarp.ts.
//
//   · El ORIGINAL se guarda en IndexedDB («telar-warp», por contenido): sobrevive a recargar y se
//     puede volver a estirar cuando cambias el BPM.
//   · La COPIA ESTIRADA (Rubber Band R3 en el worker de DSP, sin cambio de tono) también se
//     guarda, por (original, tempo, BPM del tema, semitonos): volver a un BPM ya usado es instantáneo.
//   · Se registra en superdough con un NOMBRE FIJO (wl_…): el código no cambia nunca al cambiar el
//     BPM, cambia el audio detrás del nombre. Mientras Rubber Band trabaja suena una copia rápida
//     por varispeed del mismo largo → en la rejilla desde el primer momento.
//
// Audio defensivo: si algo falla (sin IndexedDB, sin worker, sin WASM), el loop sigue sonando con
// lo que tenía; nada de esto puede callar la salida.
import { create } from 'zustand';
import { samples, getAudioContext, loadBuffer } from '@strudel/web';
import { ensureEngine } from './engine';
import { warpChannels } from './voiceDsp';
import { encodeWav } from '../lib/audioFormats';
import { detectBpmBuffer } from '../lib/bpm';
import {
  loopGrid,
  warpCode,
  warpCycles,
  warpKey,
  warpName,
  stretchRatio,
  targetFrames,
  tailFrames,
  fadeTail,
  varispeedLoop,
  circularPad,
  beatKeyFrames,
  seamLoop,
  extractLoop,
  effectiveSemis,
  type WarpInfo,
} from '../lib/loopWarp';

const SEAM_S = 0.02; // fundido de la unión de la copia de Rubber Band (20 ms: suave hasta en bajos)

// --- estado para la UI: qué loops se están estirando y a cuáles les falta el original ---
interface WarpUi {
  busy: Record<string, true>;
  missing: Record<string, true>;
}
export const useWarpStore = create<WarpUi>(() => ({ busy: {}, missing: {} }));
const flag = (k: keyof WarpUi, name: string, on: boolean) =>
  useWarpStore.setState((s) => {
    const m = { ...s[k] };
    if (on) m[name] = true;
    else delete m[name];
    return { [k]: m } as Partial<WarpUi>;
  });

// --- IndexedDB ---
interface OrigRec { id: string; blob: Blob; file: string; at: number }
interface StrRec { key: string; orig: string; sr: number; chans: Float32Array[]; at: number }
const KEEP_PER_ORIG = 4; // copias por loop (los últimos BPM usados)

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('telar-warp', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('orig')) d.createObjectStore('orig', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('str')) d.createObjectStore('str', { keyPath: 'key' }).createIndex('orig', 'orig');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
async function idb<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise<T>((resolve, reject) => {
      const r = fn(d.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}

// originales también en memoria (si IndexedDB falla, al menos dura la sesión)
const origMem = new Map<string, OrigRec>();
async function getOrig(id: string): Promise<OrigRec | undefined> {
  return origMem.get(id) ?? (await idb<OrigRec>('orig', 'readonly', (s) => s.get(id) as IDBRequest<OrigRec>));
}
async function putOrig(rec: OrigRec): Promise<void> {
  origMem.set(rec.id, rec);
  await idb('orig', 'readwrite', (s) => s.put(rec));
}
async function putStr(rec: StrRec): Promise<void> {
  await idb('str', 'readwrite', (s) => s.put(rec));
  // poda: solo las últimas copias de este loop
  const all = await idb<StrRec[]>('str', 'readonly', (s) => s.index('orig').getAll(rec.orig) as IDBRequest<StrRec[]>);
  if (all && all.length > KEEP_PER_ORIG) {
    const old = all.sort((a, b) => b.at - a.at).slice(KEEP_PER_ORIG);
    for (const o of old) await idb('str', 'readwrite', (s) => s.delete(o.key));
  }
}

// id por contenido (el mismo archivo arrastrado dos veces es UN original)
async function contentId(bytes: ArrayBuffer): Promise<string> {
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // sin crypto.subtle (contexto no seguro): FNV-1a de 64 bits partido en dos
    const v = new Uint8Array(bytes);
    let a = 0x811c9dc5, b = 0x01000193 ^ v.length;
    for (let i = 0; i < v.length; i++) { a = Math.imul(a ^ v[i], 0x01000193) >>> 0; b = Math.imul(b ^ v[v.length - 1 - i], 0x01000193) >>> 0; }
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${v.length.toString(16)}`;
  }
}

// --- audio ---
const decoded = new Map<string, Promise<AudioBuffer | null>>(); // original decodificado (al rate del contexto)
function decodeOrig(id: string): Promise<AudioBuffer | null> {
  let p = decoded.get(id);
  if (!p) {
    p = (async () => {
      const rec = await getOrig(id);
      if (!rec) return null;
      try {
        return await getAudioContext().decodeAudioData(await rec.blob.arrayBuffer());
      } catch {
        return null;
      }
    })();
    decoded.set(id, p);
    p.then((b) => { if (!b) decoded.delete(id); }, () => decoded.delete(id));
  }
  return p;
}

const urlOf = new Map<string, string>(); // clave → objectURL ESTABLE (superdough cachea por URL)
const regKey = new Map<string, string>(); // nombre → clave de lo que tiene registrado ahora
const want = new Map<string, string>(); // nombre → clave que corresponde al BPM actual
const jobs = new Map<string, Promise<string | null>>(); // clave → copia en camino

async function registerUrl(name: string, key: string, url: string): Promise<void> {
  await samples({ [name]: url });
  // calienta el caché de superdough: el primer disparo con el audio nuevo no llega tarde
  try { await loadBuffer(url, getAudioContext()); } catch { /* lo cargará al disparar */ }
  regKey.set(name, key);
}

const wavUrl = (chans: Float32Array[], sr: number) => URL.createObjectURL(new Blob(encodeWav(chans, sr, 32) as BlobPart[], { type: 'audio/wav' }));
const chansOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
const short = (x: number) => Math.round(x * 100) / 100;

// el original tal cual (one-shots sin transponer, y su copia rápida)
async function rawUrl(w: WarpInfo): Promise<string | null> {
  const key = `raw|${w.orig}`;
  const have = urlOf.get(key);
  if (have) return have;
  const rec = await getOrig(w.orig);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlOf.set(key, url);
  return url;
}

// Copia RÁPIDA (varispeed, milisegundos): en la rejilla desde ya, con el tono corrido hasta que
// llegue la de Rubber Band (un one-shot: el original). null = falta el original.
async function quickUrl(w: WarpInfo, songBpm: number): Promise<string | null> {
  if (w.shot) return rawUrl(w);
  const key = `q|${warpKey(w, songBpm)}`;
  const have = urlOf.get(key);
  if (have) return have;
  const buf = await decodeOrig(w.orig);
  if (!buf) return null;
  const sr = buf.sampleRate;
  const loop = targetFrames(w.beats, songBpm, sr);
  const ratio = stretchRatio(w.srcBpm, songBpm);
  const chans = fadeTail(varispeedLoop(chansOf(buf), (w.beats * 60 * sr) / w.srcBpm, ratio, loop + tailFrames(sr)), loop, sr);
  const url = wavUrl(chans, sr);
  urlOf.set(key, url);
  return url;
}

// copia de Rubber Band al BPM del tema: memoria → IndexedDB → estirar. null = no se pudo.
function stretchedUrl(w: WarpInfo, songBpm: number): Promise<string | null> {
  const key = warpKey(w, songBpm);
  const have = urlOf.get(key);
  if (have) return Promise.resolve(have);
  let job = jobs.get(key);
  if (job) return job;
  job = (async () => {
    // one-shot en su tono: el original tal cual
    if (w.shot && Math.abs(w.semis ?? 0) < 1e-3) return rawUrl(w);
    const hit = await idb<StrRec>('str', 'readonly', (s) => s.get(key) as IDBRequest<StrRec>);
    let chans = hit?.chans;
    let sr = hit?.sr ?? 0;
    if ((!chans || sr !== getAudioContext().sampleRate) && w.shot) {
      // ONE-SHOT TONAL (5.3): solo transponer, mismo largo (formantes si es voz)
      const buf = await decodeOrig(w.orig);
      if (!buf) return null;
      sr = buf.sampleRate;
      const t0 = performance.now();
      const out = await warpChannels(chansOf(buf), sr, { semitones: w.semis ?? 0, formant: !!w.formant });
      if (!out) return null;
      chans = extractLoop(out, 0, buf.length);
      console.info(`[warp] ${w.file ?? w.name}: ${(w.semis ?? 0) > 0 ? '+' : ''}${w.semis} st en ${Math.round(performance.now() - t0)} ms`);
      void putStr({ key, orig: w.orig, sr, chans, at: Date.now() });
    }
    if (!chans || sr !== getAudioContext().sampleRate) {
      const buf = await decodeOrig(w.orig);
      if (!buf) return null;
      sr = buf.sampleRate;
      const src = chansOf(buf);
      const ratio = stretchRatio(w.srcBpm, songBpm);
      const semis = w.semis ?? 0;
      const loop = targetFrames(w.beats, songBpm, sr);
      const frames = loop + tailFrames(sr);
      if (Math.abs(ratio - 1) < 1e-4 && Math.abs(semis) < 1e-3) {
        // mismo tempo y tono: el original, a la vuelta exacta + cola (continuación circular)
        chans = varispeedLoop(src, (w.beats * 60 * sr) / w.srcBpm, 1, frames);
      } else {
        // contexto circular de hasta 1 s a cada lado, cada tiempo clavado en su sitio (cuadros
        // clave) y la vuelta del medio hecha periódica → en la rejilla y sin clic en la unión
        const pad = Math.min(buf.length, Math.round(sr));
        const t0 = performance.now();
        const out = await warpChannels(circularPad(src, pad), sr, {
          timeRatio: ratio,
          semitones: semis,
          formant: !!w.formant,
          keyFrames: beatKeyFrames(pad, w.beats, w.srcBpm, sr, ratio),
        });
        if (!out) return null;
        chans = seamLoop(out, pad * ratio, loop, frames - loop, Math.round(SEAM_S * sr));
        console.info(`[warp] ${w.file ?? w.name}: ${w.srcBpm}→${short(songBpm)} bpm${semis ? `, ${semis > 0 ? '+' : ''}${semis} st` : ''} en ${Math.round(performance.now() - t0)} ms`);
      }
      fadeTail(chans, loop, sr);
      void putStr({ key, orig: w.orig, sr, chans, at: Date.now() });
    }
    const url = wavUrl(chans, sr);
    urlOf.set(key, url);
    return url;
  })().finally(() => jobs.delete(key));
  jobs.set(key, job);
  return job;
}

// ¿La copia buena ya está a mano (memoria o IndexedDB, al rate del contexto)?
async function cachedUrl(w: WarpInfo, songBpm: number): Promise<string | null> {
  const key = warpKey(w, songBpm);
  if (urlOf.has(key)) return urlOf.get(key)!;
  const hit = await idb<StrRec>('str', 'readonly', (s) => s.get(key) as IDBRequest<StrRec>);
  if (!hit || hit.sr !== getAudioContext().sampleRate) return null;
  return stretchedUrl(w, songBpm); // la arma desde el caché (sin estirar)
}

// Un loop al BPM del tema: la copia buena si ya existe; si no, la rápida YA (en la rejilla) y la
// buena en cuanto Rubber Band termine. false = falta el original en este navegador.
async function syncOne(w: WarpInfo, songBpm: number, o: { background?: boolean } = {}): Promise<boolean> {
  const key = warpKey(w, songBpm);
  want.set(w.name, key);
  if (regKey.get(w.name) === key) return true;
  const ready = await cachedUrl(w, songBpm).catch(() => null);
  if (ready) {
    if (want.get(w.name) === key) await registerUrl(w.name, key, ready);
    flag('missing', w.name, false);
    return true;
  }
  const q = await quickUrl(w, songBpm).catch(() => null);
  if (!q) {
    flag('missing', w.name, true);
    return false;
  }
  flag('missing', w.name, false);
  if (want.get(w.name) === key && regKey.get(w.name) !== key) await registerUrl(w.name, `q|${key}`, q);
  const good = (async () => {
    flag('busy', w.name, true);
    try {
      const url = await stretchedUrl(w, songBpm);
      // si mientras tanto cambió el BPM, esta copia ya no sirve (otra llamada registra la buena)
      if (url && want.get(w.name) === key) await registerUrl(w.name, key, url);
    } catch (e) {
      console.warn('[warp] no se pudo estirar', w.name, e);
    } finally {
      if (want.get(w.name) === key) flag('busy', w.name, false);
    }
  })();
  if (!o.background) await good;
  return true;
}

interface WarpNode { data: { kind?: string; code?: string; warp?: unknown } }
const warpsIn = (nodes: WarpNode[]): WarpInfo[] => {
  const seen = new Map<string, WarpInfo>();
  for (const n of nodes) {
    const w = n.data.warp as WarpInfo | undefined;
    if (n.data.kind !== 'source' || !w || !w.name || seen.has(w.name)) continue;
    if (!(n.data.code ?? '').includes(w.name)) continue; // el código ya no lo usa
    seen.set(w.name, w);
  }
  return [...seen.values()];
};

// Todos los loops del proyecto al BPM del tema. `wait` = esperar las copias (exportar);
// sin él, registra lo que haya al instante y estira en segundo plano (▶, cambio de BPM).
export async function syncWarpedLoops(
  nodes: WarpNode[],
  songBpm: number,
  o: { wait?: boolean; key?: { root: number; minor: boolean } | null; transpose?: number } = {},
): Promise<void> {
  // cada sample con los semitonos que le tocan con la tonalidad actual del tema (5.3)
  const list = warpsIn(nodes).map((w) => ({ ...w, semis: effectiveSemis(w, o.key ?? null, o.transpose ?? 0) }));
  if (!list.length || !(songBpm > 0)) return;
  try {
    await ensureEngine();
  } catch {
    return;
  }
  // sin `wait`: cada loop queda sonando (copia buena o rápida) antes de volver; Rubber Band sigue
  // en segundo plano. Con `wait`: vuelve cuando todos tienen la copia buena.
  await Promise.all(list.map((w) => syncOne(w, songBpm, { background: !o.wait }).catch(() => false)));
}

// firma de los loops de un proyecto (para saber si hay que sincronizar al cambiar los nodos)
export const warpSignature = (nodes: WarpNode[]) => warpsIn(nodes).map((w) => `${warpKey(w, 0)}${w.name}|${w.follow !== false}|${w.oct ?? 0}`).join(',');

// Un archivo como loop al tempo del tema. null = no es un loop limpio (sin BPM en el nombre ni
// un pulso que encaje con su duración) → el llamador lo deja a su tempo natural.
export async function importLoop(o: {
  blob: Blob;
  fileName: string;
  clean: string; // nombre visible (sin artista, BPM ni tonalidad)
  hintBpm?: number; // BPM del nombre (Splice)
  key?: { root: number; minor: boolean | null }; // tonalidad del nombre (Splice)
  formant?: boolean; // es una voz: al transponer conserva los formantes
  detect?: boolean; // probar la detección de pulso si no hay BPM en el nombre (def. true)
  songBpm: number;
  beatsPerCycle: number;
}): Promise<{ code: string; warp: WarpInfo } | null> {
  try {
    await ensureEngine();
    const bytes = await o.blob.arrayBuffer();
    const buf = await getAudioContext().decodeAudioData(bytes.slice(0));
    // sin BPM en el nombre, solo los samples LARGOS (más de ~1 compás y 2 s) se prueban como loop:
    // un one-shot corto con un pulso casual no debe re-dispararse cada 2 tiempos
    const cycleSec = (60 * (o.beatsPerCycle || 4)) / (o.songBpm || 120);
    if (!o.hintBpm && (o.detect === false || buf.duration < Math.max(2, 1.2 * cycleSec))) return null;
    const det = o.hintBpm ? null : await detectBpmBuffer(buf);
    const grid = loopGrid(buf.duration, { hintBpm: o.hintBpm, detectedBpm: det, songBpm: o.songBpm });
    if (!grid || grid.beats < (o.hintBpm ? 2 : 4)) return null;
    const orig = await contentId(bytes);
    await putOrig({ id: orig, blob: o.blob, file: o.fileName, at: Date.now() });
    decoded.set(orig, Promise.resolve(buf));
    const warp: WarpInfo = { name: warpName(o.clean), orig, file: o.fileName, srcBpm: grid.bpm, beats: grid.beats, ...(o.key ? { key: o.key } : {}), ...(o.formant ? { formant: true } : {}) };
    return { code: warpCode(warp.name, warpCycles(grid.beats, o.beatsPerCycle)), warp };
  } catch (e) {
    console.warn('[warp] no pude preparar el loop', o.fileName, e);
    return null;
  }
}

// Un ONE-SHOT tonal (nombre con tonalidad: «stab_F», «vox_Gmin») → se transpone a la tonalidad del
// tema sin estirar (Fase 5.3). null = no se pudo decodificar.
export async function importShot(o: { blob: Blob; fileName: string; clean: string; key: { root: number; minor: boolean | null }; formant?: boolean }): Promise<{ code: string; warp: WarpInfo } | null> {
  try {
    await ensureEngine();
    const bytes = await o.blob.arrayBuffer();
    const buf = await getAudioContext().decodeAudioData(bytes.slice(0));
    const orig = await contentId(bytes);
    await putOrig({ id: orig, blob: o.blob, file: o.fileName, at: Date.now() });
    decoded.set(orig, Promise.resolve(buf));
    const warp: WarpInfo = { name: warpName(o.clean), orig, file: o.fileName, srcBpm: 0, beats: 0, shot: true, key: o.key, ...(o.formant ? { formant: true } : {}) };
    return { code: `s("${warp.name}")`, warp };
  } catch (e) {
    console.warn('[warp] no pude preparar el one-shot', o.fileName, e);
    return null;
  }
}

// Arranca un loop recién importado o corregido: vuelve cuando ya suena (el original, en la
// rejilla) y la copia estirada llega sola en segundo plano.
export function startWarp(w: WarpInfo, songBpm: number): Promise<boolean> {
  return syncOne(w, songBpm, { background: true }).catch(() => false);
}

// ¿Qué tempo tiene guardado un original? (para corregir: la duración real del archivo)
export async function warpOriginalSeconds(w: WarpInfo): Promise<number> {
  const b = await decodeOrig(w.orig).catch(() => null);
  return b ? b.duration : 0;
}

// Re-sincronizar al cambiar el BPM (con espera: el knob del BPM manda muchos cambios seguidos)
// o al cambiar los loops del proyecto (cargar, deshacer, pegar). Solo con el motor andando: al
// darle ▶ se sincroniza todo igualmente.
interface SyncState {
  nodes: WarpNode[];
  cps: number;
  beatsPerCycle: number;
  playing: boolean;
  songKey: { root: number; minor: boolean } | null;
  transpose: number;
}
export function initWarpSync(api: { getState: () => SyncState; subscribe: (fn: (s: SyncState, p: SyncState) => void) => () => void }): () => void {
  let timer = 0;
  const kick = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const s = api.getState();
      if (s.playing) void syncWarpedLoops(s.nodes, (s.cps || 0.5) * 60 * (s.beatsPerCycle || 4), { key: s.songKey, transpose: s.transpose });
    }, ms);
  };
  const unsub = api.subscribe((s, p) => {
    if (!s.playing) return;
    if (s.cps !== p.cps || s.beatsPerCycle !== p.beatsPerCycle || s.songKey !== p.songKey || s.transpose !== p.transpose) kick(600);
    else if (s.nodes !== p.nodes && warpSignature(s.nodes) !== warpSignature(p.nodes)) kick(50);
  });
  return () => { clearTimeout(timer); unsub(); };
}
