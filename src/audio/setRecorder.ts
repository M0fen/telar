// GRABADOR DEL SET (modo DJ, DJ-4): graba LO QUE SUENA (el máster, después del bus) a MP3 320 mientras
// se toca — codificado por trozos en un worker, así una hora de set no se come la memoria — y anota la
// TRACKLIST: cada tema que SUBE a la sala (tocando, sin mute, con su fader y el crossfader arriba), con
// su minuto. Al parar quedan el MP3, la lista para pegar y un .cue (los reproductores parten el set en
// temas con él).
import { create } from 'zustand';
import { getAudioCtx, getMasterPostNode } from './engine';
import { useGraphStore } from '../store/useGraphStore';
import { useSongDecks } from './songDeck';
import { isDeck } from './djMix';
import { busFaderOf } from '../graph/compile';
import { camelot } from '../lib/djDeck';
import { emptyLog, logStep, type DeckNow, type SetEntry, type SetLogState } from '../lib/setList';
import type { NodeData } from '../graph/types';

export interface SetResult { blob: Blob; name: string; secs: number; bytes: number; entries: SetEntry[]; when: Date }
interface SetRecState {
  rec: boolean;
  startedAt: number; // Date.now() al arrancar (para el reloj de la vista)
  entries: SetEntry[];
  finishing: boolean;
  result: SetResult | null;
  error: string | null;
}
export const useSetRec = create<SetRecState>(() => ({ rec: false, startedAt: 0, entries: [], finishing: false, result: null, error: null }));

const TAP = 'telar-set-tap';
const TAP_SRC = `
class SetTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true; this.cap = 16384; this.n = 0; this.t0 = false;
    this.l = new Float32Array(this.cap); this.r = new Float32Array(this.cap);
    this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage('done'); } };
  }
  flush() {
    if (!this.n) return;
    const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n);
    this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    this.n = 0;
  }
  process(inputs) {
    if (!this.on) return false;
    const i = inputs[0];
    if (i && i[0] && i[0].length) {
      if (!this.t0) { this.t0 = true; this.port.postMessage({ t0: currentTime }); }
      const L = i[0], R = i[1] && i[1].length ? i[1] : i[0];
      if (this.n + L.length > this.cap) this.flush();
      this.l.set(L, this.n); this.r.set(R, this.n); this.n += L.length;
      if (this.n >= this.cap) this.flush();
    }
    return true;
  }
}
registerProcessor('${TAP}', SetTap);
`;
const loaded = new WeakSet<BaseAudioContext>();
async function ensureTap(ctx: AudioContext): Promise<void> {
  if (loaded.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([TAP_SRC], { type: 'application/javascript' }));
  try { await ctx.audioWorklet.addModule(url); loaded.add(ctx); } finally { URL.revokeObjectURL(url); }
}

let tap: AudioWorkletNode | null = null;
let sink: GainNode | null = null;
let src: AudioNode | null = null;
let worker: Worker | null = null;
let t0: number | null = null; // hora del contexto de la primera muestra
let sr = 48000;
let poll = 0;
let log: SetLogState = emptyLog();

// qué decks de tema suenan en la sala ahora
function decksNow(): DeckNow[] {
  const g = useGraphStore.getState();
  const ui = useSongDecks.getState().d;
  const decks = g.nodes.filter((n) => isDeck(n as { id: string; data: NodeData }));
  const anySolo = decks.some((n) => (n.data as NodeData).solo);
  const out: DeckNow[] = [];
  decks.forEach((n, i) => {
    const d = n.data as NodeData;
    const t = d.djTrack;
    if (!t || !t.id) return;
    const u = ui[n.id];
    const playing = !!u?.playing && !u.preview;
    out.push({ id: n.id, trackId: t.id, title: t.title, deck: i + 1, audible: playing && busFaderOf(d, g.xfader, anySolo) > 0.05, bpm: t.bpm, key: camelot(t.key) || undefined });
  });
  return out;
}
function step(): void {
  if (!useSetRec.getState().rec || t0 == null) return;
  const t = getAudioCtx().currentTime - t0;
  const r = logStep(log, decksNow(), t);
  log = r.st;
  if (r.add.length) useSetRec.setState((s) => ({ entries: [...s.entries, ...r.add] }));
}

