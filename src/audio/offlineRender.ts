// RENDER OFFLINE (Fase 4.2): la canción a un AudioBuffer en un OfflineAudioContext, más rápido
// que el tiempo real, sin cortes aunque el navegador se trabe y con el MISMO sonido que en vivo:
// el patrón horneado (4.1, escenas incluidas), superdough con un controlador propio para este
// contexto, el bus de máster de Telar (misma cadena que en vivo + su limitador TP), el EQ por
// canal sobre los orbits y el sidechain.
//
// Cómo convive con el audio en vivo (superdough tiene UN contexto global): mientras dura el
// render, superdough apunta al contexto offline (así también la limpieza de cada voz, que corre
// en sus `onended`, crea sus nodos en el contexto correcto) y al terminar se le devuelve el suyo.
// Entretanto el motor en vivo no toca su bus ni su EQ (isOfflineRendering), no se puede dar ▶ y
// las audiciones esperan. Los eventos se agendan por tramos, con el render suspendido.
import {
  getAudioContext,
  setAudioContext,
  getSuperdoughAudioController,
  setSuperdoughAudioController,
  superdough,
  loadWorklets,
  setMaxPolyphony,
  maxPolyphony,
} from '@strudel/web';
import {
  ensureEngine,
  beginOfflineRender,
  endOfflineRender,
  createOfflineMasterBus,
  busFromMaster,
  buildChanEq,
  type ChanEqChain,
  type SdController,
} from './engine';
import type { BakedSection } from '../lib/songBake';
import type { ChannelEqRoute } from '../graph/compile';

// superdough reutiliza nodos (un pool global que no mira el contexto): un nodo del audio en vivo
// no puede ir al render offline ni al revés. El pool guarda WeakRefs → un nodo de OTRO contexto
// que el actual de superdough se trata como ya recolectado: se descarta y se crea uno nuevo.
function installPoolGuard(): void {
  const proto = WeakRef.prototype as unknown as { deref: () => unknown; __telarPoolGuard?: boolean };
  if (proto.__telarPoolGuard) return;
  const orig = proto.deref;
  proto.deref = function (this: WeakRef<object>) {
    const v = orig.call(this);
    if (typeof AudioNode !== 'undefined' && v instanceof AudioNode) {
      try {
        if (v.context !== getAudioContext()) return undefined;
      } catch {
        /* sin contexto todavía */
      }
    }
    return v;
  };
  proto.__telarPoolGuard = true;
}
installPoolGuard();

export interface OfflineRenderOpts {
  code: string; // patrón horneado con el máster global (sin from/región/stopAt)
  cps: number;
  start: number; // compás de canción donde arranca
  bars: number;
  sections: BakedSection[]; // máster y EQ por canal de cada sección (compases de canción)
  bus: boolean; // false = stem (sin el bus del máster)
  tailMax?: number; // s de cola como máximo (por defecto 10)
  onProgress?: (f: number) => void;
  isCancelled?: () => boolean;
}

// BUS SOBRE UNA MEZCLA YA RENDERIZADA (Fase 4.4): la mezcla pre-bus (render con bus: false) pasa
// por el MISMO bus del máster, con sus cambios por sección. Mucho más rápido que volver a
// renderizar todas las voces → se puede repetir varias veces para llegar a un objetivo de
// loudness (loudDb empuja el limitador TP). No toca superdough.
export async function renderBusOver(o: {
  input: AudioBuffer;
  cps: number;
  start: number;
  sections: BakedSection[];
  loudDb?: number;
}): Promise<AudioBuffer> {
  const sr = o.input.sampleRate;
  const cps = o.cps > 0 ? o.cps : 0.5;
  const MARGIN = 4096;
  const off = new OfflineAudioContext(2, o.input.length + MARGIN, sr);
  const src = new AudioBufferSourceNode(off, { buffer: o.input });
  const pre = new GainNode(off, { gain: 1 });
  src.connect(pre);
  const total = o.sections.reduce((m, s) => Math.max(m, s.start + s.bars), 0);
  const sectionAt = (bar: number): BakedSection | undefined => {
    if (!o.sections.length) return undefined;
    if (total <= 0) return o.sections[0];
    const x = ((bar % total) + total) % total;
    return o.sections.find((s) => x >= s.start && x < s.start + s.bars) ?? o.sections[0];
  };
  const settings = (sec: BakedSection | undefined) => ({ ...busFromMaster(sec?.master ?? {}), loud: o.loudDb ?? 0 });
  const bus = await createOfflineMasterBus(off, pre, settings(sectionAt(o.start)));
  // fronteras de sección dentro del tramo (en segundos desde el inicio)
  const dur = o.input.length / sr;
  const used = new Set<number>();
  if (total > 0) {
    for (let k = Math.floor(o.start / total) * total; (k - o.start) / cps < dur; k += total) {
      for (const s of o.sections) {
        const b = k + s.start;
        const t = (b - o.start) / cps;
        if (b <= o.start || t >= dur) continue;
        let q = Math.round((t * sr) / 128) * 128 / sr;
        while (used.has(q)) q += 128 / sr;
        used.add(q);
        off.suspend(q).then(() => { bus.apply(settings(sectionAt(b))); off.resume(); });
      }
    }
  }
  src.start(0);
  const r = await off.startRendering();
  const lat = bus.latencyFrames;
  const len = o.input.length;
  const out = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
  out.copyToChannel(r.getChannelData(0).subarray(lat, lat + len), 0);
  out.copyToChannel(r.getChannelData(r.numberOfChannels > 1 ? 1 : 0).subarray(lat, lat + len), 1);
  return out;
}

