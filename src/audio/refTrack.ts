// PISTA DE REFERENCIA (Fase 6.3): un tema terminado de tu carpeta para comparar tu mezcla.
//   · Al cargarlo se mide su loudness integrado (BS.1770, igual que el informe de exportar) y su
//     curva tonal (espectro promedio en 1/6 de octava). Se guarda en el navegador (IndexedDB).
//   · A/B: en B suena la referencia (directo a la salida, sin el máster de Telar: ya viene
//     masterizada) IGUALADA al loudness de tu mezcla, y tu mezcla se calla en la salida (sigue
//     sonando por dentro: medidores y grabación no se enteran). En A, al revés. Así comparas
//     balance y pegada sin que «más fuerte» parezca «mejor».
//   · Curva de tu mezcla en vivo (misma ventana y bandas) para ver las dos encima.
import { create } from 'zustand';
import { getAudioContext } from '@strudel/web';
import { ensureAudioReady, setMixAudible, getMasterPostNode, isOfflineRendering } from './engine';
import { getLufs, startLufs } from './lufsMeter';
import { measureLoudness } from '../lib/loudness';
import { averageSpectrum, blockPower, powerToBands, toDbBands, matchGainDb } from '../lib/refSpectrum';

interface RefState {
  name: string | null;
  lufs: number | null; // integrada de la referencia
  spectrum: number[] | null; // dB por banda (sin normalizar)
  ab: 'A' | 'B';
  gainDb: number; // ajuste que se le aplica para igualarla
  busy: boolean; // cargando / analizando
}
export const useRefStore = create<RefState>(() => ({ name: null, lufs: null, spectrum: null, ab: 'A', gainDb: 0, busy: false }));

let buffer: AudioBuffer | null = null;
let src: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let startedAt = 0; // currentTime al arrancar
let offset = 0; // segundo de la referencia donde va (al parar)
let timer = 0;

// --- guardar/recuperar la última referencia (IndexedDB) ---
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('telar-ref', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('ref')) r.result.createObjectStore('ref'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function saveRef(rec: { name: string; blob: Blob; lufs: number; spectrum: number[] } | null): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const t = d.transaction('ref', 'readwrite');
      if (rec) t.objectStore('ref').put(rec, 'last');
      else t.objectStore('ref').delete('last');
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } catch { /* sin IndexedDB: solo esta sesión */ }
}
async function loadSaved(): Promise<{ name: string; blob: Blob; lufs: number; spectrum: number[] } | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const g = d.transaction('ref', 'readonly').objectStore('ref').get('last');
      g.onsuccess = () => res((g.result as { name: string; blob: Blob; lufs: number; spectrum: number[] }) ?? null);
      g.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

const chansOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

// Carga un tema de referencia (mp3, wav…): lo decodifica, mide su loudness y su curva, y lo guarda.
export async function loadReference(file: Blob, name: string): Promise<boolean> {
  useRefStore.setState({ busy: true });
  try {
    stopRef();
    const buf = await getAudioContext().decodeAudioData(await file.arrayBuffer());
    // medir sin congelar el clic (cede un cuadro antes de lo pesado)
    await new Promise((r) => setTimeout(r, 0));
    const chans = chansOf(buf);
    const lufs = measureLoudness(chans, buf.sampleRate).integrated;
    const spectrum = Array.from(averageSpectrum(chans, buf.sampleRate));
    buffer = buf;
    offset = 0;
    useRefStore.setState({ name, lufs: Number.isFinite(lufs) ? lufs : null, spectrum, ab: 'A', gainDb: 0 });
    void saveRef({ name, blob: file, lufs, spectrum });
    return true;
  } catch (e) {
    console.warn('[referencia] no pude cargarla', e);
    return false;
  } finally {
    useRefStore.setState({ busy: false });
  }
}

