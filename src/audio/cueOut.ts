// SALIDA DE AUDÍFONOS (modo DJ): el bus de cue (los decks con 🎧, antes de su fader) mezclado con algo
// del máster. Dos maneras:
// · OTRA salida del computador (los audífonos del portátil mientras la sala va por los parlantes…):
//   MediaStreamDestination → <audio> con setSinkId.
// · CONTROLADOR de 4 canales (DDJ-FLX4 y similares: 1-2 = master, 3-4 = audífonos): el contexto de
//   audio entero pasa a esa salida (AudioContext.setSinkId) con 4 canales discretos; la sala sigue
//   en 1-2 tal cual y los audífonos entran por un merger a 3-4.
// Sin salida elegida, el cue no suena en ningún lado (la sala nunca lo oye).
import { getCueSum, getMasterPostNode } from './engine';

interface HpOut {
  sum: GainNode;
  cueG: GainNode;
  mstG: GainNode;
  vol: GainNode;
  dest: MediaStreamAudioDestinationNode;
  el: HTMLAudioElement;
  master: AudioNode | null;
  device: string;
  sep: boolean; // la vía de la salida aparte (vol → stream → <audio>) está armada
}
let out: HpOut | null = null;

interface Ctrl { ctx: AudioContext; hp: AudioNode; split: ChannelSplitterNode; merger: ChannelMergerNode; device: string; prevSink: string }
let ctrl: Ctrl | null = null;
type SinkCtx = AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: unknown };
// cambiar la salida puede dejar el contexto suspendido: nunca dejar la sala muda
async function moveSink(ctx: AudioContext, id: string): Promise<void> {
  const was = ctx.state;
  try { await (ctx as SinkCtx).setSinkId?.(id); } finally {
    if (was === 'running' && ctx.state !== 'running') await ctx.resume().catch(() => { /* el próximo ▶ */ });
  }
}
export const canUseController = (): boolean => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

function ctrlOff(): void {
  if (!ctrl) return;
  const c = ctrl;
  ctrl = null;
  try { c.hp.disconnect(c.split); } catch { /* */ }
  try { c.split.disconnect(); c.merger.disconnect(); } catch { /* */ }
  try { const d = c.ctx.destination; d.channelCount = Math.min(2, d.maxChannelCount); d.channelInterpretation = 'speakers'; } catch { /* */ }
  void moveSink(c.ctx, c.prevSink).catch(() => { /* queda donde estaba */ });
}

// pasa el contexto a la salida del controlador y los audífonos (hp) a sus canales 3-4
async function ctrlOn(ctx: AudioContext, device: string, hp: AudioNode): Promise<string | null> {
  if (ctrl && ctrl.ctx === ctx && ctrl.device === device && ctrl.hp === hp) return null;
  ctrlOff();
  const c = ctx as SinkCtx;
  if (!c.setSinkId) return 'Este navegador no deja mandar el audio a un controlador: usa Chrome o Edge.';
  const prevSink = typeof c.sinkId === 'string' ? c.sinkId : '';
  await moveSink(ctx, device);
  const dest = ctx.destination;
  if (dest.maxChannelCount < 4) {
    await moveSink(ctx, prevSink).catch(() => { /* */ });
    return `Esa salida tiene ${dest.maxChannelCount} canales; para los audífonos por el controlador hacen falta 4 (elige el controlador, no los parlantes).`;
  }
  dest.channelCount = 4;
  dest.channelCountMode = 'explicit';
  dest.channelInterpretation = 'discrete'; // lo estéreo (la sala) llena 1-2 y deja 3-4 para los audífonos
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 4 });
  hp.connect(split);
  split.connect(merger, 0, 2);
  split.connect(merger, 1, 3);
  merger.connect(dest);
  ctrl = { ctx, hp, split, merger, device, prevSink };
  return null;
}

