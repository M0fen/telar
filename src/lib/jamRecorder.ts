// GRABAR EL JAM EN LA CANCIÓN (Modo DAW, Fase 2.5) — el paso «sesión → arreglo» de Ableton.
// Mientras tocas en vivo (escenas, mutes, solos, perillas; en cualquier vista o con el MIDI),
// se anota cada ¼ de compás qué escena está activa y, por pista, si se oye, su volumen y su
// filtro de canal. Al parar se arma la canción: los compases iguales seguidos forman una
// sección (escena + qué suena) y cada pista PLANA queda con un brazo por sección — su patrón
// donde sonaba, apagado (`.mask(0)`) donde no. Todo en UN paso deshacible.
// La parte de armado es PURA (`buildFromTake`, con tests); la de muestreo vive en `startJam`.
import { create } from 'zustand';
import { splitArrange, muteArm } from '../nodes/stepseqCode';
import { MAX_SECTION_BARS, newStepId, type EditStep } from './arrangeEdit';
import { simplify, type AutoPoint } from './automation';

export interface JamTrackState {
  audible: boolean;
  gain: number; // volumen del nodo (data.gain, 1 si no tiene)
  filt: number; // filtro de canal (data.chFilter, −1…1)
}
export interface JamSample {
  t: number; // compás (fraccional) desde que empezó la toma
  scene: number | null; // última escena disparada
  tracks: Record<string, JamTrackState>;
}
export interface JamTake {
  samples: JamSample[];
  bars: number; // compases completos grabados
}

export interface JamBuild {
  steps: EditStep[];
  codes: Record<string, string>; // solo las pistas que cambian
  // la mezcla en vivo queda neutra (manda el arreglo) y las perillas movidas pasan a curvas:
  // gain = el máximo tocado (la curva de volumen baja desde ahí), chFilter = 0 (la curva manda)
  patches: Record<string, { mute?: boolean; solo?: boolean; gain?: number; chFilter?: number; auto?: { vol?: AutoPoint[]; filt?: AutoPoint[] } }>;
  skipped: string[]; // pistas que ya tenían secciones propias (no se tocan)
}

// Estado de la toma en el compás k: el último muestreo hasta el FINAL del primer tiempo
// (k + ¼): un disparo un poco tardío (en el 1) cuenta para ese compás, uno al final del
// compás anterior también.
export function barState(take: JamTake, k: number): JamSample | null {
  let best: JamSample | null = null;
  for (const s of take.samples) {
    if (s.t <= k + 0.25 + 1e-9) best = s;
    else break;
  }
  return best ?? take.samples[0] ?? null;
}

const sig = (s: JamSample | null, ids: string[]) =>
  `${s?.scene ?? '-'}|${ids.map((id) => (s?.tracks[id]?.audible === false ? 0 : 1)).join('')}`;

export function buildFromTake(
  take: JamTake,
  codes: Record<string, string>,
  opts: { freeScene: number; sceneName?: (scene: number) => string | undefined; makeId?: () => string } = { freeScene: 1 },
): JamBuild | null {
  const bars = Math.floor(take.bars);
  if (bars < 1 || !take.samples.length) return null;
  const ids = Object.keys(codes);
  // 1) compases → secciones (iguales seguidos; máx. 64 compases)
  const sections: { start: number; bars: number; state: JamSample | null }[] = [];
  let curSig = '';
  for (let k = 0; k < bars; k++) {
    const st = barState(take, k);
    const g = sig(st, ids);
    const last = sections[sections.length - 1];
    if (last && g === curSig && last.bars < MAX_SECTION_BARS) last.bars++;
    else { sections.push({ start: k, bars: 1, state: st }); curSig = g; }
  }
  // 2) canción
  const makeId = opts.makeId ?? newStepId;
  const steps: EditStep[] = sections.map((s, i) => {
    const sc = s.state?.scene ?? null;
    const name = sc != null ? undefined : `parte ${i + 1}`;
    return { id: makeId(), scene: sc ?? opts.freeScene, bars: s.bars, ...(name ? { name } : {}) };
  });
  // 3) pistas planas: un brazo por sección (su patrón donde sonaba, apagado donde no)
  const out: Record<string, string> = {};
  const skipped: string[] = [];
  const patches: JamBuild['patches'] = {};
  for (const id of ids) {
    const code = (codes[id] ?? '').trim();
    if (!code) continue;
    const auto = knobCurves(take, id, bars);
    if (splitArrange(code)) {
      skipped.push(id);
      if (auto) patches[id] = auto; // sus secciones no se tocan, pero lo que moviste sí queda
      continue;
    }
    const arms = sections.map((s) => `[${s.bars}, ${s.state?.tracks[id]?.audible === false ? muteArm(code) : code}]`);
    out[id] = `arrange(${arms.join(', ')})`;
    patches[id] = { mute: false, solo: false, ...(auto ?? {}) };
  }
  return { steps, codes: out, patches, skipped };
}

