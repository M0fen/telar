// DECKS DE TEMA (modo DJ, DJ-1) — el reproductor de cada deck que trae un tema completo.
//
// Un deck de tema es un Source con código `silence` y `data.djTrack`; su audio lo toca aquí un
// AudioBufferSourceNode que entra en la TIRA del deck (engine.setStripInput): volumen, crossfader,
// EQ con kill, filtro, cue en audífonos, mute/solo al compás y el MIDI actúan igual que en cualquier
// deck. La SESIÓN manda el tempo: con SYNC el tema va a tempo_sesión / tempo_tema (varispeed) y con
// su fase fija a la de la sesión (`lock` = tiempo del tema − tiempo de la sesión). Un guardián cada
// 100 ms corrige la deriva con un empujón de velocidad (±2 %) o, si se fue lejos, re-sincroniza.
// La posición se lleva ANALÍTICA (segmentos de velocidad constante, con su loop): la misma cuenta
// con la que el audio avanza, así cues, loops y saltos caen donde deben.
import { create } from 'zustand';
import { getAudioCtx, sessionClock, setStripInput, nextBarAudioTime, stripInputLinked } from './engine';
import { useGraphStore } from '../store/useGraphStore';
import { useDjStore } from './djMix';
import { addTrack, loadBuffer, rememberBuffer, getMeta, putMeta } from './trackStore';
import { toast } from '../store/useNotifyStore';
import {
  autoGainDb, bandPeaks, barLen, barOffset, beatAt, beatLen, gridDownbeatAt, gridOf, gridScale, gridShift, gridTempo, jumpBeats, lockedPos,
  loopFrom, normBands, posAt, snapPos, syncRate,
  type Bands, type DjTrack, type Grid, type PlayModel,
} from '../lib/djDeck';
import type { NodeData } from '../graph/types';

const gs = () => useGraphStore.getState();

export interface DeckUi { playing: boolean; loop: number | null; loading: boolean; missing: boolean; preview: boolean; nudging: number }
const UI0: DeckUi = { playing: false, loop: null, loading: false, missing: false, preview: false, nudging: 0 };
export const useSongDecks = create<{ d: Record<string, DeckUi> }>(() => ({ d: {} }));
const setUi = (id: string, patch: Partial<DeckUi>) => useSongDecks.setState((s) => ({ d: { ...s.d, [id]: { ...(s.d[id] ?? UI0), ...patch } } }));
export const deckUi = (id: string): DeckUi => useSongDecks.getState().d[id] ?? UI0;

interface RT {
  id: string;
  out: GainNode | null; // ganancia del tema → tira del deck
  node: AudioBufferSourceNode | null;
  ng: GainNode | null; // fundido corto al cortar (sin clic)
  buf: AudioBuffer | null;
  bufId: string | null;
  wave: Bands | null; // forma de onda fina (150 columnas por segundo) para la vista que corre
  m: PlayModel; // rate 0 = en pausa
  playing: boolean;
  lock: number; // con SYNC: tiempo del tema − tiempo de la sesión
  nudge: number; // empujón en curso (±)
  preview: boolean; // CUE mantenido
}
const rts = new Map<string, RT>();
const rtOf = (id: string): RT => {
  let r = rts.get(id);
  if (!r) {
    r = { id, out: null, node: null, ng: null, buf: null, bufId: null, wave: null, m: { t0: 0, pos0: 0, rate: 0, loop: null }, playing: false, lock: 0, nudge: 0, preview: false };
    rts.set(id, r);
  }
  return r;
};

export const isSongDeck = (n: { data: NodeData }) => !!n.data.djTrack;
const trackOf = (id: string): DjTrack | undefined => gs().nodes.find((n) => n.id === id)?.data.djTrack;
const setTrack = (id: string, patch: Partial<DjTrack>) => {
  const t = trackOf(id);
  if (t) gs().updateNodeData(id, { djTrack: { ...t, ...patch } });
};
const ctxNow = () => { try { return getAudioCtx().currentTime; } catch { return 0; } };

