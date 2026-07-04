import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { requestAiGraph, sanitizeAiGraph } from '../lib/aiGraph';

// COPILOTO IA (prompt → grafo): describes un beat en español y DeepSeek arma un
// grafo Telar que se valida/sanea (src/lib/aiGraph.ts) y se carga EDITABLE en el
// lienzo. Lo diferencial: el resultado no es un mp3 cerrado, es tu grafo de nodos.

const EXAMPLES = [
  'reggaeton old school a 92bpm: dembow crudo, 808, hats y un lead menor',
  'hardtechno oscuro 150bpm, bombo distorsionado, rumble y stab disonante',
  'dnb 174bpm con break rápido, sub rodante y pads atmosféricos',
  'house cálido 124bpm con bombo four-on-the-floor, bajo con sidechain y stab de piano',
  'phonk 140bpm: 808 deslizado, cencerro, hats rápidos y voz oscura',
];

export function AiCopilot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loadSnapshot = useGraphStore((s) => s.loadSnapshot);
  const play = useGraphStore((s) => s.play);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!open) return null;

  const generate = async () => {
    const p = prompt.trim();
    if (!p || status === 'loading') return;
    setStatus('loading');
    setError(null);
    setWarnings([]);
    try {
      const raw = await requestAiGraph(p);
      const { snap, warnings } = sanitizeAiGraph(raw);
      loadSnapshot(snap);
      setWarnings(warnings);
      setStatus('done');
      void play(); // el clic es el gesto de usuario que habilita el audio
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo generar');
      setStatus('error');
    }
  };

  return (
    <>
      <div className="ai-backdrop" onClick={onClose} />
      <div className="ai-panel">
        <header className="ai-head">
          <span className="ai-title">copiloto · describe tu beat</span>
          <button className="ai-x" onClick={onClose} title="cerrar">×</button>
        </header>

        <textarea
          className="ai-input"
          value={prompt}
          placeholder="p.ej.: reggaeton old school a 92bpm con dembow, 808 y un lead menor…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate(); }}
          rows={3}
        />

        <div className="ai-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="ai-chip" onClick={() => setPrompt(ex)} title="usar este ejemplo">{ex.split(':')[0]}</button>
          ))}
        </div>

        <div className="ai-actions">
          <button className="ai-go" onClick={() => void generate()} disabled={status === 'loading' || !prompt.trim()}>
            {status === 'loading' ? 'generando…' : 'generar y sonar'}
          </button>
          <span className="ai-note">reemplaza tu lienzo · Ctrl+Z lo deshace</span>
        </div>

        {status === 'error' && <div className="ai-err">⚠ {error}</div>}
        {status === 'done' && (
          <div className="ai-ok">
            ✓ grafo cargado — editable nodo a nodo
            {warnings.length > 0 && (
              <ul className="ai-warn">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
