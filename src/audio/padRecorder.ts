// GRABAR DESDE LOS PADS (Fase 7.1) — los 16 pads del controlador (M-Wave) TOCAN una pista y, con
// ● grabar y ▶, cada golpe entra en su rejilla: cuantizado a semicorcheas, con la fuerza del pad,
// en bucle (cada vuelta suma lo nuevo). Toda la toma es UN paso de deshacer.
//   · batería: cada pad un sonido fijo (los propios de la pista, luego bombo, caja, clap, hat…);
//   · escala: los pads son la escala del tema (dos octavas desde la octava elegida).
// La posición del golpe es la que OYES: el reloj del planificador menos lo que tarda el audio
// en salir por los altavoces. Las notas que no son de ningún control asignado llegan aquí
// (midiIn.claimNoteSink); el rebanador (5.4) y esto se turnan los pads.
import { create } from 'zustand';
import { getAudioContext } from '@strudel/web';
import { claimNoteSink, releaseNoteSink } from './midiIn';
import { getScheduler, isOfflineRendering } from './engine';
import { playDrumHit } from './playNote';
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { toast } from '../store/useNotifyStore';
import { timelinePos } from '../lib/songClock';
import { bankExempt, isMelodicCode, laneOwnBank, parseSeq, splitArrange, isSilenceArm, unmuteArm, isMutedArm } from '../nodes/stepseqCode';
import { PADS, baseOctave, drumPadMap, recordPadHit, scaleNote, velToGain, type PadMode } from '../lib/padRecord';

const BASE_KEY = 'telar.padrec.base';
const loadBase = () => {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    const v = Number(raw);
    return raw != null && v >= 0 && v <= 127 ? v : 36;
  } catch {
    return 36;
  }
};

interface PadRecState {
  armed: string | null; // pista que tocan los pads
  mode: PadMode;
  octave: number; // modo escala: octava del primer pad
  rec: boolean; // ● grabando (con ▶)
  base: number; // nota MIDI del pad 1
  learning: boolean; // el próximo pad que toques será el pad 1
  map: (string | null)[]; // modo batería: sonido de cada pad (fijo mientras la pista esté armada)
  hits: number; // golpes grabados en esta toma
  last: { pad: number; at: number } | null; // último pad tocado (para iluminarlo)
}
export const usePadRecStore = create<PadRecState>(() => ({
  armed: null,
  mode: 'drum',
  octave: 3,
  rec: false,
  base: loadBase(),
  learning: false,
  map: Array(PADS).fill(null),
  hits: 0,
  last: null,
}));

const st = () => usePadRecStore.getState();
const codeOf = (id: string) => (useGraphStore.getState().nodes.find((n) => n.id === id)?.data.code ?? '') as string;

// patrones editables de la pista (todas sus secciones)
function patterns(code: string): string[] {
  const arms = splitArrange(code);
  return arms ? arms.filter((a) => !isSilenceArm(a.code)).map((a) => (isMutedArm(a.code) ? unmuteArm(a.code) : a.code)) : [code];
}
// banco con el que suena un sonido de la pista (el de su pista en la rejilla, o el de la rejilla)
function bankFor(code: string, snd: string): string {
  if (bankExempt(snd)) return '';
  let grid = '';
  for (const c of patterns(code)) {
    const p = parseSeq(c);
    if (!p) continue;
    const lane = p.lanes.find((l) => l.sound === snd);
    if (lane && laneOwnBank(lane)) return laneOwnBank(lane);
    grid ||= p.bank;
  }
  return grid || 'RolandTR909';
}
// sonido de la pista en modo escala (el de su primera pista: un sintetizador o un sample afinado)
function melodicSound(code: string): string {
  for (const c of patterns(code)) {
    const p = parseSeq(c);
    if (p?.lanes.length) return p.lanes[0].sound;
  }
  return 'sawtooth';
}