// TEMPO Y COMPÁS DE LA SESIÓN en la hora t del contexto (null = parada)
const beatsPerCycle = () => gs().beatsPerCycle || 4;
export function sessionBeat(t: number): number | null {
  const c = sessionClock();
  return c ? (c.n0 + (t - c.s0 - c.lat) * c.cps) * beatsPerCycle() : null;
}
const sessionBpm = () => { const c = sessionClock(); return (c?.cps ?? gs().cps ?? 0.5) * 60 * beatsPerCycle(); };
// hora del próximo tiempo de la sesión después de t
function nextBeatTime(t: number): number | null {
  const c = sessionClock();
  const sb = sessionBeat(t);
  if (!c || sb == null) return null;
  const b = Math.ceil(sb - 1e-6);
  return (b / beatsPerCycle() - c.n0) / c.cps + c.s0 + c.lat;
}

// posición del cabezal ahora (segundos del archivo)
export function deckPos(id: string): number {
  const r = rts.get(id);
  const t = trackOf(id);
  if (!r || !t) return t?.cue ?? 0;
  return posAt(r.m, ctxNow(), r.buf?.duration ?? t.dur);
}
// error de fase respecto de la sesión, en tiempos (−0,5…0,5; + = el tema va adelantado); null si no
// suena o la sesión está parada. Sin SYNC también: es lo que se mira para cuadrarlo a mano
export function deckPhase(id: string): number | null {
  const r = rts.get(id);
  const t = trackOf(id);
  if (!r || !t || !r.playing || r.preview) return null;
  const sb = sessionBeat(ctxNow());
  if (sb == null) return null;
  const e = beatAt(gridOf(t), deckPos(id)) - sb;
  return e - Math.round(e);
}
// COMPÁS contra la sesión (DJ-2): en qué tiempo del compás va el tema y en cuál la sesión, y cuántos
// tiempos están corridos (0 = los 1 caen juntos). null si no suena o la sesión está parada
export function deckBars(id: string): { deck: number; session: number; off: number } | null {
  const r = rts.get(id);
  const t = trackOf(id);
  if (!r || !t || !r.playing || r.preview) return null;
  const sb = sessionBeat(ctxNow());
  if (sb == null) return null;
  const g = gridOf(t);
  const db = beatAt(g, deckPos(id));
  const B = Math.max(1, g.beats);
  const bpc = beatsPerCycle();
  return { deck: ((Math.floor(db + 0.02) % B) + B) % B, session: ((Math.floor(sb + 0.02) % bpc) + bpc) % bpc, off: barOffset(db, sb, B) };
}
// ¿suena el audio en su tira? (fuera del modo DJ el deck no tiene tira)
export const deckRouted = (id: string) => stripInputLinked(id);
export const deckRate = (id: string): number => rts.get(id)?.m.rate ?? 0;
export const deckLoopRegion = (id: string) => rts.get(id)?.m.loop ?? null;

function ensureOut(r: RT): GainNode | null {
  try {
    const ctx = getAudioCtx();
    if (!r.out || r.out.context !== ctx) {
      r.out = new GainNode(ctx, { gain: 1 });
      setStripInput(r.id, r.out);
    }
    const t = trackOf(r.id);
    const db = t?.trim ?? autoGainDb(t?.lufs);
    r.out.gain.setTargetAtTime(Math.pow(10, db / 20), ctx.currentTime, 0.02);
    return r.out;
  } catch {
    return null;
  }
}

// FORMA DE ONDA FINA: mono a ~11 kHz, 150 columnas por segundo, por bandas (se calcula al cargar)
export const WAVE_RATE = 150;
function computeWave(r: RT): void {
  const buf = r.buf;
  if (!buf) return;
  const step = Math.max(1, Math.round(buf.sampleRate / 11025));
  const n = Math.floor(buf.length / step);
  const mono = new Float32Array(n);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) { let v = 0; for (const ch of chans) v += ch[i * step]; mono[i] = v / chans.length; }
  r.wave = normBands(bandPeaks(mono, buf.sampleRate / step, Math.max(1, Math.round(buf.duration * WAVE_RATE))));
  setUi(r.id, {}); // que la vista se entere
}
export const deckWave = (id: string): Bands | null => rts.get(id)?.wave ?? null;