export interface OfflineRenderResult {
  buffer: AudioBuffer;
  musicalSeconds: number; // duración de los compases (sin cola)
}

const WINDOW_BARS = 2; // compases agendados por tramo
const LOOKAHEAD_S = 0.2; // el tramo se agenda este tiempo antes de que suene
const SILENCE = Math.pow(10, -90 / 20); // −90 dBFS: fin de la cola

let busy = false;

export async function renderOffline(o: OfflineRenderOpts): Promise<OfflineRenderResult | null> {
  if (busy) throw new Error('ya hay un render en curso');
  busy = true;
  const repl = await ensureEngine();
  const live = getAudioContext();
  const liveCtrl = getSuperdoughAudioController();
  const livePoly = maxPolyphony;
  beginOfflineRender();
  try {
    // el patrón: misma transpilación que en vivo (el reloj está parado: no suena nada)
    const pattern = (await repl.evaluate(o.code, false)) as {
      queryArc: (a: number, b: number, opts?: object) => {
        whole?: { begin: { valueOf(): number } };
        duration: { valueOf(): number };
        hasOnset: () => boolean;
        ensureObjectValue?: () => void;
        value: unknown;
      }[];
    } | undefined;
    if (!pattern || typeof pattern.queryArc !== 'function') throw new Error('el patrón no compiló');

    const sr = live.sampleRate;
    const cps = o.cps > 0 ? o.cps : 0.5;
    const musical = o.bars / cps;
    const tailMax = Math.max(0.5, o.tailMax ?? 10);
    const end = o.start + o.bars;
    // sección vigente en un compás de canción (la canción se repite cada `total`)
    const total = o.sections.reduce((m, s) => Math.max(m, s.start + s.bars), 0);
    const sectionAt = (bar: number): BakedSection | undefined => {
      if (!o.sections.length) return undefined;
      if (total <= 0) return o.sections[0];
      const x = ((bar % total) + total) % total;
      return o.sections.find((s) => x >= s.start && x < s.start + s.bars) ?? o.sections[0];
    };

    // margen para el retardo del bus (se recorta al final)
    const MARGIN = 4096;
    const frames = Math.ceil((musical + tailMax) * sr) + MARGIN;
    const off = new OfflineAudioContext(2, frames, sr);

    // superdough → contexto offline durante TODO el render (se devuelve en el finally)
    setAudioContext(off);
    setSuperdoughAudioController(null as never);
    const ctrl = getSuperdoughAudioController() as unknown as SdController & { output?: { destinationGain?: AudioNode } }; // uno nuevo, de este contexto
    setMaxPolyphony(1_000_000); // offline se agendan muchas voces juntas: sin robo de voces
    await loadWorklets();

    // bus del máster (o nada, para los stems)
    const first = sectionAt(o.start);
    const bus = o.bus && ctrl.output?.destinationGain
      ? await createOfflineMasterBus(off, ctrl.output.destinationGain, busFromMaster(first?.master ?? {}))
      : null;
    const latency = bus ? bus.latencyFrames : 0;

    // EQ por canal sobre los orbits offline (se crean al primer evento de cada canal)
    const eqChains = new Map<number, ChanEqChain>();
    let eqRoutes: ChannelEqRoute[] = first?.channelEqs ?? [];
    const syncEq = () => {
      for (const r of eqRoutes) {
        const src = ctrl.nodes?.[r.orbit]?.output;
        if (!src) continue;
        let st = eqChains.get(r.orbit);
        if (!st) {
          st = buildChanEq(off, ctrl, src, r.orbit);
          if (!st) continue;
          eqChains.set(r.orbit, st);
        }
        st.low.gain.value = r.low;
        st.mid.gain.value = r.mid;
        st.mid.frequency.value = r.midFreq;
        st.high.gain.value = r.high;
      }
    };

    // agenda los eventos de un tramo de compases [b0, b1)
    const toSec = (bar: number) => (bar - o.start) / cps;
    let schedMs = 0;
    const schedule = async (b0: number, b1: number) => {
      const t0 = performance.now();
      try { await scheduleWin(b0, b1); } finally { schedMs += performance.now() - t0; }
    };
    const scheduleWin = async (b0: number, b1: number) => {
      const haps = pattern
        .queryArc(b0, b1, { _cps: cps })
        .filter((h) => h.hasOnset() && h.whole)
        .sort((a, b) => a.whole!.begin.valueOf() - b.whole!.begin.valueOf());
      for (const hap of haps) {
        try {
          hap.ensureObjectValue?.();
          const begin = hap.whole!.begin.valueOf();
          await superdough(hap.value, toSec(begin), hap.duration.valueOf() / cps, cps, begin);
        } catch {
          /* un evento que falla no tumba el render (igual que en vivo) */
        }
      }
      syncEq();
    };

    let cancelled = false;
    // tramos: cada WINDOW_BARS compases; cambios de sección (bus + EQ) en su compás exacto
    const winStarts: number[] = [];
    for (let b = o.start + WINDOW_BARS; b < end; b += WINDOW_BARS) winStarts.push(b);
    const boundaries = o.sections
      .flatMap((s) => {
        const out: number[] = [];
        if (total <= 0) return out;
        // fronteras de sección dentro de [start, end), contando las vueltas de la canción
        for (let k = Math.floor(o.start / total) * total; k < end; k += total) {
          const b = k + s.start;
          if (b > o.start && b < end) out.push(b);
        }
        return out;
      })
      .sort((a, b) => a - b);
    const quant = (t: number) => Math.round((t * sr) / 128) * 128 / sr; // suspend() va por bloques de 128
    const used = new Set<number>();
    const suspendAt = (t: number, fn: () => Promise<void> | void) => {
      let q = quant(Math.max(0, t));
      while (used.has(q)) q += 128 / sr;
      if (q >= frames / sr) return;
      used.add(q);
      off.suspend(q).then(async () => {
        try {
          await fn();
        } finally {
          off.resume();
        }
      });
    };
    for (const b of winStarts) {
      suspendAt(toSec(b) - LOOKAHEAD_S, async () => {
        if (cancelled || o.isCancelled?.()) { cancelled = true; return; }
        o.onProgress?.(Math.min(0.95, ((b - o.start) / o.bars) * 0.95));
        await schedule(b, Math.min(b + WINDOW_BARS, end));
      });
    }
    for (const b of boundaries) {
      suspendAt(toSec(b), () => {
        const sec = sectionAt(b);
        if (!sec) return;
        bus?.apply(busFromMaster(sec.master));
        eqRoutes = sec.channelEqs;
        syncEq();
      });
    }

    const tStart = performance.now();
    await schedule(o.start, Math.min(o.start + WINDOW_BARS, end));
    const rendered = await off.startRendering();
    console.info(`[offline] ${o.bars} compases · ${Math.round(performance.now() - tStart)} ms (agendar ${Math.round(schedMs)} ms) · ${(musical / ((performance.now() - tStart) / 1000)).toFixed(1)}× tiempo real`);
    if (cancelled || o.isCancelled?.()) return null;
    o.onProgress?.(1);

    // recorte: el retardo del bus al inicio y la cola hasta que cae bajo −90 dBFS
    const L = rendered.getChannelData(0);
    const R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
    const musicalEnd = latency + Math.round(musical * sr);
    let last = musicalEnd;
    for (let i = rendered.length - 1; i >= musicalEnd; i--) {
      if (Math.abs(L[i]) > SILENCE || Math.abs(R[i]) > SILENCE) { last = i; break; }
    }
    const endFrame = Math.min(rendered.length, Math.max(musicalEnd, last + Math.round(0.05 * sr)));
    const len = Math.max(1, endFrame - latency);
    const outBuf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    outBuf.copyToChannel(L.subarray(latency, latency + len), 0);
    outBuf.copyToChannel(R.subarray(latency, latency + len), 1);
    return { buffer: outBuf, musicalSeconds: musical };
  } finally {
    setAudioContext(live);
    setSuperdoughAudioController(liveCtrl);
    setMaxPolyphony(livePoly);
    endOfflineRender();
    busy = false;
  }
}
