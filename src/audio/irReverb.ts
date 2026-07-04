import { samples, getAudioContext } from '@strudel/web';
import { ensureEngine } from './engine';
import { BUILTIN_IRS, registerUserIr, type IrDef } from './irRegistry';
import { useIrStore } from '../store/useIrStore';

// REVERB POR IMPULSO (IR): superdough soporta `.ir("<sample>")` — carga una muestra
// como respuesta al impulso de un ConvolverNode real (verificado en superdough/dist
// index.mjs). Dos vías conviven:
//   • ESPACIOS DE ARRANQUE (gratis, sin licencia): los GENERAMOS sintéticamente
//     (ruido con decaimiento exponencial + amortiguación por filtro de un polo +
//     estéreo decorrelacionado). Quedan como samples ir_room/ir_plate/ir_chamber/
//     ir_hall/ir_cathedral/ir_spring para `.room(x).ir("ir_hall")`.
//   • IRs REALES del usuario (Bricasti M7, OpenAIR, etc.): `registerIrFiles` mide su
//     duración real y los registra como samples ir_u_<slug> → aparecen en el selector
//     de espacio. Es la palanca "altísimo nivel".
// La DURACIÓN vive en irRegistry.ts (fuente única) para que el compilador emita el
// roomsize exacto y no trunque/repita la cola.

export interface IrSpace extends IrDef { decay: number; damp: number; predelay: number }

// Parámetros de generación por espacio (la duración/label salen de BUILTIN_IRS):
// decay=curva (mayor=cae antes), damp=oscuridad del tail (0..1, LPF de un polo),
// predelay=hueco inicial (s).
const GEN: Record<string, { decay: number; damp: number; predelay: number }> = {
  ir_room: { decay: 1.0, damp: 0.35, predelay: 0.004 },
  ir_plate: { decay: 0.85, damp: 0.12, predelay: 0.002 },
  ir_chamber: { decay: 0.95, damp: 0.3, predelay: 0.008 },
  ir_hall: { decay: 0.9, damp: 0.45, predelay: 0.012 },
  ir_cathedral: { decay: 0.95, damp: 0.6, predelay: 0.02 },
  ir_spring: { decay: 1.4, damp: 0.2, predelay: 0.001 },
};

export const IR_SPACES: IrSpace[] = BUILTIN_IRS.map((b) => ({
  ...b,
  ...(GEN[b.name] ?? { decay: 1.0, damp: 0.35, predelay: 0.004 }),
}));

const SR = 44100;

// Genera un canal de IR: ruido * envolvente exp, con amortiguación (LPF de un polo),
// pre-delay y unas reflexiones tempranas para dar cuerpo.
function genChannel(sp: IrSpace, seed: number): Float32Array {
  const n = Math.max(1, Math.floor(sp.duration * SR));
  const out = new Float32Array(n);
  // PRNG determinista simple (mulberry32) → IRs reproducibles entre sesiones.
  let s = seed >>> 0;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pre = Math.floor(sp.predelay * SR);
  const k = sp.decay * (6.9 / sp.duration); // -60 dB ≈ al final de la cola
  const a = 1 - sp.damp; // coef. del LPF de un polo (más damp = tail más oscuro)
  let lp = 0;
  // reflexiones tempranas (ms): pequeños picos que dan sensación de espacio
  const early = [0.007, 0.011, 0.017, 0.023, 0.031].map((t) => Math.floor(t * SR) + pre);
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / SR;
    const env = Math.exp(-k * t);
    let x = (rnd() * 2 - 1) * env;
    lp = lp + a * (x - lp); // paso-bajo de un polo (amortigua agudos del tail)
    x = lp;
    for (let e = 0; e < early.length; e++) if (i === early[e]) x += (0.5 - e * 0.08) * (rnd() * 2 - 1);
    out[i] = x;
  }
  // fade-in cortito para evitar click en el arranque
  const f = Math.min(64, n);
  for (let i = 0; i < f; i++) out[i] *= i / f;
  // normaliza a un pico razonable
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.9 / peak;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// WAV estéreo PCM float32 (IEEE) desde dos canales.
function encodeWavStereo(L: Float32Array, R: Float32Array, sampleRate: number): Blob {
  const len = Math.min(L.length, R.length);
  const bytesPerSample = 4, channels = 2, blockAlign = channels * bytesPerSample;
  const dataLen = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const ws = (o: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, bytesPerSample * 8, true);
  ws(36, 'data'); v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < len; i++) { v.setFloat32(off, L[i], true); off += 4; v.setFloat32(off, R[i], true); off += 4; }
  return new Blob([buf], { type: 'audio/wav' });
}

let done = false;
// Registra los espacios IR como samples (idempotente). Se llama en el primer Play.
export async function registerIrReverbs(): Promise<void> {
  if (done) return;
  await ensureEngine();
  const map: Record<string, string> = {};
  for (let i = 0; i < IR_SPACES.length; i++) {
    const sp = IR_SPACES[i];
    const L = genChannel(sp, 1000 + i * 7);
    const R = genChannel(sp, 5000 + i * 13); // otra semilla → decorrelación estéreo (anchura)
    map[sp.name] = URL.createObjectURL(encodeWavStereo(L, R, SR));
  }
  await samples(map);
  done = true;
}

// Normaliza un nombre de archivo a un id de muestra estable: `ir_u_<slug>`.
function irSlug(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `ir_u_${base || 'ir'}`;
}

// Carga IRs REALES (WAV/AIFF/FLAC/OGG) que el usuario compró/descargó (Bricasti M7,
// OpenAIR, etc.). Mide la DURACIÓN real de cada uno (decodeAudioData) para que el
// compilador emita el roomsize exacto y la cola suene íntegra, sin bucle ni recorte.
// Los registra como samples ir_u_<slug> y los publica al selector (registro puro +
// espejo reactivo). No persisten al recargar (objectURL en memoria), igual que los
// samples locales.
export async function registerIrFiles(files: File[] | FileList): Promise<IrDef[]> {
  await ensureEngine();
  const ctx = getAudioContext();
  const list = Array.from(files);
  const map: Record<string, string> = {};
  const added: IrDef[] = [];
  for (const f of list) {
    if (!/\.(wav|aif|aiff|flac|ogg|mp3)$/i.test(f.name)) continue;
    let duration = 3; // respaldo si el navegador no puede decodificar el formato
    try {
      const buf = await ctx.decodeAudioData(await f.arrayBuffer());
      if (isFinite(buf.duration) && buf.duration > 0) duration = buf.duration;
    } catch {
      /* formato no decodificable para medir; se usa el respaldo */
    }
    const name = irSlug(f.name);
    map[name] = URL.createObjectURL(f);
    const def: IrDef = { name, label: name.replace(/^ir_u_/, '').replace(/_/g, ' ').slice(0, 22), duration, user: true };
    registerUserIr(def); // registro puro (lo lee el compilador)
    added.push(def);
  }
  if (added.length) {
    await samples(map);
    useIrStore.getState().add(...added); // espejo reactivo (refresca la UI)
  }
  return added;
}