// PERILLAS → CURVAS (Fase 3.2): volumen (data.gain) y filtro de canal (data.chFilter) de cada
// ¼ de compás. Solo si se movieron (si quedaron fijos, la perilla sigue igual y no hay curva).
// Volumen: la perilla queda en el MÁXIMO tocado y la curva (0–1) baja desde ahí. Filtro: la
// perilla vuelve a 0 y la curva lleva el movimiento. Se quitan los puntos redundantes.
export function knobCurves(take: JamTake, id: string, bars: number): JamBuild['patches'][string] | null {
  const ss = take.samples.filter((x) => x.t < bars && x.tracks[id]);
  if (ss.length < 2) return null;
  const gains = ss.map((x) => x.tracks[id].gain);
  const filts = ss.map((x) => x.tracks[id].filt);
  const gMax = Math.max(...gains);
  const gMin = Math.min(...gains);
  const fMax = Math.max(...filts);
  const fMin = Math.min(...filts);
  const out: NonNullable<JamBuild['patches'][string]> = {};
  const auto: { vol?: AutoPoint[]; filt?: AutoPoint[] } = {};
  if (gMax - gMin > 0.02 && gMax > 0) {
    out.gain = Math.round(gMax * 1000) / 1000;
    auto.vol = simplify(ss.map((x) => [x.t, Math.round((x.tracks[id].gain / gMax) * 1000) / 1000] as AutoPoint), 0.015);
  }
  if (fMax - fMin > 0.02) {
    out.chFilter = 0;
    auto.filt = simplify(ss.map((x) => [x.t, Math.round(x.tracks[id].filt * 1000) / 1000] as AutoPoint), 0.015);
  }
  if (!auto.vol && !auto.filt) return null;
  out.auto = auto;
  return out;
}

// --- muestreo en vivo ------------------------------------------------------------------
export interface JamUi {
  recording: boolean;
  bars: number; // compases grabados hasta ahora
}
export const useJamStore = create<JamUi>(() => ({ recording: false, bars: 0 }));

export interface JamHooks {
  now: () => number; // ciclo del scheduler (compases desde que arrancó)
  playing: () => boolean;
  snapshot: () => { scene: number | null; tracks: Record<string, JamTrackState> };
  onFinish: (take: JamTake) => void;
}

let raf = 0;
let take: JamTake | null = null;
let lastNow = 0; // último ciclo visto sonando (al parar el transporte el reloj vuelve a 0)

export function isJamRecording(): boolean {
  return !!take;
}

// Empieza a muestrear (el transporte ya debe estar sonando desde el compás 1).
export function startJam(h: JamHooks): void {
  stopJamLoop();
  take = { samples: [], bars: 0 };
  lastNow = 0;
  useJamStore.setState({ recording: true, bars: 0 });
  let lastQ = -1;
  const tick = () => {
    if (!take) return;
    if (!h.playing()) { finishJam(h); return; } // ■ del transporte también cierra la toma
    const now = Math.max(0, h.now());
    lastNow = now;
    const q = Math.floor(now * 4); // ¼ de compás
    if (q !== lastQ) {
      lastQ = q;
      take.samples.push({ t: q / 4, ...h.snapshot() });
      const b = Math.floor(now);
      if (b !== useJamStore.getState().bars) useJamStore.setState({ bars: b });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function stopJamLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

// Cierra la toma: compases COMPLETOS hasta ahora (el que va a medias no cuenta).
export function finishJam(h: Pick<JamHooks, 'now' | 'onFinish' | 'playing'>): void {
  if (!take) return;
  stopJamLoop();
  const t = take;
  take = null;
  t.bars = Math.floor(Math.max(lastNow, h.playing() ? h.now() : 0));
  useJamStore.setState({ recording: false, bars: 0 });
  h.onFinish(t);
}

export function cancelJam(): void {
  stopJamLoop();
  take = null;
  useJamStore.setState({ recording: false, bars: 0 });
}
