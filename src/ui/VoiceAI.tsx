import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { DEFAULT_VOICE } from '../graph/types';
import { requestTts, fetchVoices, FALLBACK_VOICES, type TtsVoice } from '../lib/tts';
import { registerAiVoice } from '../lib/aiVoiceSample';

// VOZ IA (ElevenLabs): escribes una letra/frase, ESCUCHAS y eliges una voz (todas las
// de la cuenta, con preview sin gastar cuota), ajustas estabilidad/parecido/expresividad
// y se sintetiza. El audio entra al ESTUDIO DE VOZ para afinar/encajar al tempo.
let counter = 0;

export function VoiceAI({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addPattern = useGraphStore((s) => s.addPattern);
  const setVoiceEdit = useGraphStore((s) => s.setVoiceEdit);
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<TtsVoice[]>(FALLBACK_VOICES);
  const [voice, setVoice] = useState(FALLBACK_VOICES[0].id);
  const [q, setQ] = useState('');
  const [stability, setStability] = useState(0.4);
  const [similarity, setSimilarity] = useState(0.75);
  const [style, setStyle] = useState(0.3);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // carga todas las voces al abrir
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchVoices().then((vs) => { if (alive && vs.length) setVoices(vs); });
    return () => { alive = false; };
  }, [open]);

  // detener preview al cerrar
  useEffect(() => {
    if (!open && audioRef.current) { audioRef.current.pause(); setPreviewing(null); }
  }, [open]);

  if (!open) return null;

  const playPreview = (v: TtsVoice) => {
    if (!v.preview) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    if (previewing === v.id) { a.pause(); setPreviewing(null); return; }
    a.src = v.preview;
    a.onended = () => setPreviewing(null);
    void a.play().then(() => setPreviewing(v.id)).catch(() => setPreviewing(null));
  };

  const generate = async () => {
    const t = text.trim();
    if (!t || status === 'loading') return;
    setStatus('loading');
    setError(null);
    try {
      const blob = await requestTts(t, { voiceId: voice, stability, similarity, style });
      const name = `ai_voz_${++counter}_${Math.random().toString(36).slice(2, 5)}`;
      await registerAiVoice(name, blob); // registra + añade a downloadsStore → onda editable
      const id = addPattern(`s("${name}")`, 'voz IA', { voice: { ...DEFAULT_VOICE } });
      if (audioRef.current) audioRef.current.pause();
      setStatus('idle');
      onClose();
      setVoiceEdit(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo generar');
      setStatus('error');
    }
  };

  const shown = voices.filter((v) => {
    const s = q.trim().toLowerCase();
    return !s || v.name.toLowerCase().includes(s) || v.tag.toLowerCase().includes(s);
  });
  const sel = voices.find((v) => v.id === voice);

  return (
    <>
      <div className="ai-backdrop" onClick={onClose} />
      <div className="ai-panel">
        <header className="ai-head">
          <span className="ai-title">voz IA · texto → voz</span>
          <button className="ai-x" onClick={onClose} title="cerrar">×</button>
        </header>

        <textarea
          className="ai-input"
          value={text}
          placeholder="escribe la letra o frase… (se sintetiza y entra al estudio de voz para afinarla y encajarla al tempo)"
          onChange={(e) => setText(e.target.value)}
          maxLength={800}
          rows={3}
        />

        <div className="va-voicebar">
          <span className="va-lbl">voz{sel ? `: ${sel.name}` : ''}</span>
          <input className="va-search" value={q} placeholder={`buscar entre ${voices.length}…`} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="va-list">
          {shown.map((v) => (
            <div key={v.id} className={`va-voice${voice === v.id ? ' on' : ''}`} onClick={() => setVoice(v.id)}>
              <button
                className={`va-prev${previewing === v.id ? ' on' : ''}`}
                onClick={(e) => { e.stopPropagation(); playPreview(v); }}
                disabled={!v.preview}
                title={v.preview ? 'escuchar muestra' : 'sin muestra'}
              >{previewing === v.id ? '❚❚' : '▸'}</button>
              <span className="va-vname">{v.name}</span>
              <span className="va-vtag">{v.tag}</span>
            </div>
          ))}
        </div>

        <div className="va-ctrls">
          <label className="va-style"><span>estabilidad</span><input type="range" min={0} max={1} step={0.05} value={stability} onChange={(e) => setStability(Number(e.target.value))} /><i>{Math.round(stability * 100)}</i></label>
          <label className="va-style"><span>parecido</span><input type="range" min={0} max={1} step={0.05} value={similarity} onChange={(e) => setSimilarity(Number(e.target.value))} /><i>{Math.round(similarity * 100)}</i></label>
          <label className="va-style"><span>expresividad</span><input type="range" min={0} max={1} step={0.05} value={style} onChange={(e) => setStyle(Number(e.target.value))} /><i>{Math.round(style * 100)}</i></label>
        </div>

        <div className="ai-actions">
          <button className="ai-go" onClick={() => void generate()} disabled={status === 'loading' || !text.trim()}>
            {status === 'loading' ? 'sintetizando…' : 'generar voz'}
          </button>
          <span className="ai-note">{text.length}/800 · entra al estudio de voz</span>
        </div>

        {status === 'error' && <div className="ai-err">⚠ {error}</div>}
      </div>
    </>
  );
}
