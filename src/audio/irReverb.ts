import { samples, getAudioContext } from '@strudel/web';
import { ensureEngine } from './engine';
import { registerUserIr, type IrDef } from './irRegistry';
import { genIrStereo, IR_SPACES } from '../lib/irGen';
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

export { IR_SPACES, type IrSpace } from '../lib/irGen';

const SR = 44100;

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
  for (const sp of IR_SPACES) {
    const lr = genIrStereo(sp.name, SR); // dos semillas → decorrelación estéreo (anchura)
    if (lr) map[sp.name] = URL.createObjectURL(encodeWavStereo(lr[0], lr[1], SR));
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
    const def: IrDef = { name, label: name.replace(/^ir_u_/, '').replace(/_/g, ' ').slice(0, 22), duration, user: true, url: map[name] };
    registerUserIr(def); // registro puro (lo lee el compilador)
    added.push(def);
  }
  if (added.length) {
    await samples(map);
    useIrStore.getState().add(...added); // espejo reactivo (refresca la UI)
  }
  return added;
}