let warnedAt = 0;
function sink(note: number, vel: number, down: boolean): void {
  if (!down) return;
  const s = st();
  if (!s.armed || isOfflineRendering()) return;
  if (s.learning) {
    try { localStorage.setItem(BASE_KEY, String(note)); } catch { /* sin almacenamiento */ }
    usePadRecStore.setState({ base: note, learning: false });
    return;
  }
  const pad = note - s.base;
  if (pad < 0 || pad >= PADS) return;
  const g = useGraphStore.getState();
  if (!g.nodes.some((n) => n.id === s.armed)) { armPadRec(null); return; }
  const code = codeOf(s.armed);
  const gain = velToGain(vel);
  // lo que suena al pulsar (aunque no grabes)
  if (s.mode === 'scale') {
    const snd = melodicSound(code);
    void playDrumHit(snd, bankFor(code, snd), scaleNote(pad, g.songKey, s.octave), 0.45, 0.75 * gain);
  } else {
    const snd = s.map[pad];
    if (!snd) return;
    void playDrumHit(snd, bankFor(code, snd), undefined, 0.6, 0.75 * gain);
  }
  usePadRecStore.setState({ last: { pad, at: performance.now() } });
  if (!s.rec || !g.playing) return;
  // dónde cae: lo que oyes = el reloj − lo que tarda en salir el audio
  const sched = getScheduler() as { now?: () => number; cps?: number } | undefined;
  const now = Number(sched?.now?.() ?? NaN);
  if (!Number.isFinite(now)) return;
  let lat = 0.05;
  try {
    const ctx = getAudioContext() as AudioContext;
    lat += (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
  } catch { /* sin contexto */ }
  const cps = Number(sched?.cps) || g.cps || 0.5;
  const bar = timelinePos(now - lat * cps, useSongStore.getState());
  const r = recordPadHit(code, { pad, sound: s.mode === 'drum' ? s.map[pad] : undefined, vel, bar, mode: s.mode, key: g.songKey, octave: s.octave });
  if (r) {
    g.updateNodeData(s.armed, { code: r.code });
    usePadRecStore.setState({ hits: st().hits + 1 });
  } else if (performance.now() - warnedAt > 4000) {
    warnedAt = performance.now();
    toast.warn('Esta pista no tiene una rejilla donde grabar (es un loop o un patrón avanzado). Crea una con «＋ batería» o «＋ melodía».');
  }
}

const lost = () => {
  if (st().rec) useGraphStore.getState().endTake();
  usePadRecStore.setState({ armed: null, rec: false, learning: false });
};

// arma una pista para los pads (o desarma con null). Modo por defecto: escala si es melódica.
export function armPadRec(id: string | null, mode?: PadMode): void {
  if (!id) {
    if (st().rec) setPadRec(false);
    releaseNoteSink(sink);
    usePadRecStore.setState({ armed: null, learning: false });
    return;
  }
  const code = codeOf(id);
  const m = mode ?? (isMelodicCode(code) ? 'scale' : 'drum');
  let octave = st().octave;
  if (m === 'scale') {
    const lanes = patterns(code).flatMap((c) => parseSeq(c)?.lanes ?? []);
    octave = baseOctave(lanes);
  }
  if (st().rec && st().armed !== id) setPadRec(false);
  usePadRecStore.setState({ armed: id, mode: m, octave, map: drumPadMap(code), learning: false });
  claimNoteSink(sink, lost);
}
export function setPadMode(mode: PadMode): void {
  const id = st().armed;
  if (id) armPadRec(id, mode);
  else usePadRecStore.setState({ mode });
}
export const setPadOctave = (o: number) => usePadRecStore.setState({ octave: Math.max(0, Math.min(6, Math.round(o))) });
export const learnPadBase = () => usePadRecStore.setState({ learning: true });

// ● grabar: abre una toma (un solo paso de deshacer) y arranca ▶ si estaba parado
export function setPadRec(on: boolean): void {
  const s = st();
  if (on === s.rec) return;
  const g = useGraphStore.getState();
  if (on) {
    if (!s.armed) { toast.info('Elige primero la pista que tocan los pads.'); return; }
    g.beginTake();
    usePadRecStore.setState({ rec: true, hits: 0 });
    if (!g.playing) void g.play();
    return;
  }
  g.endTake();
  usePadRecStore.setState({ rec: false });
  const name = g.nodes.find((n) => n.id === s.armed)?.data.name || 'la pista';
  if (s.hits > 0) toast.ok(`Toma: ${s.hits} golpe${s.hits === 1 ? '' : 's'} en «${name}». Ctrl+Z la deshace entera.`);
}
export const togglePadRec = () => setPadRec(!st().rec);

// pista NUEVA para grabar desde cero (16 pasos vacíos) y la arma
export function newPadTrack(kind: 'drum' | 'melody'): void {
  const g = useGraphStore.getState();
  const before = new Set(g.nodes.map((n) => n.id));
  const rests = Array(16).fill('~').join(' ');
  const n = g.nodes.filter((x) => x.data.kind === 'source').length + 1;
  g.addSources([
    kind === 'drum'
      ? { name: `batería ${n}`, code: `s("${rests}").bank("RolandTR909")` }
      : { name: `melodía ${n}`, code: `note("${rests}").s("sawtooth").lpf(1200).decay(0.25).sustain(0.3)` },
  ]);
  const created = useGraphStore.getState().nodes.find((x) => !before.has(x.id) && x.data.kind === 'source');
  if (created) armPadRec(created.id, kind === 'drum' ? 'drum' : 'scale');
}
