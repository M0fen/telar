// TEMAS DEL SET (modo DJ: decks de tema y biblioteca) — los archivos de audio y su análisis en
// IndexedDB («telar-dj»): sobreviven a recargar y no pesan en el proyecto (el deck solo guarda el id
// del tema, su rejilla y sus cues). El id es la huella del archivo: el mismo tema no se guarda dos veces.
// El análisis (tempo y rejilla, tonalidad, loudness, forma de onda resumida) se hace UNA vez.
import { guess } from 'web-audio-beat-detector';
import { getAudioCtx } from './engine';
import { detectKey, phraseBass } from '../lib/keyDetect';
import { measureLoudness } from '../lib/loudness';
import { bandPeaks, firstStrongBeat, normBands, onsetEnvelope, refineGrid } from '../lib/djDeck';
import { keyFromFileName, type SongKey } from '../lib/songKey';

export interface TrackMeta {
  id: string;
  name: string; // archivo
  title: string; // nombre a la vista (sin extensión)
  dur: number;
  bpm: number;
  first: number; // segundo de un 1 (la rejilla)
  beats: number;
  key: SongKey | null;
  lufs: number | null;
  size: number;
  at: number; // cuándo se guardó
  played?: number; // última vez que sonó en un set
  overview?: { pk: number[]; lo: number[]; mid: number[]; hi: number[] }; // 600 columnas, 0..1
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('telar-dj', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
function req<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve) => {
    try {
      const r = fn(d.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  })).catch(() => undefined);
}

export const getMeta = (id: string) => req<TrackMeta>('meta', 'readonly', (s) => s.get(id));
export const putMeta = (m: TrackMeta) => req('meta', 'readwrite', (s) => s.put(m));
export async function listMeta(): Promise<TrackMeta[]> {
  return ((await req<TrackMeta[]>('meta', 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => b.at - a.at);
}
export async function getBlob(id: string): Promise<Blob | null> {
  const r = await req<{ id: string; blob: Blob }>('files', 'readonly', (s) => s.get(id));
  return r?.blob ?? null;
}
export async function deleteTrack(id: string): Promise<void> {
  await req('files', 'readwrite', (s) => s.delete(id));
  await req('meta', 'readwrite', (s) => s.delete(id));
}

async function hashOf(ab: ArrayBuffer): Promise<string> {
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', ab));
    return Array.from(h.slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `t${ab.byteLength}_${Date.now().toString(36)}`;
  }
}

// mono (promedio de canales) de un tramo, remuestreado por diezmado simple
function monoSlice(buf: AudioBuffer, from: number, to: number, step = 1): Float32Array {
  const n = Math.max(0, Math.floor((to - from) / step));
  const out = new Float32Array(n);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  // promedio de cada tramo de `step` muestras (filtra antes de bajar la frecuencia: los platillos no se
  // doblan sobre las notas del cromagrama)
  for (let i = 0; i < n; i++) {
    const j = from + i * step;
    let v = 0;
    for (const ch of chans) for (let q = 0; q < step; q++) v += ch[j + q] ?? 0;
    out[i] = v / (chans.length * step);
  }
  return out;
}
const pause = () => new Promise((r) => setTimeout(r, 0));

// ANÁLISIS de un tema decodificado: tempo y un 1 (web-audio-beat-detector `guess`), tonalidad
// (cromagrama del tramo central), loudness (BS.1770 sobre 60 s centrales) y la forma de onda resumida
export async function analyzeTrack(buf: AudioBuffer, name: string): Promise<Omit<TrackMeta, 'id' | 'size' | 'at'>> {
  const dur = buf.duration;
  const sr = buf.sampleRate;
  let bpm = 0, first = 0;
  try {
    const off = dur > 60 ? Math.min(30, dur * 0.1) : 0;
    const g = await guess(buf, off, Math.min(60, dur - off), { minTempo: 80, maxTempo: 180 });
    // `bpm` viene redondeado; `tempo` es el de verdad. `offset` = un golpe del tramo analizado.
    bpm = Number((g as { tempo?: number }).tempo) || g.bpm;
    const beat = 60 / bpm;
    first = ((g.offset + off) % beat + beat) % beat;
  } catch { /* sin pulso claro: la rejilla se ajusta a mano */ }
  if (!(bpm > 0)) bpm = 120;
  await pause();
  // y se afina sobre TODO el tema con su envolvente de ataques (200 por segundo)
  const step0 = Math.max(1, Math.round(sr / 11025));
  const mono0 = monoSlice(buf, 0, buf.length, step0);
  const sr0 = sr / step0;
  const hop = Math.max(1, Math.round(sr0 / 200));
  const env = onsetEnvelope(mono0, sr0, hop);
  await pause();
  const r = refineGrid(env, sr0 / hop, bpm);
  bpm = Math.round(r.bpm * 1000) / 1000;
  first = firstStrongBeat(env, sr0 / hop, bpm, r.first);
  await pause();
  // tonalidad: del nombre si la trae (Splice), si no del audio (60 s centrales a 11 kHz)
  let key: SongKey | null = null;
  const fromName = keyFromFileName(name);
  if (fromName && fromName.minor != null) key = { root: fromName.root, minor: fromName.minor };
  else {
    const c0 = Math.floor(Math.max(0, dur / 2 - 30) * sr), c1 = Math.floor(Math.min(dur, dur / 2 + 30) * sr);
    const step = Math.max(1, Math.round(sr / 11025));
    // el bajo al arrancar cada frase de 8 compases (según la rejilla) desempata la relativa (las vueltas
    // de acordes duran 4 u 8 compases: cada 8 siempre cae en el arranque de la vuelta)
    const phrase = (32 * 60) / bpm, starts: number[] = [];
    for (let t = first; t < dur - 1; t += phrase) starts.push(t);
    const bass = starts.length >= 2 ? phraseBass(mono0, sr0, starts) : null;
    key = detectKey(monoSlice(buf, c0, c1, step), sr / step, bass);
  }
  await pause();
  let lufs: number | null = null;
  try {
    const c0 = Math.floor(Math.max(0, dur / 2 - 30) * sr), c1 = Math.floor(Math.min(dur, dur / 2 + 30) * sr);
    const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c).subarray(c0, c1));
    const r = measureLoudness(chans, sr);
    lufs = Number.isFinite(r.integrated) ? Math.round(r.integrated * 10) / 10 : null;
  } catch { /* sin medida: sin ganancia automática */ }
  await pause();
  const ov = normBands(bandPeaks(mono0, sr0, 600));
  const arr = (a: Float32Array) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
  return {
    name,
    title: name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'tema',
    dur, bpm, first, beats: 4, key, lufs,
    overview: { pk: arr(ov.pk), lo: arr(ov.lo), mid: arr(ov.mid), hi: arr(ov.hi) },
  };
}

