// REPRODUCTOR CON TONO FIJO (key lock) del modo DJ: un AudioWorklet que toca el tema a la velocidad
// que pida la sesión SIN cambiarle el tono (deckCore.ts: WSOLA leyendo directo del tema). Sigue el
// MISMO modelo de reproducción que el resto del modo DJ (t0, pos0, velocidad, loop): el guardián, el
// medidor de fase y la vista no cambian.
//
// El audio del tema vive UNA vez por contexto en el ámbito del worklet (16 bit con 6 dB de margen: la
// mitad de memoria que en flotante), compartido por todos los decks que lo tengan. Se convierte por
// trozos (sin trabar el hilo principal, que agenda el resto de la sesión) y viaja transferido (sin
// copia). Defensivo: si el worklet no carga o el audio aún no llegó, el deck toca como siempre
// (velocidad = tono) — nunca se calla.
import { DECK_CORE_SRC } from './deckCore';

const NAME = 'telar-deck';
const LOADER = 'telar-deck-pcm';
const SCALE = 16384; // ±2,0 en flotante → 16 bit (los MP3 decodificados pasan de 1,0)

const SRC = `${DECK_CORE_SRC}
const PCM = (globalThis.__telarPcm = globalThis.__telarPcm || new Map());
class TelarDeckPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === 'pcm') PCM.set(d.id, { chans: d.chans, scale: d.scale });
      else if (d && d.type === 'free') PCM.delete(d.id);
    };
  }
  process() { return true; }
}
class TelarDeck extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    const p = PCM.get(o.id);
    this.core = p ? new DeckCore(p.chans, p.scale, sampleRate) : null;
    if (this.core && o.m) this.core.setModel(o.m.t0, o.m);
    this.stopAt = Infinity;
    this.told = false;
    if (!this.core) this.port.postMessage({ type: 'missing' });
    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d || !this.core) return;
      if (d.type === 'model') this.core.setModel(d.at, d.m);
      else if (d.type === 'stop') this.stopAt = d.at;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const t = currentTime;
    if (!this.core || t >= this.stopAt) {
      for (const ch of out) ch.fill(0);
      return !(t >= this.stopAt + 0.05);
    }
    const ok = this.core.render(out, out[0].length, t);
    if (!ok && !this.told) { this.told = true; this.port.postMessage({ type: 'ended' }); }
    return true;
  }
}
registerProcessor('${LOADER}', TelarDeckPcm);
registerProcessor('${NAME}', TelarDeck);
`;

const modules = new WeakMap<BaseAudioContext, Promise<boolean>>();
const readyCtx = new WeakSet<BaseAudioContext>();
const loaders = new WeakMap<BaseAudioContext, AudioWorkletNode>();
const pcmIn = new WeakMap<BaseAudioContext, Map<string, 'loading' | 'ready'>>();

// carga el procesador en ese contexto (una vez); false si el navegador no puede
export function ensureDeckWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let p = modules.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        const url = URL.createObjectURL(new Blob([SRC], { type: 'application/javascript' }));
        try { await (ctx as AudioContext).audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        loaders.set(ctx, new AudioWorkletNode(ctx, LOADER, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] }));
        readyCtx.add(ctx);
        return true;
      } catch (e) {
        console.warn('[deck] el reproductor con tono fijo no cargó; los decks tocan con velocidad = tono:', e);
        return false;
      }
    })();
    modules.set(ctx, p);
  }
  return p;
}

const pcmMap = (ctx: BaseAudioContext) => { let m = pcmIn.get(ctx); if (!m) { m = new Map(); pcmIn.set(ctx, m); } return m; };
export const pcmReady = (ctx: BaseAudioContext, id: string | null): boolean => !!id && readyCtx.has(ctx) && pcmMap(ctx).get(id) === 'ready';

const yieldMain = () => new Promise<void>((r) => setTimeout(r, 0));

// manda el audio del tema al worklet (una vez por contexto). Resuelve true cuando ya se puede tocar
export async function loadPcm(ctx: BaseAudioContext, id: string, buf: AudioBuffer): Promise<boolean> {
  const map = pcmMap(ctx);
  if (map.get(id) === 'ready') return true;
  if (map.get(id) === 'loading') {
    for (let k = 0; k < 600 && map.get(id) === 'loading'; k++) await new Promise((r) => setTimeout(r, 50));
    return map.get(id) === 'ready';
  }
  if (!(await ensureDeckWorklet(ctx))) return false;
  const loader = loaders.get(ctx);
  if (!loader) return false;
  map.set(id, 'loading');
  try {
    const chans: Int16Array[] = [];
    const CHUNK = 1 << 19;
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) {
      const src = buf.getChannelData(c);
      const dst = new Int16Array(src.length);
      for (let i = 0; i < src.length; i += CHUNK) {
        const end = Math.min(src.length, i + CHUNK);
        for (let k = i; k < end; k++) {
          const v = src[k] * SCALE;
          dst[k] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
        }
        await yieldMain();
      }
      chans.push(dst);
    }
    loader.port.postMessage({ type: 'pcm', id, chans, scale: 1 / SCALE }, chans.map((x) => x.buffer));
    map.set(id, 'ready');
    return true;
  } catch (e) {
    console.warn('[deck] no pude pasar el tema al reproductor con tono fijo:', e);
    map.delete(id);
    return false;
  }
}

// suelta los temas que ya no tiene ningún deck
export function releasePcm(ctx: BaseAudioContext, keep: Set<string>): void {
  const map = pcmMap(ctx);
  const loader = loaders.get(ctx);
  for (const [id, st] of map) {
    if (st !== 'ready' || keep.has(id)) continue;
    map.delete(id);
    try { loader?.port.postMessage({ type: 'free', id }); } catch { /* */ }
  }
}

export interface PlayModelLike { t0: number; pos0: number; rate: number; loop: { a: number; b: number } | null }

// una voz que toca el tema `id` siguiendo el modelo `m`; null si no se puede (y se toca como siempre)
export function createLockVoice(ctx: BaseAudioContext, id: string, m: PlayModelLike): AudioWorkletNode | null {
  if (!pcmReady(ctx, id)) return null;
  try {
    return new AudioWorkletNode(ctx, NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { id, m: { t0: m.t0, pos0: m.pos0, rate: m.rate, loop: m.loop } },
    });
  } catch {
    return null;
  }
}
