// AIFF / AIFC sin comprimir (lo que usan muchas colecciones de DJ, sobre todo en Mac). Chrome y Edge
// no lo decodifican: esto lo lee a mano. Puro: devuelve la frecuencia y los canales en flotante.
// PCM de 8, 16, 24 y 32 bit (grande o pequeño extremo: 'NONE' / 'twos' / 'sowt') y flotante de 32 o
// 64 bit ('fl32' / 'fl64'). Otro códec → null.
const str = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

export function isAiff(ab: ArrayBuffer): boolean {
  if (ab.byteLength < 12) return false;
  const v = new DataView(ab);
  return str(v, 0) === 'FORM' && (str(v, 8) === 'AIFF' || str(v, 8) === 'AIFC');
}

// número de 80 bit (extendido de IEEE, grande extremo): la frecuencia de muestreo
function ext80(v: DataView, o: number): number {
  const se = v.getUint16(o);
  const sign = se & 0x8000 ? -1 : 1;
  const e = se & 0x7fff;
  const hi = v.getUint32(o + 2), lo = v.getUint32(o + 6);
  if (e === 0 && hi === 0 && lo === 0) return 0;
  return sign * (hi * 2 ** 32 + lo) * 2 ** (e - 16383 - 63);
}

export function parseAiff(ab: ArrayBuffer): { sampleRate: number; channels: Float32Array[] } | null {
  if (!isAiff(ab)) return null;
  const v = new DataView(ab);
  const aifc = str(v, 8) === 'AIFC';
  let nCh = 0, frames = 0, bits = 0, sr = 0, codec = 'NONE';
  let data = -1, dataLen = 0;
  for (let o = 12; o + 8 <= ab.byteLength;) {
    const id = str(v, o), size = v.getUint32(o + 4), body = o + 8;
    if (id === 'COMM') {
      nCh = v.getUint16(body);
      frames = v.getUint32(body + 2);
      bits = v.getUint16(body + 6);
      sr = ext80(v, body + 8);
      if (aifc && size >= 22) codec = str(v, body + 18);
    } else if (id === 'SSND') {
      const off = v.getUint32(body);
      data = body + 8 + off;
      dataLen = Math.min(size - 8 - off, ab.byteLength - data);
    }
    o = body + size + (size & 1); // los trozos van alineados a 2 bytes
  }
  if (!nCh || !frames || !(sr > 0) || data < 0) return null;
  const c = codec.toLowerCase();
  const float = c === 'fl32' || c === 'fl64';
  const little = c === 'sowt';
  if (!float && !little && c !== 'none' && c !== 'twos') return null;
  const bytes = float ? (c === 'fl64' ? 8 : 4) : Math.ceil(bits / 8);
  if (!float && (bytes < 1 || bytes > 4)) return null;
  const n = Math.min(frames, Math.floor(dataLen / (bytes * nCh)));
  const chans = Array.from({ length: nCh }, () => new Float32Array(n));
  const scale = 1 / 2 ** (bytes * 8 - 1);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < nCh; ch++) {
      const p = data + (i * nCh + ch) * bytes;
      let x: number;
      if (float) x = bytes === 8 ? v.getFloat64(p, false) : v.getFloat32(p, false);
      else if (bytes === 1) x = v.getInt8(p) * scale;
      else if (bytes === 2) x = v.getInt16(p, little) * scale;
      else if (bytes === 3) {
        const b0 = v.getUint8(p), b1 = v.getUint8(p + 1), b2 = v.getUint8(p + 2);
        let s = little ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
        if (s & 0x800000) s -= 0x1000000;
        x = s * scale;
      } else x = v.getInt32(p, little) * scale;
      chans[ch][i] = x;
    }
  }
  return { sampleRate: sr, channels: chans };
}