// el audio del tema (de IndexedDB la primera vez)
async function ready(id: string): Promise<RT | null> {
  const t = trackOf(id);
  if (!t) return null;
  const r = rtOf(id);
  if (!r.buf || r.bufId !== t.id) {
    setUi(id, { loading: true });
    const buf = await loadBuffer(t.id);
    setUi(id, { loading: false, missing: !buf });
    if (!buf) { toast.warn(`Falta el audio de «${t.title}» en este navegador: vuelve a cargar el archivo en el deck.`); return null; }
    r.buf = buf;
    r.bufId = t.id;
    r.wave = null;
    if (!r.playing) r.m = { t0: 0, pos0: t.cue, rate: 0, loop: null };
  }
  if (!r.wave) window.setTimeout(() => computeWave(r), 0);
  return ensureOut(r) ? r : null;
}
// precarga (la vista del deck la pide al montarse: forma de onda y audio listos antes del ▶)
export const deckPrepare = (id: string) => { void ready(id); };

function killNode(r: RT, at: number): void {
  const n = r.node, g = r.ng;
  r.node = null;
  r.ng = null;
  if (!n || !g) return;
  try {
    g.gain.cancelScheduledValues(at);
    g.gain.setValueAtTime(g.gain.value, at);
    g.gain.linearRampToValueAtTime(0, at + 0.006);
    n.stop(at + 0.02);
  } catch { try { n.stop(); } catch { /* ya parado */ } }
}

function startNode(r: RT, at: number, pos: number, rate: number, loop: { a: number; b: number } | null): void {
  if (!r.buf || !r.out) return;
  const ctx = getAudioCtx();
  const t0 = Math.max(at, ctx.currentTime + 0.01);
  // si la hora pedida ya pasó, arranca un poco más adelante en el tema (la fase no se corre)
  const p = Math.max(0, Math.min(r.buf.duration - 0.01, pos + (t0 - at) * rate));
  const src = new AudioBufferSourceNode(ctx, { buffer: r.buf, playbackRate: rate });
  const L = loop && loop.b > loop.a && p < loop.b ? loop : null;
  if (L) { src.loop = true; src.loopStart = L.a; src.loopEnd = L.b; }
  const ng = new GainNode(ctx, { gain: 0 });
  src.connect(ng);
  ng.connect(r.out);
  ng.gain.setValueAtTime(0, t0);
  ng.gain.linearRampToValueAtTime(1, t0 + 0.006);
  src.start(t0, p);
  killNode(r, t0);
  r.node = src;
  r.ng = ng;
  r.m = { t0, pos0: p, rate, loop: L };
  src.onended = () => {
    if (r.node !== src) return;
    // llegó al final del tema
    r.node = null;
    r.playing = false;
    r.m = { t0: ctx.currentTime, pos0: r.buf?.duration ?? p, rate: 0, loop: null };
    setUi(r.id, { playing: false, preview: false });
  };
}

// velocidad de base del deck (sin el empujón): con SYNC, la de la sesión; si no, su pitch
function baseRate(t: DjTrack): number {
  return t.sync === false ? 1 + (t.pitch ?? 0) : syncRate(sessionBpm(), gridOf(t));
}
// re-ancla el modelo y cambia la velocidad en `at` (sin cortar el audio)
function setRate(r: RT, rate: number, at: number): void {
  if (!r.node || !r.buf) return;
  if (Math.abs(rate - r.m.rate) < 1e-7) return;
  const pos = posAt(r.m, at, r.buf.duration);
  try { r.node.playbackRate.setValueAtTime(rate, at); } catch { return; }
  r.m = { t0: at, pos0: pos, rate, loop: r.m.loop };
}

