// EXPORTAR (Modo DAW, Fases 3.3–4.2): la canción entera o una región a WAV, y los stems (3.4).
// Por defecto se renderiza OFFLINE (ver «RENDER OFFLINE» abajo). El camino en TIEMPO REAL
// (renderPass) queda de respaldo: se detiene, se arranca desde el
// compás pedido sin bucles, a partir del compás N no arranca ningún evento nuevo (`stopAt`) y la
// toma se recorta con precisión de muestra desde el instante en que suena el ciclo 0 del
// transporte (sacado del propio scheduler). Al terminar (o cancelar) todo vuelve como estaba.
import { create } from 'zustand';
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { getScheduler, getMasterPostNode, getAudioCtx, getMasterPostLatency } from '../audio/engine';
import { startAudioRecording, stopAudioRecording, isAudioRecording } from './audioRecorder';
import { makeZip, type ZipEntry } from './zip';
import { toast } from '../store/useNotifyStore';
import { keyShort } from './songKey';
import { useScenesStore } from '../store/useScenesStore';
import { bakeSong } from './songBake';
import { renderOffline, renderBusOver } from '../audio/offlineRender';
import { wavHeader } from './wavEncode';
import { encodeAudio } from './exportEncode';
import { exportFileName, type ExportFormat } from './audioFormats';
import { measureLoudness, reportText, type LoudnessReport } from './loudness';
import type { BakedSection } from './songBake';
import { hapsToNotes, buildMidi, type MidiTrack } from './midiExport';
import { ensureEngine } from '../audio/engine';
import { SRC_ANALYSER_PREFIX } from '../graph/compile';

export const EXPORT_TAIL_S = 2.5;

// Preferencias de entrega (Fase 4.3), por usuario: formato y frecuencia ('live' = la del audio
// en vivo, sin conversión).
export type ExportRate = 'live' | 44100 | 48000;
const FORMATS: ExportFormat[] = ['wav24', 'wav16', 'wav32f', 'mp3'];
function readPref<T>(key: string, ok: (v: unknown) => v is T, dflt: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return dflt;
    const v = JSON.parse(raw) as unknown;
    return ok(v) ? v : dflt;
  } catch {
    return dflt;
  }
}
const isFormat = (v: unknown): v is ExportFormat => FORMATS.includes(v as ExportFormat);
const isRate = (v: unknown): v is ExportRate => v === 'live' || v === 44100 || v === 48000;
// objetivo de loudness (Fase 4.4): 'mix' = como suena; −14 = streaming; −8 = club
export type ExportTarget = 'mix' | -14 | -8;
const isTarget = (v: unknown): v is ExportTarget => v === 'mix' || v === -14 || v === -8;

export interface ExportReport {
  what: string; // 'master', 'region 9-16', …
  report: LoudnessReport;
  gainDb: number; // lo que se empujó el limitador para llegar al objetivo
  target: ExportTarget;
  reached: boolean;
}

