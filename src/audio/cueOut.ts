// SALIDA DE AUDÍFONOS (modo DJ): el bus de cue (los decks con 🎧, antes de su fader) mezclado con algo
// del máster, por OTRA salida de audio del computador (la tarjeta de DJ, los audífonos del portátil
// mientras la sala va por los parlantes…). Chrome/Edge: MediaStreamDestination → <audio> con
// setSinkId. Sin salida elegida, el cue no suena en ningún lado (la sala nunca lo oye).
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
}
let out: HpOut | null = null;

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
export async function syncHeadphones(device: string | null, mix: number, vol: number): Promise<string | null> {
  if (!device) { teardown(); return null; }
  if (!canPickOutput()) { teardown(); return 'Este navegador no deja elegir la salida de audio: usa Chrome o Edge.'; }
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
      sum.connect(cueG); cueG.connect(vol); mstG.connect(vol); vol.connect(dest);
      const el = new Audio();
      el.autoplay = true;
      el.srcObject = dest.stream;
      out = { sum, cueG, mstG, vol, dest, el, master: null, device: '' };
    }
    // el máster (lo que oye la sala), para mezclarlo en los audífonos
    const m = getMasterPostNode() ?? null;
    if (m !== out.master) {
      try { out.master?.disconnect(out.mstG); } catch { /* */ }
      out.master = m;
      try { m?.connect(out.mstG); } catch { out.master = null; }
    }
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
