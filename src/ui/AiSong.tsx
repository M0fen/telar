import { useEffect, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { getAudioCtx } from '../audio/engine';
import { DEFAULT_VOICE } from '../graph/types';
import { requestAiGraph, sanitizeAiGraph } from '../lib/aiGraph';
import { requestTts, fetchVoices, FALLBACK_VOICES, type TtsVoice } from '../lib/tts';
import { registerAiVoice } from '../lib/aiVoiceSample';

// PIPELINE end-to-end (Pilar 3): describes una canción → DeepSeek arma el grafo del
// género + una letra → ElevenLabs canta la letra → la voz entra afinable al estudio,
// conectada al Out, y suena la demo COMPLETA y editable. La "canción preview".

type Step = 'idle' | 'grafo' | 'voz' | 'listo' | 'error';

async function blobDurationSec(blob: Blob): Promise<number> {
  try {
    const ab = await blob.arrayBuffer();
    const buf = await getAudioCtx().decodeAudioData(ab);
    return buf.duration;
  } catch {
    return 4;
  }
}

export function AiSong({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loadSnapshot = useGraphStore((s) => s.loadSnapshot);
  const play = useGraphStore((s) => s.play);
  const [prompt, setPrompt] = useState('');
  const [withVocals, setWithVocals] = useState(true);
  const [voices, setVoices] = useState<TtsVoice[]>(FALLBACK_VOICES);
  const [voice, setVoice] = useState(FALLBACK_VOICES[0].id);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; lyrics: string; warnings: string[]; voiceOk: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchVoices().then((vs) => { if (alive && vs.length) setVoices(vs); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;
  const busy = step === 'grafo' || step === 'voz';

  const compose = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setError(null);
    setResult(null);
    setStep('grafo');
    try {
      const raw = await requestAiGraph(p, undefined, { withLyrics: withVocals });
      const { snap, warnings } = sanitizeAiGraph(raw);
      loadSnapshot(snap);
      const cps = useGraphStore.getState().cps || 0.5;
      const lyrics = String((raw.lyrics as string) || '').trim();
      const title = String((raw.lyricsTitle as string) || 'preview').trim();
      let voiceOk = false;

      if (withVocals && lyrics) {
        setStep('voz');
        const blob = await requestTts(lyrics, { voiceId: voice, style: 0.35 });
        const dur = await blobDurationSec(blob);
        const span = Math.max(1, Math.round(dur * cps)); // ciclos que ocupa la toma
        const name = `ai_voz_${Date.now().toString(36)}`;
        await registerAiVoice(name, blob, 'voz · ' + title); // onda editable en el estudio
        const st = useGraphStore.getState();
        const out = st.nodes.find((n) => n.data.kind === 'out');
        const pos = out ? { x: out.position.x - 260, y: out.position.y + 140 } : undefined;
        const vid = st.addPattern(`s("${name}")`, 'voz IA', { voice: { ...DEFAULT_VOICE, loop: span, room: 0.18, gain: 1 } }, pos, { connectToOut: false });
        if (out) st.onConnect({ source: vid, target: out.id, sourceHandle: null, targetHandle: null });
        st.recompile();
        voiceOk = true;
      }

      setResult({ title, lyrics, warnings, voiceOk });
      setStep('listo');
      void play();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo componer');
      setStep('error');
    }
  };

  return (
    <>
      <div className="ai-backdrop" onClick={busy ? undefined : onClose} />
      <div className="ai-panel">
        <header className="ai-head">
          <span className="ai-title">componer canción · pipeline IA</span>
          <button className="ai-x" onClick={onClose} title="cerrar">×</button>
        </header>

        <textarea
          className="ai-input"
          value={prompt}
          placeholder="describe nuestra canción preview: género, tempo, ambiente, tema de la letra… (ej.: reggaeton oscuro 94bpm sobre la noche en la ciudad, con un gancho pegadizo)"
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />

        <label className="as-toggle">
          <input type="checkbox" checked={withVocals} onChange={(e) => setWithVocals(e.target.checked)} />
          <span>con voz cantada (letra generada + sintetizada)</span>
        </label>

        {withVocals && (
          <div className="as-voice">
            <span>voz</span>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.tag ? ` — ${v.tag}` : ''}</option>)}
            </select>
          </div>
        )}

        <div className="ai-actions">
          <button className="ai-go" onClick={() => void compose()} disabled={busy || !prompt.trim()}>
            {step === 'grafo' ? 'armando la pista…' : step === 'voz' ? 'cantando la letra…' : 'componer y sonar'}
          </button>
          <span className="ai-note">reemplaza tu lienzo · Ctrl+Z lo deshace</span>
        </div>

        {step === 'error' && <div className="ai-err">⚠ {error}</div>}
        {step === 'listo' && result && (
          <div className="ai-ok">
            ✓ «{result.title}» lista {result.voiceOk ? '· con voz — ábrela en el estudio de voz para afinarla' : ''}
            {result.lyrics && <blockquote className="as-lyrics">{result.lyrics}</blockquote>}
            {result.warnings.length > 0 && <ul className="ai-warn">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
        )}
      </div>
    </>
  );
}