// el reloj de la sesión, arrancándolo si estaba parado (con SYNC el tema lo necesita)
async function clockRunning(): Promise<boolean> {
  if (sessionClock()) return true;
  try { await gs().play(); } catch { return false; }
  for (let k = 0; k < 40 && !sessionClock(); k++) await new Promise((res) => setTimeout(res, 25));
  // recién arrancado, el planificador recoloca su cuenta en los primeros tics: se espera a que asiente
  await new Promise((res) => setTimeout(res, 160));
  return !!sessionClock();
}

// ▶ — con SYNC entra en el 1 del próximo compás de la sesión (con «♩ al compás»), en fase
export async function deckPlay(id: string): Promise<void> {
  const r = await ready(id);
  const t = trackOf(id);
  if (!r || !t) return;
  if (r.playing && !r.preview) return;
  const sync = t.sync !== false;
  if (sync && !(await clockRunning())) { toast.warn('No pude arrancar el reloj de la sesión: dale ▶ arriba y vuelve a intentar.'); return; }
  const g = gridOf(t);
  const now = ctxNow();
  let at = now + 0.04;
  let pos = r.preview ? deckPos(id) : r.m.pos0;
  if (sync) {
    const c = sessionClock()!;
    const startOfZero = (0 - c.n0) / c.cps + c.s0 + c.lat; // la sesión recién arrancada: su primer compás
    if (!r.preview && useDjStore.getState().quantize) at = startOfZero > now + 0.03 ? startOfZero : nextBarAudioTime(0.06)?.at ?? at;
    const sb = sessionBeat(at) ?? 0;
    r.lock = Math.round(beatAt(g, pos) - sb);
    pos = lockedPos(g, sb, r.lock);
  }
  r.preview = false;
  startNode(r, at, pos, baseRate(t), r.m.loop);
  r.playing = true;
  setUi(id, { playing: true, preview: false });
  touchPlayed(t.id);
}

export function deckPause(id: string): void {
  const r = rts.get(id);
  if (!r || !r.playing) return;
  const now = ctxNow();
  const pos = posAt(r.m, now, r.buf?.duration ?? 0);
  killNode(r, now + 0.005);
  r.m = { t0: now, pos0: pos, rate: 0, loop: r.m.loop };
  r.playing = false;
  r.preview = false;
  setUi(id, { playing: false, preview: false });
}
export const deckToggle = (id: string) => { if (rts.get(id)?.playing && !rts.get(id)?.preview) deckPause(id); else void deckPlay(id); };

function seek(r: RT, pos: number): void {
  const dur = r.buf?.duration ?? trackOf(r.id)?.dur ?? 0;
  r.m = { t0: ctxNow(), pos0: Math.max(0, Math.min(dur, pos)), rate: 0, loop: r.m.loop && pos >= r.m.loop.a && pos < r.m.loop.b ? r.m.loop : null };
  if (!r.m.loop) setUi(r.id, { loop: null });
}

// CUE (como un CDJ): sonando → vuelve al cue y para; parado fuera del cue → pone el cue ahí (en el
// tiempo); parado en el cue → suena mientras lo mantienes (para cuadrarlo en los audífonos)
export async function deckCueDown(id: string): Promise<void> {
  const r = await ready(id);
  const t = trackOf(id);
  if (!r || !t) return;
  if (r.playing && !r.preview) { deckPause(id); seek(r, t.cue); return; }
  const pos = r.m.pos0;
  if (Math.abs(pos - t.cue) > 0.02) {
    const c = snapPos(gridOf(t), pos, 'beat');
    setTrack(id, { cue: c });
    seek(r, c);
    return;
  }
  startNode(r, ctxNow() + 0.01, t.cue, baseRate(t), null);
  r.playing = true;
  r.preview = true;
  setUi(id, { playing: true, preview: true });
}
export function deckCueUp(id: string): void {
  const r = rts.get(id);
  const t = trackOf(id);
  if (!r || !t || !r.preview) return;
  deckPause(id);
  seek(r, t.cue);
}

