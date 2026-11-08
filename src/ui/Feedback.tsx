import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { feedbackMessage, githubIssueUrl, MODE_LABEL, whatsappUrl } from '../lib/feedback';

// «opinar»: unas líneas y se abren en WhatsApp ya escritas (la persona las manda; Telar no envía
// nada). Lleva el modo, la versión y el navegador; nada del proyecto.
export function Feedback({ onClose }: { onClose: () => void }) {
  const mode = useGraphStore((s) => s.mode);
  const [m, setM] = useState<string>(mode);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const msg = () => feedbackMessage({ mode: m, text, name, version: String(import.meta.env.VITE_COMMIT ?? ''), ua: navigator.userAgent });
  const open = (url: string) => { window.open(url, '_blank', 'noopener'); onClose(); };
  const ok = text.trim().length > 3;
  return (
    <div className="dlg-backdrop" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="dlg fb" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="opinar">
        <h3 className="dlg-title">Opinar o contar un error</h3>
        <p className="dlg-msg">Cuéntalo como se lo dirías a alguien: qué estabas haciendo, qué esperabas y qué pasó. Se abre en WhatsApp ya escrito y tú lo mandas.</p>
        <div className="fb-modes" role="radiogroup" aria-label="en qué modo">
          {Object.entries(MODE_LABEL).map(([k, v]) => (
            <button key={k} role="radio" aria-checked={m === k} className={`dlg-btn${m === k ? ' on' : ''}`} onClick={() => setM(k)}>{v}</button>
          ))}
        </div>
        <textarea className="dlg-input fb-text" autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="p. ej.: en el DJ, al darle ▶ al segundo tema se oyó un salto" />
        <input className="dlg-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="tu nombre (opcional)" />
        <div className="dlg-actions">
          <a className="fb-alt" href={ok ? githubIssueUrl(msg()) : undefined} onClick={(e) => { e.preventDefault(); if (ok) open(githubIssueUrl(msg())); }} aria-disabled={!ok}>o en GitHub</a>
          <button className="dlg-btn" onClick={onClose}>cancelar</button>
          <button className="dlg-btn dlg-primary" disabled={!ok} onClick={() => open(whatsappUrl(msg()))}>abrir en WhatsApp</button>
        </div>
      </div>
    </div>
  );
}
