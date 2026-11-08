import { useRef, useState } from 'react';
import { registerLocalSample } from '../audio/engine';
import { useGraphStore } from '../store/useGraphStore';
import { sampleDuration, sampleSourceCode } from '../lib/audioMeta';

// Entrada de audio EN VIVO (micrófono / línea): graba un fragmento de la entrada y lo
// deja como un Source en LOOP (`s("in_…").loopAt(n).chop(n)`) — sampleo/looping en
// directo para beatmaking y performance. Es cliente puro (no toca el servidor), a
// diferencia del grabador de voz. El clip vive en memoria (objectURL).
export function AudioInput() {
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const addPattern = useGraphStore((s) => s.addPattern);

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
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        setBusy(true);
        try {
          const name = `in_${Date.now().toString(36).slice(-5)}`;
          await registerLocalSample(name, blob);
          const url = URL.createObjectURL(blob);
          const cps = useGraphStore.getState().cps || 0.5;
          // a su tempo y tono naturales (loopAt estiraba por varispeed: 3 s a 140 BPM sonaban
          // 2,3 semitonos abajo); se re-dispara justo al terminar, sin solaparse
          addPattern(sampleSourceCode(name, await sampleDuration(url), cps), 'audio in');
        } finally {
          setBusy(false);
        }
      };
      r.start();
      recRef.current = r;
      setRec(true);
    } catch (e) {
      setNote(`micrófono no disponible`);
      setTimeout(() => setNote(null), 2000);
    }
  };
  const stop = () => { recRef.current?.stop(); setRec(false); };

  return (
    <div className="aud-rec-wrap">
      <button
        className={`aud-rec${rec ? ' on' : ''}`}
        onClick={() => (rec ? stop() : void start())}
        disabled={busy}
        title={rec ? 'detener y crear un loop con la entrada' : 'grabar la entrada (micrófono/línea) como loop'}
      >
        <span className="aud-rec-dot" />
        <span className="aud-rec-lbl">{busy ? '···' : rec ? 'stop' : 'in'}</span>
      </button>
      {note && <span className="aud-rec-note">{note}</span>}
    </div>
  );
}
