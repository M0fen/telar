import { getAudioCtx } from '../audio/engine';

// Duración (s) FIABLE: decodifica el audio con Web Audio. Necesario porque para
// webm/opus de YouTube, <audio>.duration suele devolver Infinity/NaN, lo que
// rompía loopAt(). Cae a los metadatos del <audio> sólo si la decodificación falla.
export async function sampleDuration(url: string): Promise<number> {
  try {
    const ab = await (await fetch(url)).arrayBuffer();
    const buf = await getAudioCtx().decodeAudioData(ab);
    if (isFinite(buf.duration) && buf.duration > 0) return buf.duration;
  } catch {
    /* sigue al fallback */
  }
  return audioDurationMeta(url);
}

// Duración por metadatos (ligero, pero poco fiable en webm sin cabecera).
export function audioDurationMeta(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => reject(new Error('no metadata'));
    a.src = url;
  });
}

// Reglas puras de reproducción de sample (naturalLoop, sampleSourceCode, bareSampleName)
// viven en sampleFit.ts (sin dependencias del motor → testeables). Se re-exportan aquí
// por compatibilidad con los imports existentes.
export { naturalLoop, sampleSourceCode, bareSampleName } from './sampleFit';