// salta a `pos` sonando: con SYNC en el próximo tiempo de la sesión y en fase
function jumpTo(r: RT, t: DjTrack, pos: number): void {
  if (!r.playing || r.preview) { seek(r, pos); return; }
  const g = gridOf(t);
  const now = ctxNow();
  let at = now + 0.03;
  let p = pos;
  if (t.sync !== false && sessionClock()) {
    if (useDjStore.getState().quantize) at = Math.max(at, nextBeatTime(now + 0.03) ?? at);
    const sb = sessionBeat(at) ?? 0;
    r.lock = Math.round(beatAt(g, pos) - sb);
    p = lockedPos(g, sb, r.lock);
  }
  startNode(r, at, p, r.m.rate || baseRate(t), null);
  setUi(r.id, { loop: null });
}

// IR A un punto del tema (clic en la onda): parado, el cabezal va ahí; sonando, salta en fase
export async function deckSeek(id: string, pos: number): Promise<void> {
  const r = await ready(id);
  const t = trackOf(id);
  if (!r || !t) return;
  const p = snapPos(gridOf(t), pos, 'beat');
  if (!r.playing || r.preview) seek(r, p);
  else jumpTo(r, t, p);
  setUi(id, {});
}

// CUES RÁPIDOS: vacío → lo pone donde suena (en el tiempo); con cue → salta ahí
export async function deckHot(id: string, k: number, clear = false): Promise<void> {
  const t = trackOf(id);
  if (!t) return;
  const hot = [...(t.hot ?? [])];
  while (hot.length < 4) hot.push(null);
  if (clear) { hot[k] = null; setTrack(id, { hot }); return; }
  const r = await ready(id);
  if (!r) return;
  if (hot[k] == null) { hot[k] = snapPos(gridOf(t), deckPos(id), 'beat'); setTrack(id, { hot }); return; }
  jumpTo(r, t, hot[k]!);
}

// SALTO de ±N compases (manteniendo la fase)
export async function deckJump(id: string, bars: number): Promise<void> {
  const r = await ready(id);
  const t = trackOf(id);
  if (!r || !t || !r.buf) return;
  const g = gridOf(t);
  const delta = bars * barLen(g);
  if (!r.playing || r.preview) { seek(r, r.m.pos0 + delta); return; }
  const at = ctxNow() + 0.03;
  const p = posAt(r.m, at, r.buf.duration) + delta;
  if (p < 0 || p > r.buf.duration - 0.05) return;
  if (t.sync !== false) r.lock += jumpBeats(g, bars);
  const keep = r.m.loop && p >= r.m.loop.a && p < r.m.loop.b ? r.m.loop : null;
  startNode(r, at, p, r.m.rate, keep);
  if (!keep) setUi(id, { loop: null });
}

// LOOP de N compases desde el tiempo donde suena (null o el mismo = salir del loop)
export async function deckLoop(id: string, bars: number | null): Promise<void> {
  const r = await ready(id);
  const t = trackOf(id);
  if (!r || !t || !r.buf) return;
  const g = gridOf(t);
  const now = ctxNow();
  const cur = deckUi(id).loop;
  if (bars == null || cur === bars) {
    // salir: el audio sigue de largo; el lock queda en la relación de ahora (el loop corrió el tema)
    if (r.node) r.node.loop = false;
    const pos = posAt(r.m, now, r.buf.duration);
    r.m = { t0: now, pos0: pos, rate: r.m.rate, loop: null };
    const sb = sessionBeat(now);
    if (r.playing && sb != null && t.sync !== false) r.lock = beatAt(g, pos) - sb;
    setUi(id, { loop: null });
    return;
  }
  const pos = r.playing ? posAt(r.m, now, r.buf.duration) : r.m.pos0;
  const L = loopFrom(g, pos, bars);
  if (L.b > r.buf.duration) return;
  if (r.playing && r.node) {
    r.node.loopStart = L.a;
    r.node.loopEnd = L.b;
    r.node.loop = true;
    r.m = { t0: now, pos0: pos, rate: r.m.rate, loop: L };
  } else r.m = { ...r.m, loop: L };
  setUi(id, { loop: bars });
}

