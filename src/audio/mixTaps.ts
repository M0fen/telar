// TOMAS DE ANÁLISIS DE LA MEZCLA (Fase 11): analizadores pasivos (no tocan el sonido) sobre la tira de
// una pista y sobre el máster (lo que suena, post-bus), para el EQ visual, el análisis del máster y
// el estéreo. Se crean al mirar y se sueltan al cerrar.
import { getAudioCtx, getMasterPostNode, getSourceAnalyser, getSourceStripOut } from './engine';

interface Tap { src: AudioNode; an: AnalyserNode }
const tracks = new Map<string, Tap>();

// espectro de una pista en dB por bin (salida de su tira; si no tiene, su toma `.analyze`).
// Devuelve el analizador usado (para la frecuencia de cada bin) o null.
export function readTrackSpectrum(id: string, buf: { data: Float32Array<ArrayBuffer> | null }): AnalyserNode | null {
  try {
    const strip = getSourceStripOut(id);
    let t = tracks.get(id);
    if (strip && (!t || t.src !== strip)) {
      if (t) { try { t.src.disconnect(t.an); } catch { /* */ } }
      const an = new AnalyserNode(strip.context, { fftSize: 4096, smoothingTimeConstant: 0.78 });
      strip.connect(an);
      t = { src: strip, an };
      tracks.set(id, t);
    }
    const an = t && strip ? t.an : (getSourceAnalyser(id) ?? null);
    if (!an) return null;
    if (!buf.data || buf.data.length !== an.frequencyBinCount) buf.data = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(buf.data);
    return an;
  } catch {
    return null;
  }
}
export function releaseTrackSpectrum(id: string): void {
  const t = tracks.get(id);
  if (!t) return;
  try { t.src.disconnect(t.an); } catch { /* */ }
  tracks.delete(id);
}

interface MasterTap { src: AudioNode; an: AnalyserNode; split: ChannelSplitterNode; l: AnalyserNode; r: AnalyserNode }
let master: MasterTap | null = null;
let masterUsers = 0;
export function masterTap(): MasterTap | null {
  try {
    const post = getMasterPostNode();
    if (!post) return null;
    if (!master || master.src !== post) {
      dropMaster();
      const ctx = getAudioCtx();
      const an = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0.8 });
      const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
      const l = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0 });
      const r = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0 });
      post.connect(an);
      post.connect(split);
      split.connect(l, 0);
      split.connect(r, 1);
      master = { src: post, an, split, l, r };
    }
    return master;
  } catch {
    return null;
  }
}
function dropMaster(): void {
  if (!master) return;
  try { master.src.disconnect(master.an); master.src.disconnect(master.split); master.split.disconnect(); } catch { /* */ }
  master = null;
}
export function holdMasterTap(): () => void {
  masterUsers++;
  return () => { masterUsers--; if (masterUsers <= 0) { masterUsers = 0; dropMaster(); } };
}