export const canPickOutput = (): boolean => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export interface OutputDevice { id: string; label: string }
// salidas de audio del sistema. Los NOMBRES solo se ven con un permiso de audio: con `ask` se pide
// (y el micrófono se suelta al instante; no se graba nada).
export async function listOutputs(ask = false): Promise<OutputDevice[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  let devs = await md.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const outs0 = devs.filter((d) => d.kind === 'audiooutput');
  if (ask && md.getUserMedia && (outs0.length <= 1 || outs0.every((d) => !d.label))) {
    try {
      const s = await md.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      devs = await md.enumerateDevices();
    } catch { /* sin permiso: quedan las que se vean */ }
  }
  const outs = devs.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications');
  return outs.map((d, i) => ({ id: d.deviceId, label: d.label || (d.deviceId === 'default' ? 'Predeterminada del sistema' : `Salida ${i + 1}`) }));
}

function teardown(): void {
  ctrlOff();
  if (!out) return;
  try { out.el.pause(); out.el.srcObject = null; } catch { /* */ }
  try { out.sum.disconnect(out.cueG); } catch { /* */ }
  try { out.master?.disconnect(out.mstG); } catch { /* */ }
  try { out.cueG.disconnect(); out.mstG.disconnect(); out.vol.disconnect(); } catch { /* */ }
  out = null;
}

// ganancias de la mezcla: 0 = solo cue, 1 = solo máster (potencia constante)
function setMix(mix: number, vol: number): void {
  if (!out) return;
  const t = out.sum.context.currentTime;
  const m = Math.max(0, Math.min(1, mix));
  try {
    out.cueG.gain.setTargetAtTime(Math.cos((m * Math.PI) / 2), t, 0.02);
    out.mstG.gain.setTargetAtTime(Math.sin((m * Math.PI) / 2), t, 0.02);
    out.vol.gain.setTargetAtTime(Math.max(0, Math.min(1.5, vol)), t, 0.02);
  } catch { /* */ }
}

// Enciende / ajusta / apaga la salida de audífonos. Devuelve un aviso (o null si quedó bien).
// Se puede llamar seguido: solo rearma lo que cambió (contexto nuevo, máster nuevo, otra salida).
export async function syncHeadphones(device: string | null, mix: number, vol: number, controller = false): Promise<string | null> {
  if (!device) { teardown(); return null; }
  if (!(controller ? canUseController() : canPickOutput())) { teardown(); return 'Este navegador no deja elegir la salida de audio: usa Chrome o Edge.'; }
  const sum = getCueSum();
  if (!sum) return 'Dale ▶ para arrancar el audio y vuelve a elegir la salida.';
  const ctx = sum.context as AudioContext;
  if (out && out.sum !== sum) teardown();
  try {
    if (!out) {
      const cueG = new GainNode(ctx, { gain: 1 });
      const mstG = new GainNode(ctx, { gain: 0 });
      const vol = new GainNode(ctx, { gain: 1 });
      const dest = new MediaStreamAudioDestinationNode(ctx, { channelCount: 2 });
      sum.connect(cueG); cueG.connect(vol); mstG.connect(vol);
      const el = new Audio();
      out = { sum, cueG, mstG, vol, dest, el, master: null, device: '', sep: false };
    }
    // el máster (lo que oye la sala), para mezclarlo en los audífonos
    const m = getMasterPostNode() ?? null;
    if (m !== out.master) {
      try { out.master?.disconnect(out.mstG); } catch { /* */ }
      out.master = m;
      try { m?.connect(out.mstG); } catch { out.master = null; }
    }
    if (controller) {
      // todo por el controlador: la vía aparte se calla (sus audífonos son los canales 3-4)
      if (out.sep) { try { out.el.pause(); out.el.srcObject = null; out.vol.disconnect(out.dest); } catch { /* */ } out.sep = false; out.device = ''; }
      setMix(mix, vol);
      const msg = await ctrlOn(ctx, device, out.vol);
      if (msg) teardown();
      return msg;
    }
    ctrlOff();
    if (!out.sep) { out.vol.connect(out.dest); out.el.srcObject = out.dest.stream; out.sep = true; }
    if (out.device !== device) {
      await (out.el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(device);
      out.device = device;
    }
    setMix(mix, vol);
    await out.el.play().catch(() => { /* el próximo clic lo arranca */ });
    return null;
  } catch (e) {
    teardown();
    return `No pude usar esa salida (${e instanceof Error ? e.message : 'error'}). Prueba otra o reconecta la tarjeta.`;
  }
}

export const headphonesOn = (): boolean => !!out;