// SYNC: al encender, el tema toma el tempo de la sesión y su fase se corrige al tiempo más cercano
export async function deckSync(id: string, on: boolean): Promise<void> {
  const t = trackOf(id);
  if (!t) return;
  const r = rts.get(id);
  // al apagarlo el tema sigue al tempo al que iba (el pitch toma esa velocidad: nada salta)
  const pitch = on ? t.pitch : clampPitch(syncRate(sessionBpm(), gridOf(t)) - 1);
  setTrack(id, { sync: on, pitch });
  if (!r || !r.playing || !r.buf) return;
  const tt = { ...t, sync: on, pitch };
  if (!on) { setRate(r, baseRate(tt), ctxNow() + 0.02); return; }
  if (!(await clockRunning())) return;
  const g = gridOf(tt);
  const at = ctxNow() + 0.03;
  const sb = sessionBeat(at) ?? 0;
  const pos = posAt(r.m, at, r.buf.duration);
  r.lock = Math.round(beatAt(g, pos) - sb);
  startNode(r, at, lockedPos(g, sb, r.lock), baseRate(tt), r.m.loop);
}

// EMPUJAR (mantenido): ±4 % para correr la fase a mano; al soltar, el lock queda donde lo dejaste
export function deckNudge(id: string, dir: -1 | 0 | 1): void {
  const r = rts.get(id);
  const t = trackOf(id);
  if (!r || !t || !r.playing) { setUi(id, { nudging: 0 }); return; }
  const at = ctxNow() + 0.01;
  r.nudge = dir * 0.04;
  setRate(r, baseRate(t) * (1 + r.nudge), at);
  setUi(id, { nudging: dir });
  if (dir === 0 && t.sync !== false) {
    const sb = sessionBeat(at);
    if (sb != null && r.buf) r.lock = beatAt(gridOf(t), posAt(r.m, at, r.buf.duration)) - sb;
  }
}

// TEMPO DE LA SESIÓN = el de este tema (para tocarlo a su tempo y que los demás lo sigan)
export function sessionToTrack(id: string): void {
  const t = trackOf(id);
  if (!t) return;
  const g = gs();
  g.setCpsValue(t.bpm / 60 / (g.beatsPerCycle || 4));
}

// TEMPO A MANO (sin SYNC): ±16 % sobre el tempo del tema, como el fader de pitch de un CDJ
export const PITCH_RANGE = 0.16;
const clampPitch = (p: number) => Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, Number.isFinite(p) ? p : 0));
export function deckPitch(id: string, pitch: number): void {
  const t = trackOf(id);
  if (!t) return;
  const p = Math.abs(pitch) < 0.0008 ? 0 : clampPitch(pitch);
  setTrack(id, { pitch: p });
  const r = rts.get(id);
  if (r?.playing && t.sync === false) setRate(r, baseRate({ ...t, pitch: p }) * (1 + r.nudge), ctxNow() + 0.02);
}

// lo que SE OYE ahora (el cabezal menos lo que tarda la salida): para marcar «aquí» a oído
function heardPos(r: RT): number {
  const now = ctxNow();
  let lat = 0;
  try { const c = getAudioCtx() as AudioContext & { outputLatency?: number }; lat = (c.outputLatency || 0) + (c.baseLatency || 0); } catch { /* */ }
  return posAt(r.m, Math.max(r.m.t0, now - lat), r.buf?.duration ?? 0);
}

