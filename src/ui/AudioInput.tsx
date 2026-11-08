import { useRef, useState } from 'react';
import { registerLocalSample, isStarted, heardCycle, getAudioCtx } from '../audio/engine';
import { useGraphStore } from '../store/useGraphStore';
import { sampleDuration, sampleSourceCode } from '../lib/audioMeta';
import { audioBufferToWav } from '../lib/wavEncode';

// Entrada de audio EN VIVO (micrófono / línea): graba un fragmento de la entrada y lo
// deja como un Source en LOOP — sampleo/looping en directo. Con el transporte sonando la
// toma se recorta a COMPASES ENTEROS (del primer 1 después de empezar al último 1 antes de
// parar, según lo que se oía) y queda `s("in_…").slow(compases)`: cae en la rejilla. Parado,
// queda a su largo natural. Es cliente puro; el sonido se guarda con los sonidos propios.

// [desde, hasta) en segundos de un AudioBuffer (recorte sin procesar)
function sliceBuffer(buf: AudioBuffer, from: number, len: number): AudioBuffer {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.round(from * sr));
  const n = Math.max(1, Math.min(buf.length - a, Math.round(len * sr)));
  const out = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, a + n), c);
  return out;
}
export function AudioInput() {
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cyc = useRef<{ a: number | null; b: number | null; lat: number }>({ a: null, b: null, lat: 0 });
  const addPattern = useGraphStore((s) => s.addPattern);

  // sonando: la toma recortada a compases enteros (o null si no llegó a un compás completo)
  const toBars = async (blob: Blob): Promise<{ blob: Blob; bars: number } | null> => {
    const { a, b, lat } = cyc.current;
    if (a == null || b == null) return null;
    const first = Math.ceil(a - 1e-3);
    const bars = Math.floor(b - first + 1e-3);
    if (bars < 1) return null;
    const cps = useGraphStore.getState().cps || 0.5;
    const buf = await getAudioCtx().decodeAudioData(await blob.arrayBuffer());
    const off = (first - a) / cps + lat; // la entrada llega tarde lo que tarda el micrófono
    const len = bars / cps;
    if (off + len > buf.duration + 0.03) return null;
    return { blob: audioBufferToWav(sliceBuffer(buf, off, len)), bars };
  };

  const start = async () => {
    try {
      // sin procesado (queremos la señal cruda para samplear fielmente)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const raw = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        setBusy(true);
        try {
          const name = `in_${Date.now().toString(36).slice(-5)}`;
          const cut = await toBars(raw).catch(() => null);
          if (cut) {
            await registerLocalSample(name, cut.blob);
            addPattern(cut.bars > 1 ? `s("${name}").slow(${cut.bars})` : `s("${name}")`, 'audio in');
          } else {
            await registerLocalSample(name, raw);
            const url = URL.createObjectURL(raw);
            const cps = useGraphStore.getState().cps || 0.5;
            // a su tempo y tono naturales (loopAt estiraba por varispeed); se re-dispara justo al terminar
            addPattern(sampleSourceCode(name, await sampleDuration(url), cps), 'audio in');
          }
        } finally {
          setBusy(false);
        }
      };
      r.start();
      const lat = Number((stream.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency) || 0;
      cyc.current = { a: isStarted() ? heardCycle() : null, b: null, lat };
      recRef.current = r;
      setRec(true);
    } catch (e) {
      setNote(`micrófono no disponible`);
      setTimeout(() => setNote(null), 2000);
    }
  };
  const stop = () => {
    cyc.current.b = isStarted() && cyc.current.a != null ? heardCycle() : null;
    recRef.current?.stop();
    setRec(false);
  };

  return (
    <div className="aud-rec-wrap">
      <button
        className={`aud-rec${rec ? ' on' : ''}`}
        onClick={() => (rec ? stop() : void start())}
        disabled={busy}
        title={rec ? 'detener y crear un loop con la entrada (sonando: compases enteros)' : 'grabar la entrada (micrófono/línea) como loop · sonando, se recorta a compases enteros para que caiga en la rejilla'}
      >
        <span className="aud-rec-dot" />
        <span className="aud-rec-lbl">{busy ? '···' : rec ? 'stop' : 'in'}</span>
      </button>
      {note && <span className="aud-rec-note">{note}</span>}
    </div>
  );
}
