import { useEffect, useRef, useState } from 'react';
import { useDownloadsStore } from '../store/useDownloadsStore';
import { useGraphStore } from '../store/useGraphStore';
import { registerSample } from '../audio/engine';
import { sampleDuration } from '../lib/audioMeta';
import { DEFAULT_VOICE } from '../graph/types';
import { registerAiVoice } from '../lib/aiVoiceSample';

// Grabador de micrófono: captura tu voz → la guarda como sample en el servidor →
// crea un nodo Source s("voz_…") a velocidad natural, listo para cortar/editar
// (.chop, .slice, .begin/.end, vowel, etc.). Persiste y se re-registra al Play.
export function Recorder() {
  const addPattern = useGraphStore((s) => s.addPattern);
  const refresh = useDownloadsStore((s) => s.refresh);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => void save(new Blob(chunksRef.current, { type: 'audio/webm' }));
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      setError(`micrófono no disponible (${(e as Error).message})`);
    }
  };

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  };

  const save = async (blob: Blob) => {
    setBusy(true);
    setError(null);
    try {
      const title = `voz ${new Date().toLocaleTimeString().slice(0, 5)}`;
      // 1) intenta el servidor (dev: persiste el WAV en disco vía vite-plugin).
      let serverTrack: { name: string; file: string; title: string } | null = null;
      let serverSaved = false;
      try {
        const r = await fetch(`/api/rec/save?title=${encodeURIComponent(title)}`, { method: 'POST', body: blob });
        if (r.ok) {
          const j = (await r.json()) as { ok?: boolean; track?: { name: string; file: string; title: string } };
          if (j.ok && j.track) { serverTrack = j.track; serverSaved = true; }
        }
      } catch {
        /* sin plugin de servidor (build estático/prod) → fallback cliente */
      }
      // 2) FALLBACK CLIENTE (prod): registra la grabación como sample en memoria
      // (objectURL) + voiceUrls + downloadsStore → suena, se ve la onda y es editable,
      // SIN servidor. Antes esto lanzaba 404 en prod y no se podía guardar la voz.
      let track: { name: string; file: string; title: string };
      if (serverTrack) {
        await registerSample(serverTrack.name, serverTrack.file);
        track = serverTrack;
      } else {
        const name = `voz_${Date.now().toString(36)}`;
        const file = await registerAiVoice(name, blob, title); // objectURL + registra + downloadsStore
        track = { name, file, title };
      }
      // Span = ciclos que ABARCA la voz a su pitch real (redondeo hacia arriba para
      // que suene entera sin cortarse). Modo NATURAL por defecto: el panel emite
      // .slow(span), NO loopAt → no desafina ni bucla sin parar (el bug del record).
      const dur = await sampleDuration(track.file);
      const cps = useGraphStore.getState().cps || 0.5;
      const span = Math.max(1, Math.min(512, Math.ceil(dur * cps)));
      // Source de voz LIMPIO + abre el ESTUDIO de voz dedicado para editarla (melodía/
      // autotune, natural/granular, recorte, formante/espacio) en su área propia.
      const newId = addPattern(`s("${track.name}")`, track.title, {
        voice: { ...DEFAULT_VOICE, loop: span, grain: Math.max(4, Math.min(16, span * 2)) },
      });
      useGraphStore.getState().setVoiceEdit(newId);
      if (serverSaved) await refresh(); // dev: aparece en la lista del servidor y persiste
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <section className="rec">
      <h3>grabar voz</h3>
      {recording ? (
        <button className="rec-btn on" onClick={stop}>
          <span className="rec-dot" /> detener · {mm}:{ss}
        </button>
      ) : (
        <button className="rec-btn" onClick={() => void start()} disabled={busy}>
          {busy ? 'guardando…' : '● grabar micrófono'}
        </button>
      )}
      {error && <p className="dl-error">{error}</p>}
    </section>
  );
}