export interface ExportUi {
  busy: boolean;
  frac: number; // 0–1
  label: string;
  format: ExportFormat;
  rate: ExportRate;
  target: ExportTarget;
  last: ExportReport | null; // informe de la última exportación
}
export const useExportStore = create<ExportUi>(() => ({
  busy: false,
  frac: 0,
  label: '',
  format: readPref('telar.export.format', isFormat, 'wav24'),
  rate: readPref('telar.export.rate', isRate, 'live'),
  target: readPref('telar.export.target', isTarget, 'mix'),
  last: null,
}));
export function setExportPrefs(p: { format?: ExportFormat; rate?: ExportRate; target?: ExportTarget }): void {
  useExportStore.setState(p);
  try {
    if (p.format) localStorage.setItem('telar.export.format', JSON.stringify(p.format));
    if (p.rate) localStorage.setItem('telar.export.rate', JSON.stringify(p.rate));
    if (p.target != null) localStorage.setItem('telar.export.target', JSON.stringify(p.target));
  } catch {
    /* preferencia de comodidad */
  }
}
let cancelFlag = false;
export function cancelExport(): void {
  cancelFlag = true;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Instante (tiempo del AudioContext) en que suena el ciclo 0 del transporte: lo agenda el
// propio Cyclist de Strudel (targetTime = (ciclo − ciclos_al_cambio)/cps + segundos_al_cambio
// + latencia). null si aún no hubo un primer tick.
// `after`: tiempo del AudioContext justo antes de dar play — los campos del scheduler de una
// vuelta ANTERIOR (play aún no arrancó el reloj: el swap del patrón es asíncrono) no valen.
function cycleZeroTime(after: number): number | null {
  const s = getScheduler() as unknown as {
    started?: boolean;
    num_ticks_since_cps_change?: number;
    seconds_at_cps_change?: number;
    num_cycles_at_cps_change?: number;
    latency?: number;
    cps?: number;
  } | undefined;
  if (!s || !s.started || !(Number(s.num_ticks_since_cps_change) > 0) || typeof s.seconds_at_cps_change !== 'number') return null;
  if (s.seconds_at_cps_change < after - 0.05) return null;
  const cps = Number(s.cps) || useGraphStore.getState().cps || 0.5;
  return s.seconds_at_cps_change + (Number(s.latency) || 0) - (Number(s.num_cycles_at_cps_change) || 0) / cps;
}

export interface ExportOpts {
  start: number; // compás de inicio (desde 0)
  bars: number; // compases a grabar
  pre?: boolean; // tap PRE-bus del máster (stems: sin limitador ni EQ del máster)
  label?: string; // texto del progreso
  progress?: (done: number) => void; // 0–1 de ESTA pasada (los stems la escalan)
}

// Una pasada: devuelve el WAV (o null si se canceló / no se pudo grabar).
export async function renderPass(o: ExportOpts): Promise<Blob | null> {
  if (isAudioRecording()) return null;
  // ■ SIEMPRE (no solo si la vista dice «sonando»): el reloj tiene que arrancar desde 0
  await useGraphStore.getState().stop();
  // la salida del máster existe recién tras el primer play: calentar si nunca sonó
  if (!getMasterPostNode()) {
    await useGraphStore.getState().play();
    await wait(400);
    await useGraphStore.getState().stop();
    await wait(300);
  }
  const song = useSongStore.getState();
  song.setRegionOn(false);
  song.setFrom(o.start);
  song.setStopAt(o.bars);
  try {
    if (!(await startAudioRecording({ pre: !!o.pre }))) return null;
    const ctx = getAudioCtx();
    const before = ctx.currentTime;
    await useGraphStore.getState().play();
    if (useSongStore.getState().steps.length) useSongStore.getState().setPlaying(true);
    let t0: number | null = null;
    for (let i = 0; i < 150 && t0 == null; i++) {
      t0 = cycleZeroTime(before);
      if (t0 == null) await wait(20);
    }
    if (t0 == null) {
      // sin el instante exacto del compás 1 la toma saldría corrida: mejor no entregarla
      toast.warn('No pude sincronizar la grabación con el compás 1: no se exportó nada. Intenta de nuevo.');
      return null;
    }
    // post-máster: el limitador (y el bus, si está activo) retrasan la salida unos ms → se
    // recorta igual de tarde, y la mezcla queda alineada a la muestra con los stems (pre-bus)
    if (!o.pre) t0 += await getMasterPostLatency();
    const cps = useGraphStore.getState().cps || 0.5;
    const seconds = o.bars / cps + EXPORT_TAIL_S;
    while (ctx.currentTime < t0 + seconds) {
      if (cancelFlag) {
        await stopAudioRecording();
        return null;
      }
      o.progress?.(Math.max(0, Math.min(1, (ctx.currentTime - t0) / seconds)));
      await wait(120);
    }
    return await stopAudioRecording({ from: t0, seconds });
  } finally {
    if (isAudioRecording()) await stopAudioRecording();
    await useGraphStore.getState().stop(); // también vuelve `from` a 0
    useSongStore.getState().setStopAt(null);
  }
}

// --- RENDER OFFLINE (Fase 4.2) --------------------------------------------------------------
// Camino por defecto: la canción horneada (escenas incluidas) renderizada en un
// OfflineAudioContext con el bus de Telar → más rápido que el tiempo real y sin cortes. Si
// falla, se exporta en tiempo real (renderPass) como antes.
const OWN_TEMPO = /\b(cpm|cps|setcps|setcpm)\s*\(/;

interface WavFile {
  blob: Blob;
  frames: number;
  channels: number;
  bits: number;
  float: boolean;
  sampleRate: number;
}

// frecuencia de salida según la preferencia (la del audio en vivo si no se pidió otra)
const outRate = (sr: number): number => {
  const r = useExportStore.getState().rate;
  return r === 'live' ? sr : r;
};

// BPM del proyecto (para el nombre del archivo)
const projectBpm = (): number => {
  const g = useGraphStore.getState();
  return (g.cps || 0.5) * 60 * (g.beatsPerCycle || 4);
};
export const exportName = (part: string, ext: string): string => {
  const g = useGraphStore.getState();
  // la tonalidad que SUENA (la del tema + el tono), como «Am» → pergolero_132bpm_Am_master.wav
  return exportFileName({ title: g.title, bpm: projectBpm(), key: g.songKey ? keyShort(g.songKey, g.transpose) : undefined, part, ext });
};

interface Prepared {
  code: string;
  cps: number;
  sections: BakedSection[];
}
// canción horneada con el estado actual (solo una pista si `only`)
function prepare(only?: string | null): Prepared {
  const g = useGraphStore.getState();
  const song = useSongStore.getState();
  const baked = bakeSong({
    nodes: g.nodes,
    edges: g.edges,
    steps: song.steps,
    scenes: useScenesStore.getState().scenes,
    master: g.master,
    transpose: g.transpose,
    xfader: g.xfader,
    only: only ?? null,
  });
  if (!baked.code) throw new Error(baked.error ?? 'el proyecto no compila');
  return { code: baked.code, cps: OWN_TEMPO.test(baked.code) ? 0.5 : g.cps || 0.5, sections: baked.sections };
}

// mezcla PRE-bus (stems y entrada del máster)
async function renderPre(p: Prepared, start: number, bars: number, progress?: (f: number) => void): Promise<AudioBuffer | null> {
  const bpc = useGraphStore.getState().beatsPerCycle || 4;
  const r = await renderOffline({ code: p.code, cps: p.cps, start, bars, sections: p.sections, bus: false, beatSec: 1 / (p.cps * bpc), onProgress: progress, isCancelled: () => cancelFlag });
  return r ? r.buffer : null;
}

const chansOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

// MÁSTER (Fase 4.4): la mezcla pre-bus por el bus del máster; con objetivo de loudness se empuja
// el limitador TP (secante, ≤ 6 pasadas de solo-bus) hasta quedar a ±0,2 LU. Nunca pasa el techo
// del limitador (−1 dBTP) ni más de +12 dB.
async function masterFrom(pre: AudioBuffer, p: Prepared, start: number, target: ExportTarget, progress?: (f: number) => void): Promise<{ buf: AudioBuffer; report: LoudnessReport; gainDb: number; reached: boolean }> {
  const pass = async (loudDb: number) => {
    const buf = await renderBusOver({ input: pre, cps: p.cps, start, sections: p.sections, loudDb });
    return { buf, report: measureLoudness(chansOf(buf), buf.sampleRate) };
  };
  let gainDb = 0;
  let cur = await pass(0);
  progress?.(0.3);
  if (target !== 'mix' && Number.isFinite(cur.report.integrated)) {
    const clamp = (x: number) => Math.max(-12, Math.min(12, x));
    let l0 = 0;
    let i0 = cur.report.integrated;
    let l1 = clamp(target - i0);
    for (let k = 0; k < 6; k++) {
      if (Math.abs(i0 - target) <= 0.2) break;
      cur = await pass(l1);
      gainDb = l1;
      progress?.(0.3 + 0.1 * (k + 1));
      const i1 = cur.report.integrated;
      if (Math.abs(i1 - target) <= 0.2 || Math.abs(l1) >= 12) break;
      const slope = Math.abs(l1 - l0) > 0.01 ? (i1 - i0) / (l1 - l0) : 1;
      const next = clamp(l1 + (target - i1) / Math.max(0.15, slope));
      l0 = l1;
      i0 = i1;
      l1 = next;
    }
  }
  const reached = target === 'mix' || Math.abs(cur.report.integrated - target) <= 0.5;
  return { buf: cur.buf, report: cur.report, gainDb, reached };
}

const fmt1 = (x: number) => (Number.isFinite(x) ? x.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
export function reportSummary(r: ExportReport): string {
  const t = r.target === 'mix' ? '' : r.reached ? ` · ${r.gainDb >= 0 ? '+' : ''}${fmt1(r.gainDb)} dB para ${r.target} LUFS` : ` · no llegó a ${r.target} LUFS`;
  return `${fmt1(r.report.integrated)} LUFS · ${fmt1(r.report.truePeak)} dBTP · LRA ${fmt1(r.report.lra)} LU${t}`;
}

// codificación en el worker. Stems: siempre WAV 32 float (sumados pueden pasar de 0 dB sin
// recortarse), a la misma frecuencia que la mezcla.
async function encodeFile(buf: AudioBuffer, format: ExportFormat, progress?: (f: number) => void): Promise<WavFile & { ext: string }> {
  const enc = await encodeAudio(buf, format, outRate(buf.sampleRate), progress);
  const bits = format === 'wav16' ? 16 : format === 'wav24' ? 24 : 32;
  return { blob: enc.blob, frames: enc.frames, channels: 2, bits, float: bits === 32, sampleRate: enc.sampleRate, ext: enc.ext };
}

// MIDI (Fase 4.5): las notas de cada pista (con sus secciones, mutes y escenas) en un .mid tipo
// 1. Se compila la canción UNA vez con la etiqueta de pista en cada evento y se reparten.
export async function buildSongMidi(start: number, bars: number): Promise<Uint8Array> {
  const g = useGraphStore.getState();
  const song = useSongStore.getState();
  const baked = bakeSong({ nodes: g.nodes, edges: g.edges, steps: song.steps, scenes: useScenesStore.getState().scenes, master: g.master, transpose: g.transpose, xfader: g.xfader, analyze: true });
  if (!baked.code) throw new Error(baked.error ?? 'el proyecto no compila');
  const cps = OWN_TEMPO.test(baked.code) ? 0.5 : g.cps || 0.5;
  const repl = await ensureEngine();
  const pat = (await repl.evaluate(baked.code, false)) as { queryArc: (a: number, b: number, o?: object) => { value: unknown; whole?: { begin: { valueOf(): number }; end: { valueOf(): number } } | null; hasOnset?: () => boolean }[] } | undefined;
  if (!pat) throw new Error('el patrón no compiló');
  const haps = pat.queryArc(start, start + bars, { _cps: cps });
  const byTrack = new Map<string, typeof haps>();
  for (const h of haps) {
    const tag = (h.value as { analyze?: unknown } | null)?.analyze;
    const id = typeof tag === 'string' && tag.startsWith(SRC_ANALYSER_PREFIX) ? tag.slice(SRC_ANALYSER_PREFIX.length) : '';
    if (!id) continue;
    const list = byTrack.get(id) ?? [];
    list.push(h);
    byTrack.set(id, list);
  }
  const bpc = g.beatsPerCycle || 4;
  const tracks: MidiTrack[] = [];
  for (const n of g.nodes) {
    if (n.data.kind !== 'source') continue;
    const hs = byTrack.get(n.id);
    if (!hs?.length) continue;
    const { notes, drum } = hapsToNotes(hs, start, bpc);
    if (notes.length) tracks.push({ name: String(n.data.name || n.id), drum, notes });
  }
  return buildMidi({ title: g.title || 'Telar', bpm: cps * 60 * bpc, beatsPerBar: bpc, tracks });
}

export async function exportMidi(start: number, bars: number, part: string): Promise<boolean> {
  if (useExportStore.getState().busy) return false;
  useExportStore.setState({ busy: true, frac: 0.2, label: 'MIDI' });
  try {
    await useGraphStore.getState().stop();
    const bytes = await buildSongMidi(start, bars);
    downloadBlob(new Blob([bytes as BlobPart], { type: 'audio/midi' }), exportName(part, 'mid'));
    toast.ok('MIDI exportado: una pista por instrumento, con el tempo del tema (arrástralo a Reaper).');
    return true;
  } catch (e) {
    console.warn('[export] MIDI', e);
    toast.warn(`No pude exportar el MIDI: ${String((e as Error)?.message ?? e)}`);
    return false;
  } finally {
    useExportStore.setState({ busy: false, frac: 0, label: '' });
  }
}

// alarga un WAV con silencio hasta `frames` (los stems salen todos del mismo largo)
function padWav(f: WavFile, frames: number): Blob {
  if (frames <= f.frames) return f.blob;
  const bpf = f.channels * (f.bits / 8);
  const header = wavHeader({ dataLen: frames * bpf, sampleRate: f.sampleRate, channels: f.channels, bits: f.bits, float: f.float });
  return new Blob([header as BlobPart, f.blob.slice(44), new Uint8Array((frames - f.frames) * bpf) as BlobPart], { type: 'audio/wav' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// Canción completa o región → archivo en el formato elegido (WAV 24/16/32f o MP3). `part` va
// en el nombre ('master', 'region 9-16', 'bucle'). Devuelve true si terminó.
export async function exportWav(start: number, bars: number, part: string): Promise<boolean> {
  if (useExportStore.getState().busy) return false;
  cancelFlag = false;
  const loop = useSongStore.getState().loop;
  const regionOn = useSongStore.getState().regionOn;
  useExportStore.setState({ busy: true, frac: 0, label: 'exportando la canción' });
  try {
    await useGraphStore.getState().stop();
    useSongStore.getState().setLoop(false);
    // todo lo que el tema necesita para sonar, con los loops ya estirados al BPM (Fase 5.2)
    await useGraphStore.getState().prepareSounds({ waitWarp: true });
    let blob: Blob | null = null;
    let ext = 'wav';
    try {
      const { format, target } = useExportStore.getState();
      const p = prepare();
      const pre = await renderPre(p, start, bars, (x) => useExportStore.setState({ frac: x * 0.6 }));
      if (!pre) return false; // cancelado
      useExportStore.setState({ label: target === 'mix' ? 'máster' : `máster a ${target} LUFS` });
      const m = await masterFrom(pre, p, start, target, (x) => useExportStore.setState({ frac: 0.6 + x * 0.25 }));
      useExportStore.setState({ label: 'codificando' });
      const f = await encodeFile(m.buf, format, (x) => useExportStore.setState({ frac: 0.85 + x * 0.15 }));
      blob = f.blob;
      ext = f.ext;
      const rep: ExportReport = { what: part, report: m.report, gainDb: m.gainDb, target, reached: m.reached };
      useExportStore.setState({ last: rep });
      (m.reached ? toast.ok : toast.warn)(`Exportado · ${reportSummary(rep)}`);
    } catch (e) {
      console.warn('[export] render offline falló → tiempo real', e);
      toast.warn('El render rápido falló: exporto en tiempo real (tarda lo que dura el tema; sale en WAV 32 float).');
      useExportStore.setState({ frac: 0, label: 'exportando en tiempo real' });
      blob = await renderPass({ start, bars, progress: (f) => useExportStore.setState({ frac: f }) });
    }
    if (!blob) return false;
    downloadBlob(blob, exportName(part, ext));
    return true;
  } finally {
    useSongStore.getState().setLoop(loop);
    if (regionOn) useSongStore.getState().setRegionOn(true);
    useExportStore.setState({ busy: false, frac: 0, label: '' });
  }
}

// STEMS POR PISTA (Fase 3.4): una pasada por pista (offline; en tiempo real de respaldo), cada una SOLA (compile
// `only`: con sus FX, sus secciones y lo que las escenas le hacen, como en la mezcla), por el
// tap PRE-bus (sin limitador/EQ del máster, para mezclar en otro lado), todas del mismo largo
// exacto → `tema_BPM_stems.zip` con un WAV por pista (+ la mezcla, opcional).
const safeName = (s: string, fallback: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 60) || fallback;

export async function exportStems(tracks: { id: string; name: string }[], bars: number, includeMix: boolean): Promise<boolean> {
  if (useExportStore.getState().busy || !tracks.length) return false;
  cancelFlag = false;
  const song = useSongStore.getState();
  const loop = song.loop;
  const regionOn = song.regionOn;
  const passes = tracks.length + (includeMix ? 1 : 0);
  useExportStore.setState({ busy: true, frac: 0, label: 'stems' });
  try {
    await useGraphStore.getState().stop();
    useSongStore.getState().setLoop(false);
    await useGraphStore.getState().prepareSounds({ waitWarp: true });
    // OFFLINE: una pasada por pista (sin el bus) + la mezcla (con el bus, alineada); todas del
    // mismo largo (las más cortas se alargan con silencio)
    try {
      const done: { name: string; f: WavFile }[] = [];
      let k = 0;
      for (const t of tracks) {
        useExportStore.setState({ label: `stem ${k + 1}/${passes} · ${t.name}` });
        const kk = k;
        const pre = await renderPre(prepare(t.id), 0, bars, (x) => useExportStore.setState({ frac: (kk + x * 0.9) / passes }));
        if (!pre) return false; // cancelado
        const f = await encodeFile(pre, 'wav32f');
        done.push({ name: `${String(k + 1).padStart(2, '0')}-${safeName(t.name, t.id)}.wav`, f });
        k++;
      }
      let informe = '';
      if (includeMix) {
        useExportStore.setState({ label: `mezcla ${passes}/${passes}` });
        const kk = k;
        const p = prepare();
        const target = useExportStore.getState().target;
        const pre = await renderPre(p, 0, bars, (x) => useExportStore.setState({ frac: (kk + x * 0.7) / passes }));
        if (!pre) return false;
        const m = await masterFrom(pre, p, 0, target);
        const f = await encodeFile(m.buf, 'wav32f');
        done.push({ name: '00-mezcla.wav', f });
        const rep: ExportReport = { what: 'mezcla', report: m.report, gainDb: m.gainDb, target, reached: m.reached };
        useExportStore.setState({ last: rep });
        informe = reportText(m.report, { 'Ajuste al objetivo': target === 'mix' ? 'ninguno (como suena)' : `${m.gainDb.toFixed(1)} dB para ${target} LUFS` });
      }
      const frames = Math.max(...done.map((d) => d.f.frames));
      useExportStore.setState({ label: 'armando el ZIP', frac: 1 });
      const files: ZipEntry[] = done.map((d) => ({ name: d.name, data: padWav(d.f, frames) }));
      if (informe) files.push({ name: 'informe.txt', data: new TextEncoder().encode(informe + '\n') });
      try {
        files.push({ name: exportName('', 'mid'), data: await buildSongMidi(0, bars) });
      } catch (e) {
        console.warn('[export] MIDI en el ZIP', e);
      }
      downloadBlob(await makeZip(files), exportName('stems', 'zip'));
      return true;
    } catch (e) {
      if (cancelFlag) return false;
      console.warn('[export] stems offline fallaron → tiempo real', e);
      toast.warn('El render rápido falló: exporto los stems en tiempo real.');
    }
    const files: ZipEntry[] = [];
    let i = 0;
    for (const t of tracks) {
      useSongStore.getState().setExportOnly(t.id);
      useExportStore.setState({ label: `stem ${i + 1}/${passes} · ${t.name}` });
      const k = i;
      const blob = await renderPass({ start: 0, bars, pre: true, progress: (f) => useExportStore.setState({ frac: (k + f) / passes }) });
      if (!blob) return false; // cancelado
      files.push({ name: `${String(i + 1).padStart(2, '0')}-${safeName(t.name, t.id)}.wav`, data: blob });
      i++;
    }
    if (includeMix) {
      useSongStore.getState().setExportOnly(null);
      useExportStore.setState({ label: `mezcla ${passes}/${passes}` });
      const k = i;
      const blob = await renderPass({ start: 0, bars, progress: (f) => useExportStore.setState({ frac: (k + f) / passes }) });
      if (!blob) return false;
      files.push({ name: '00-mezcla.wav', data: blob });
    }
    useExportStore.setState({ label: 'armando el ZIP', frac: 1 });
    downloadBlob(await makeZip(files), exportName('stems', 'zip'));
    return true;
  } finally {
    useSongStore.getState().setExportOnly(null);
    useSongStore.getState().setLoop(loop);
    if (regionOn) useSongStore.getState().setRegionOn(true);
    useExportStore.setState({ busy: false, frac: 0, label: '' });
  }
}