// REJILLA A MANO (DJ-2): el 1 aquí, correr un tiempo o unos ms, ×2 / ÷2 o un tempo escrito. Queda
// guardada con el tema (la próxima vez carga corregido) y, sonando con SYNC, el guardián lo lleva a
// la rejilla nueva al instante
export type GridEdit = { kind: 'one' } | { kind: 'beat'; dir: -1 | 1 } | { kind: 'ms'; sec: number } | { kind: 'x2' } | { kind: 'half' } | { kind: 'bpm'; bpm: number };
export async function deckGrid(id: string, e: GridEdit): Promise<void> {
  const t = trackOf(id);
  if (!t || !(t.dur > 0)) return;
  const r = rts.get(id);
  const g = gridOf(t);
  const pos = r ? (r.playing && !r.preview ? heardPos(r) : r.m.pos0) : t.cue;
  let n: Grid = g;
  if (e.kind === 'one') n = gridDownbeatAt(g, pos);
  else if (e.kind === 'beat') n = gridShift(g, e.dir * beatLen(g));
  else if (e.kind === 'ms') n = gridShift(g, e.sec);
  else if (e.kind === 'x2') n = gridScale(g, 2);
  else if (e.kind === 'half') n = gridScale(g, 0.5);
  else if (e.kind === 'bpm') n = gridTempo(g, Math.round(e.bpm * 1000) / 1000);
  if (n === g || (n.bpm === g.bpm && n.first === g.first)) return;
  const nt = { ...t, bpm: Math.round(n.bpm * 1000) / 1000, first: n.first };
  // sonando: la fase nueva se fija YA, junto con la rejilla (si no, el guardián vería la rejilla nueva
  // con la fase vieja y saltaría); el tiempo de la sesión más cercano — el audio no salta más de medio
  // tiempo, y si los compases quedan corridos, lo dice el medidor
  if (r && r.playing && !r.preview && r.buf) {
    const now = ctxNow();
    if (t.sync !== false) {
      const sb = sessionBeat(now);
      if (sb != null) r.lock = Math.round(beatAt(gridOf(nt), posAt(r.m, now, r.buf.duration)) - sb);
    }
    setRate(r, baseRate(nt) * (1 + r.nudge), now + 0.02);
  }
  setTrack(id, { bpm: nt.bpm, first: nt.first });
  const m = await getMeta(t.id);
  if (m) await putMeta({ ...m, bpm: nt.bpm, first: nt.first });
}

// ALINEAR COMPASES: si el tema va en fase pero sus 1 no caen con los de la sesión, salta los tiempos
// que falten (tiempos enteros: la fase no se mueve). En un loop no (el loop manda)
export async function deckAlignBars(id: string): Promise<void> {
  const r = await ready(id);
  const t = trackOf(id);
  const b = deckBars(id);
  if (!r || !t || !r.buf || !b || b.off === 0 || r.m.loop) return;
  if (t.sync !== false) { r.lock -= b.off; keeper(); return; } // el guardián salta ya, en fase
  const at = ctxNow() + 0.03;
  const target = posAt(r.m, at, r.buf.duration) - b.off * beatLen(gridOf(t));
  if (target >= 0) jumpTo(r, t, target);
}

// GUARDIÁN DE FASE: cada 100 ms, con SYNC, lleva el tema a donde la sesión dice
function keeper(): void {
  const now = ctxNow();
  for (const r of rts.values()) {
    if (!r.playing || r.preview || !r.node || !r.buf) continue;
    const t = trackOf(r.id);
    if (!t || t.sync === false || r.nudge) continue;
    const sb = sessionBeat(now);
    if (sb == null) continue;
    const g = gridOf(t);
    const base = baseRate(t);
    const pos = posAt(r.m, now, r.buf.duration);
    let err = beatAt(g, pos) - (sb + r.lock); // tiempos; + = el tema va adelantado
    if (r.m.loop) err -= Math.round(err); // en loop solo cuenta la fase
    if (Math.abs(err) > 0.03) {
      // más de ~15 ms: el reloj de la sesión se re-ancló (al arrancar o al cambiar el tempo, Strudel
      // recoloca su cuenta de ciclos) — doblar la velocidad tardaría segundos; se re-sincroniza ya,
      // con un fundido de 6 ms
      const at = now + 0.03;
      const sb2 = sessionBeat(at) ?? sb;
      startNode(r, at, r.m.loop ? posAt(r.m, at, r.buf.duration) : lockedPos(g, sb2, r.lock), base, r.m.loop);
      continue;
    }
    const errSec = err * beatLen(g);
    let rate = Math.abs(err) < 0.002 ? base : base - errSec / 0.5; // corrige en ~medio segundo
    rate = Math.max(base * 0.98, Math.min(base * 1.02, rate));
    setRate(r, rate, now + 0.02);
  }
}
let keeperTimer = 0;

