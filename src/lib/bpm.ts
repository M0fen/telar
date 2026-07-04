import { analyze } from 'web-audio-beat-detector';
import { getAudioCtx } from '../audio/engine';

// Detección de BPM de un audio (URL): lo decodifica con Web Audio y corre
// autocorrelación (web-audio-beat-detector). Dos mejoras de PRECISIÓN respecto a la
// versión ingenua `analyze(buf)`:
//   1. SEGMENTO REPRESENTATIVO: salta la intro/outro (silencios, fades) y analiza un
//      tramo central estable → menos falsos por arranques suaves.
//   2. RANGO MUSICAL acotado (minTempo/maxTempo): la autocorrelación tiende a
//      devolver el doble o la mitad (errores de octava); acotar a 70–180 lo evita.
// Aun así la detección NUNCA es infalible → la UI ofrece ×2/÷2 y edición manual.
export async function detectBpm(url: string): Promise<number | null> {
  try {
    const ab = await (await fetch(url)).arrayBuffer();
    const buf = await getAudioCtx().decodeAudioData(ab);
    const dur = buf.duration;
    const settings = { minTempo: 70, maxTempo: 180 };
    // tramo central: salta ~15% inicial (máx 20s) y analiza hasta 40s
    const offset = dur > 30 ? Math.min(dur * 0.15, 20) : 0;
    const duration = Math.min(dur - offset, 40);
    let tempo: number;
    try {
      tempo = await analyze(buf, offset, duration, settings);
    } catch {
      tempo = await analyze(buf, settings); // respaldo: todo el buffer, mismo rango
    }
    return isFinite(tempo) && tempo > 0 ? Math.round(tempo) : null;
  } catch {
    return null;
  }
}