export async function startSet(): Promise<boolean> {
  if (useSetRec.getState().rec) return false;
  const out = getMasterPostNode();
  if (!out) { useSetRec.setState({ error: 'Dale ▶ a algo primero: aún no hay audio que grabar.' }); return false; }
  const ctx = getAudioCtx();
  try {
    await ensureTap(ctx);
    sr = ctx.sampleRate;
    worker = new Worker(new URL('./setRecWorker.ts', import.meta.url), { type: 'module' });
    worker.postMessage({ init: { sampleRate: sr, kbps: 320 } });
    tap = new AudioWorkletNode(ctx, TAP, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    t0 = null;
    tap.port.onmessage = (e) => {
      const d = e.data as { l?: Float32Array; r?: Float32Array; t0?: number } | string;
      if (typeof d === 'string') return;
      if (typeof d.t0 === 'number') { t0 = d.t0; step(); return; }
      if (d.l && d.r) worker?.postMessage({ l: d.l, r: d.r }, [d.l.buffer as ArrayBuffer, d.r.buffer as ArrayBuffer]);
    };
    sink = new GainNode(ctx, { gain: 0 });
    out.connect(tap);
    tap.connect(sink);
    sink.connect(ctx.destination);
    src = out;
  } catch (e) {
    cleanup();
    useSetRec.setState({ error: `No pude empezar a grabar (${String(e).slice(0, 80)}).` });
    return false;
  }
  log = emptyLog();
  useSetRec.setState({ rec: true, startedAt: Date.now(), entries: [], result: null, error: null, finishing: false });
  poll = window.setInterval(step, 250);
  return true;
}

function cleanup(): void {
  window.clearInterval(poll);
  try { if (src && tap) src.disconnect(tap); } catch { /* nodo en transición */ }
  try { tap?.disconnect(); } catch { /* */ }
  try { sink?.disconnect(); } catch { /* */ }
  tap = null; sink = null; src = null;
}

export async function stopSet(): Promise<SetResult | null> {
  if (!useSetRec.getState().rec) return null;
  step();
  useSetRec.setState({ rec: false, finishing: true });
  // el último trozo del worklet (los mensajes del puerto llegan en orden)
  if (tap) {
    await new Promise<void>((resolve) => {
      const w = tap!;
      const timer = window.setTimeout(resolve, 600);
      const prev = w.port.onmessage;
      w.port.onmessage = (e) => { if (e.data === 'done') { window.clearTimeout(timer); resolve(); } else prev?.call(w.port, e); };
      try { w.port.postMessage('stop'); } catch { window.clearTimeout(timer); resolve(); }
    });
  }
  cleanup();
  const wk = worker;
  worker = null;
  if (!wk) { useSetRec.setState({ finishing: false }); return null; }
  const res = await new Promise<{ parts: Uint8Array[]; frames: number; bytes: number } | null>((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 60000);
    wk.onmessage = (e: MessageEvent<{ parts?: Uint8Array[]; frames?: number; bytes?: number; error?: string }>) => {
      if (e.data.parts) { window.clearTimeout(timer); resolve({ parts: e.data.parts, frames: e.data.frames ?? 0, bytes: e.data.bytes ?? 0 }); }
      if (e.data.error) { window.clearTimeout(timer); resolve(null); }
    };
    wk.postMessage({ stop: true });
  });
  wk.terminate();
  if (!res) { useSetRec.setState({ finishing: false, error: 'No pude terminar el MP3 del set.' }); return null; }
  const when = new Date();
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}-${String(when.getHours()).padStart(2, '0')}${String(when.getMinutes()).padStart(2, '0')}`;
  const result: SetResult = {
    blob: new Blob(res.parts as BlobPart[], { type: 'audio/mpeg' }),
    name: `set-telar-${stamp}`,
    secs: res.frames / sr,
    bytes: res.bytes,
    entries: useSetRec.getState().entries,
    when,
  };
  useSetRec.setState({ finishing: false, result });
  return result;
}

// si la página se cierra a mitad de set no hay nada que salvar; si el modo DJ se cierra, se sigue
// grabando (el set puede pasar por el lienzo o la DAW)
export const setElapsed = (): number => (useSetRec.getState().rec && t0 != null ? getAudioCtx().currentTime - t0 : 0);