// GUARDAR UN TEMA (archivo soltado o elegido): huella, archivo y análisis. Si ya estaba, lo devuelve.
export async function addTrack(file: Blob, name: string): Promise<{ meta: TrackMeta; buf: AudioBuffer } | null> {
  try {
    const ab = await file.arrayBuffer();
    const id = await hashOf(ab);
    const buf = await getAudioCtx().decodeAudioData(ab.slice(0));
    const have = await getMeta(id);
    if (have) return { meta: have, buf };
    const a = await analyzeTrack(buf, name);
    const meta: TrackMeta = { ...a, id, size: file.size, at: Date.now() };
    await req('files', 'readwrite', (s) => s.put({ id, blob: file }));
    await putMeta(meta);
    return { meta, buf };
  } catch {
    return null;
  }
}

// el audio decodificado de un tema guardado (para cargarlo en un deck)
const decoded = new Map<string, Promise<AudioBuffer | null>>();
export function loadBuffer(id: string): Promise<AudioBuffer | null> {
  let p = decoded.get(id);
  if (!p) {
    p = (async () => {
      const blob = await getBlob(id);
      if (!blob) return null;
      try { return await getAudioCtx().decodeAudioData(await blob.arrayBuffer()); } catch { return null; }
    })();
    decoded.set(id, p);
    void p.then((b) => { if (!b) decoded.delete(id); });
    // como mucho 6 temas decodificados a la vez en memoria (un tema de 6 min ≈ 130 MB)
    if (decoded.size > 6) decoded.delete(decoded.keys().next().value as string);
  }
  return p;
}
export const rememberBuffer = (id: string, buf: AudioBuffer) => { decoded.set(id, Promise.resolve(buf)); };