// la última referencia (al abrir el panel); sin volver a medir
export async function restoreReference(): Promise<void> {
  if (buffer || useRefStore.getState().busy) return;
  const rec = await loadSaved();
  if (!rec) return;
  try {
    buffer = await getAudioContext().decodeAudioData(await rec.blob.arrayBuffer());
    useRefStore.setState({ name: rec.name, lufs: Number.isFinite(rec.lufs) ? rec.lufs : null, spectrum: rec.spectrum });
  } catch { /* archivo ilegible: queda sin referencia */ }
}

export function clearReference(): void {
  stopRef();
  setMixAudible(true);
  buffer = null;
  offset = 0;
  useRefStore.setState({ name: null, lufs: null, spectrum: null, ab: 'A', gainDb: 0 });
  void saveRef(null);
}

// ajuste para oírla al loudness de tu mezcla (integrada si ya hay, si no la de 3 s)
function targetGainDb(): number {
  const ref = useRefStore.getState().lufs;
  if (ref == null) return 0;
  const l = getLufs();
  const mix = Number.isFinite(l.integrated) ? l.integrated : l.short;
  return Number.isFinite(mix) ? matchGainDb(mix, ref) : useRefStore.getState().gainDb;
}
function applyGain(): void {
  const g = targetGainDb();
  useRefStore.setState({ gainDb: g });
  if (!gain) return;
  const t = gain.context.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(Math.pow(10, g / 20), t + 0.05);
}

function stopRef(): void {
  clearInterval(timer);
  if (src) {
    try {
      const ctx = src.context;
      offset = buffer ? (offset + (ctx.currentTime - startedAt)) % buffer.duration : 0;
      src.stop();
    } catch { /* ya parado */ }
    src = null;
  }
}

export async function setAB(ab: 'A' | 'B'): Promise<void> {
  if (ab === useRefStore.getState().ab) return;
  if (ab === 'B') {
    if (!buffer || isOfflineRendering()) return;
    await ensureAudioReady();
    startLufs();
    const ctx = getAudioContext();
    if (!gain || gain.context !== ctx) {
      gain = new GainNode(ctx, { gain: 0 });
      gain.connect(ctx.destination);
    }
    src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    src.connect(gain);
    startedAt = ctx.currentTime + 0.01;
    src.start(startedAt, offset % buffer.duration);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    applyGain();
    timer = window.setInterval(applyGain, 500); // sigue a tu mezcla si su loudness cambia
    setMixAudible(false);
  } else {
    stopRef();
    if (gain) gain.gain.setValueAtTime(0, gain.context.currentTime);
    setMixAudible(true);
  }
  useRefStore.setState({ ab });
}
export const toggleAB = () => setAB(useRefStore.getState().ab === 'A' ? 'B' : 'A');
export function restartReference(): void {
  const playing = useRefStore.getState().ab === 'B';
  stopRef();
  offset = 0;
  if (playing) { useRefStore.setState({ ab: 'A' }); void setAB('B'); }
}

// --- curva de TU mezcla en vivo (misma ventana y bandas que la de la referencia) ---
const FFT = 4096;
let analyser: AnalyserNode | null = null;
let tapped: AudioNode | null = null;
let ema: Float64Array | null = null;
const tbuf = new Float32Array(FFT);
export function mixSpectrumTick(): number[] | null {
  try {
    const post = getMasterPostNode();
    if (!post) return null;
    if (!analyser || tapped !== post) {
      analyser = new AnalyserNode(post.context, { fftSize: FFT, smoothingTimeConstant: 0 });
      post.connect(analyser);
      tapped = post;
      ema = null;
    }
    analyser.getFloatTimeDomainData(tbuf);
    let e = 0;
    for (let i = 0; i < FFT; i++) e += tbuf[i] * tbuf[i];
    if (e / FFT < 1e-6) return ema ? Array.from(toDbBands(ema)) : null; // en silencio no se mueve
    const bands = powerToBands(blockPower(tbuf, FFT), post.context.sampleRate, FFT);
    if (!ema) ema = bands;
    else for (let i = 0; i < bands.length; i++) ema[i] = 0.94 * ema[i] + 0.06 * bands[i]; // ~2 s
    return Array.from(toDbBands(ema));
  } catch {
    return null;
  }
}
export function resetMixSpectrum(): void {
  ema = null;
}
