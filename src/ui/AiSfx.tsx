import { useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { requestSfx, registerSfxSample, SFX_TEMPLATES, type SfxTemplate } from '../lib/sfx';

// SFX GENERATIVO (ElevenLabs sound-generation): describes un sonido — riser, impacto,
// sub-drop, textura, foley — y la IA lo genera. Entra a la galería como Source
// (`s("nombre")`) listo para tocar/editar. Plantillas por categoría para inspirar.
let counter = 0;

export function AiSfx({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addPattern = useGraphStore((s) => s.addPattern);
  const [text, setText] = useState('');
  const [duration, setDuration] = useState<number | 'auto'>('auto');
  const [influence, setInfluence] = useState(0.4);
  const [loop, setLoop] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  // último resultado: se puede pre-escuchar antes de añadirlo al grafo.
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!open) return null;

  const pickTemplate = (t: SfxTemplate) => {
    setText(t.text);
    setDuration(t.duration ?? 'auto');
    setLoop(t.loop);
  };

  const generate = async () => {
    const t = text.trim();
    if (!t || status === 'loading') return;
    setStatus('loading');
    setError(null);
    try {
      const blob = await requestSfx(t, { duration: duration === 'auto' ? null : duration, influence, loop });
      const name = `ai_sfx_${++counter}_${Math.random().toString(36).slice(2, 5)}`;
      const url = await registerSfxSample(name, blob);
      setResult({ url, name });
      setStatus('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo generar');
      setStatus('error');
    }
  };

  const preview = () => {
    if (!result) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    if (playing) { a.pause(); setPlaying(false); return; }
    a.src = result.url;
    a.loop = loop;
    a.onended = () => setPlaying(false);
    void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const addToGraph = () => {
    if (!result) return;
    // loop → slow para que la textura ocupe varios ciclos; one-shot suena tal cual.
    const code = loop ? `s("${result.name}").slow(2)` : `s("${result.name}")`;
    addPattern(code, 'sfx IA');
    if (audioRef.current) audioRef.current.pause();
    setResult(null);
    setPlaying(false);
    onClose();
  };

  const cats = Array.from(new Set(SFX_TEMPLATES.map((t) => t.cat)));

  return (
    <>
      <div className="ai-backdrop" onClick={onClose} />
      <div className="ai-panel">
        <header className="ai-head">
          <span className="ai-title">sfx IA · texto → sonido</span>
          <button className="ai-x" onClick={onClose} title="cerrar">×</button>
        </header>

        <textarea
          className="ai-input"
          value={text}
          placeholder="describe el sonido… ej: 'dark uplifting riser building tension' · 'huge sub boom impact'"
          onChange={(e) => setText(e.target.value)}
          maxLength={450}
          rows={2}
        />

        <div className="sfx-templates">
          {cats.map((c) => (
            <div key={c} className="sfx-cat">
              <span className="sfx-cat-tag">{c}</span>
              {SFX_TEMPLATES.filter((t) => t.cat === c).map((t) => (
                <button key={t.label} className="sfx-tpl" onClick={() => pickTemplate(t)} title={t.text}>{t.label}</button>
              ))}
            </div>
          ))}
        </div>

        <div className="va-ctrls">
          <label className="va-style">
            <span>duración</span>
            <input type="range" min={0} max={22} step={0.5} value={duration === 'auto' ? 0 : duration} onChange={(e) => { const v = Number(e.target.value); setDuration(v === 0 ? 'auto' : v); }} />
            <i>{duration === 'auto' ? 'auto' : `${duration}s`}</i>
          </label>
          <label className="va-style"><span>fidelidad</span><input type="range" min={0} max={1} step={0.05} value={influence} onChange={(e) => setInfluence(Number(e.target.value))} /><i>{Math.round(influence * 100)}</i></label>
          <label className="sfx-loop"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /><span>loop (textura)</span></label>
        </div>

        <div className="ai-actions">
          <button className="ai-go" onClick={() => void generate()} disabled={status === 'loading' || !text.trim()}>
            {status === 'loading' ? 'generando…' : result ? 'regenerar' : 'generar sonido'}
          </button>
          {result && (
            <>
              <button className="sfx-prev" onClick={preview} title="escuchar">{playing ? '❚❚' : '▸'}</button>
              <button className="ai-go sfx-add" onClick={addToGraph} title="añadir a la galería como source">añadir ✓</button>
            </>
          )}
          <span className="ai-note">{text.length}/450</span>
        </div>

        {status === 'error' && <div className="ai-err">⚠ {error}</div>}
      </div>
    </>
  );
}
