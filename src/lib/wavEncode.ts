// Codifica un AudioBuffer (mono o estéreo, N canales) a WAV PCM IEEE float 32-bit
// (format code 3) SIN pérdida, al sample-rate del buffer. Reutilizable: recorte
// destructivo de voz, export de stems, etc.
export function audioBufferToWav(buf: AudioBuffer): Blob {
  const channels = buf.numberOfChannels;
  const len = buf.length;
  const bytesPerSample = 4;
  const blockAlign = channels * bytesPerSample;
  const dataLen = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataLen);
  const v = new DataView(ab);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // 3 = IEEE float
  v.setUint16(22, channels, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bytesPerSample * 8, true);
  ws(36, 'data');
  v.setUint32(40, dataLen, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < channels; c++) { v.setFloat32(off, chans[c][i], true); off += 4; }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
