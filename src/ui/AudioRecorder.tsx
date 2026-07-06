import { useState } from 'react';
import { startAudioRecording, stopAudioRecording } from '../lib/audioRecorder';

// Botón de grabar SOLO audio a WAV (32-bit float, sin pérdida). Vive en el menú
// derecho para estar siempre accesible (aunque la pantalla del visualizador esté
// oculta). Al detener, descarga el .wav.
export function AudioRecorder() {
  const [rec, setRec] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const toggle = async () => {
    if (rec) {
      const blob = await stopAudioRecording(); // async: espera el vaciado del worklet (no pierde la cola)
      setRec(false);
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `telar-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } else if (await startAudioRecording()) {
      setRec(true);
    } else {
      setNote('inicia el audio (Play) primero');
      setTimeout(() => setNote(null), 1800);
    }
  };

  return (
    <div className="aud-rec-wrap">
      <button
        className={`aud-rec${rec ? ' on' : ''}`}
        onClick={() => void toggle()}
        title={rec ? 'detener y guardar .wav' : 'grabar solo audio (.wav, máxima calidad)'}
      >
        <span className="aud-rec-dot" />
        <span className="aud-rec-lbl">{rec ? 'rec' : 'wav'}</span>
      </button>
      {note && <span className="aud-rec-note">{note}</span>}
    </div>
  );
}
