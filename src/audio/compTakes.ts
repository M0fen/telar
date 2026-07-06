// HILO B · B4 — COMPING de tomas: compone una toma final eligiendo, por TRAMOS, cuál de
// varias grabaciones suena en cada parte. Alinea las tomas al inicio (t=0), divide la
// duración en N segmentos y para cada segmento toma el audio de la toma elegida, con un
// crossfade corto en los bordes para que no haya clics. Puro (Float32Array) → testeable.

// selection[seg] = índice de la toma activa en ese segmento. xfadeSec = crossfade en los
// bordes entre segmentos de tomas distintas. Devuelve un AudioBuffer nuevo.
export function compTakes(takes: AudioBuffer[], selection: number[], xfadeSec = 0.008): AudioBuffer {
  if (!takes.length || !selection.length) throw new Error('comping: faltan tomas o selección');
  const sr = takes[0].sampleRate;
  const channels = Math.max(1, ...takes.map((t) => t.numberOfChannels));
  const compLen = Math.max(...takes.map((t) => t.length));
  const nSeg = selection.length;
  const segLen = Math.max(1, Math.floor(compLen / nSeg));
  const xf = Math.max(0, Math.min(Math.floor(xfadeSec * sr), Math.floor(segLen / 2)));

  const sampleAt = (takeIdx: number, ch: number, i: number): number => {
    const t = takes[takeIdx];
    if (!t || i < 0 || i >= t.length) return 0;
    const c = ch < t.numberOfChannels ? ch : 0;
    return t.getChannelData(c)[i];
  };

  const out = new AudioBuffer({ length: compLen, numberOfChannels: channels, sampleRate: sr });
  for (let ch = 0; ch < channels; ch++) {
    const d = out.getChannelData(ch);
    for (let seg = 0; seg < nSeg; seg++) {
      const start = seg * segLen;
      const end = seg === nSeg - 1 ? compLen : start + segLen; // el último toma el resto
      const cur = selection[seg];
      for (let i = start; i < end; i++) d[i] = sampleAt(cur, ch, i);
    }
    // crossfades en los bordes (tras escribir los segmentos) entre tomas distintas
    if (xf > 0) {
      for (let seg = 1; seg < nSeg; seg++) {
        const prev = selection[seg - 1], cur = selection[seg];
        if (prev === cur) continue;
        const boundary = seg * segLen;
        for (let k = 0; k < xf; k++) {
          const i = boundary - Math.floor(xf / 2) + k;
          if (i < 0 || i >= compLen) continue;
          const g = k / xf; // 0..1: de prev a cur
          d[i] = sampleAt(prev, ch, i) * (1 - g) + sampleAt(cur, ch, i) * g;
        }
      }
    }
  }
  return out;
}