// CARGAR un archivo en un deck (lo guarda y lo analiza la primera vez)
export async function deckLoadFile(id: string, file: Blob, name: string): Promise<boolean> {
  setUi(id, { loading: true });
  const res = await addTrack(file, name);
  if (!res) { setUi(id, { loading: false }); toast.warn(`No pude leer «${name}» como audio.`); return false; }
  const { meta, buf } = res;
  rememberBuffer(meta.id, buf);
  const r = rtOf(id);
  if (r.playing) deckPause(id);
  r.buf = buf;
  r.bufId = meta.id;
  r.wave = null;
  r.m = { t0: 0, pos0: meta.first, rate: 0, loop: null };
  window.setTimeout(() => computeWave(r), 0);
  const prev = trackOf(id);
  const t: DjTrack = {
    id: meta.id, title: meta.title, bpm: meta.bpm, first: meta.first, beats: meta.beats, dur: meta.dur,
    key: meta.key, lufs: meta.lufs, cue: meta.first, hot: [null, null, null, null], sync: prev?.sync ?? true,
  };
  gs().updateNodeData(id, { name: meta.title, djTrack: t });
  ensureOut(r);
  setUi(id, { loading: false, missing: false, playing: false, loop: null, preview: false });
  return true;
}

// DECK NUEVO con un tema (en pausa, en su cue: suena al darle ▶)
export async function newSongDeck(file: Blob, name: string): Promise<string | null> {
  const title = name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim() || 'tema';
  const placeholder: DjTrack = { id: '', title, bpm: 120, first: 0, beats: 4, dur: 0, cue: 0, hot: [null, null, null, null], sync: true };
  const id = gs().addPattern('silence', title, { mute: false, djTrack: placeholder } as Partial<NodeData>);
  if (!id) return null;
  const ok = await deckLoadFile(id, file, name);
  if (!ok) { gs().removeNode?.(id); return null; }
  return id;
}

async function touchPlayed(trackId: string): Promise<void> {
  const m = await getMeta(trackId);
  if (m) await putMeta({ ...m, played: Date.now() });
}

// ciclo de vida: ■ de la sesión o salir del modo DJ → los temas paran (en su sitio); un deck
// borrado suelta su reproductor; el guardián corre mientras haya algo sonando
let inited = false;
export function initSongDecks(): void {
  if (inited) return;
  inited = true;
  keeperTimer = window.setInterval(keeper, 100);
  useGraphStore.subscribe((s, p) => {
    if ((p.playing && !s.playing) || (p.mode === 'dj' && s.mode !== 'dj')) for (const r of rts.values()) if (r.playing) deckPause(r.id);
    if (s.nodes !== p.nodes) {
      for (const id of Array.from(rts.keys())) {
        if (!s.nodes.some((n) => n.id === id && n.data.djTrack)) {
          const r = rts.get(id)!;
          killNode(r, ctxNow());
          setStripInput(id, null);
          rts.delete(id);
          useSongDecks.setState((st) => { const d = { ...st.d }; delete d[id]; return { d }; });
        }
      }
    }
  });
}
export const stopKeeper = () => window.clearInterval(keeperTimer);
