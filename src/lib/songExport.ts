// EXPORTAR (Modo DAW, Fase 3.3): la canción entera o una región a WAV, exactamente N compases
// + la cola (reverb/eco) — y la base de los stems (3.4). El motor es EN VIVO (no hay render
// offline con el bus de Telar), así que se graba en tiempo real: se detiene, se arranca desde el
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

export const EXPORT_TAIL_S = 2.5;

export interface ExportUi {
  busy: boolean;
  frac: number; // 0–1
  label: string;
}
export const useExportStore = create<ExportUi>(() => ({ busy: false, frac: 0, label: '' }));
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

// Canción completa o región → WAV descargado. Devuelve true si terminó.
export async function exportWav(start: number, bars: number, filename: string): Promise<boolean> {
  if (useExportStore.getState().busy) return false;
  cancelFlag = false;
  const loop = useSongStore.getState().loop;
  const regionOn = useSongStore.getState().regionOn;
  useExportStore.setState({ busy: true, frac: 0, label: 'exportando la canción' });
  try {
    useSongStore.getState().setLoop(false);
    const blob = await renderPass({ start, bars, progress: (f) => useExportStore.setState({ frac: f }) });
    if (!blob) return false;
    downloadBlob(blob, filename);
    return true;
  } finally {
    useSongStore.getState().setLoop(loop);
    if (regionOn) useSongStore.getState().setRegionOn(true);
    useExportStore.setState({ busy: false, frac: 0, label: '' });
  }
}

// STEMS POR PISTA (Fase 3.4): una pasada en tiempo real por pista, cada una SOLA (compile
// `only`: con sus FX, sus secciones y lo que las escenas le hacen, como en la mezcla), por el
// tap PRE-bus (sin limitador/EQ del máster, para mezclar en otro lado), todas del mismo largo
// exacto → `telar-stems-….zip` con un WAV por pista (+ la mezcla, opcional).
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
    useSongStore.getState().setLoop(false);
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
    downloadBlob(await makeZip(files), `telar-stems-${stamp()}.zip`);
    return true;
  } finally {
    useSongStore.getState().setExportOnly(null);
    useSongStore.getState().setLoop(loop);
    if (regionOn) useSongStore.getState().setRegionOn(true);
    useExportStore.setState({ busy: false, frac: 0, label: '' });
  }
}
