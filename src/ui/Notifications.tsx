import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNotifyStore } from '../store/useNotifyStore';

// Toasts (avisos que aparecen y se van) y el diálogo modal (confirmar / escribir), con
// la estética terminal de Telar. Reemplazan alert/confirm/prompt del browser y muestran
// los errores del sistema. Se montan una vez en App (via createPortal a document.body).

const ICON: Record<string, string> = { info: 'ℹ', ok: '✓', warn: '⚠', error: '✕' };

export function Toaster() {
  const toasts = useNotifyStore((s) => s.toasts);
  const dismiss = useNotifyStore((s) => s.dismiss);
  if (!toasts.length) return null;
  return createPortal(
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} title="descartar">
          <span className="toast-ico">{ICON[t.kind]}</span>
          <span className="toast-msg">{t.msg}</span>
          <span className="toast-x">×</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function DialogHost() {
  const dialog = useNotifyStore((s) => s.dialog);
  const resolveDialog = useNotifyStore((s) => s.resolveDialog);
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dialog) { setVal(dialog.defaultValue ?? ''); setTimeout(() => inputRef.current?.select(), 30); }
  }, [dialog]);
  // Escape = cancelar · Enter = aceptar, a nivel global (cubre el confirm sin input, que
  // no tiene un campo donde capturar teclas).
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); useNotifyStore.getState().resolveDialog(null); }
      else if (e.key === 'Enter' && !dialog.input) { e.preventDefault(); useNotifyStore.getState().resolveDialog(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);
  if (!dialog) return null;
  const ok = () => resolveDialog(dialog.input ? val : '');
  const cancel = () => resolveDialog(null);
  return createPortal(
    <div className="dlg-backdrop" onClick={cancel} onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3 className="dlg-title">{dialog.title}</h3>
        {dialog.message && <p className="dlg-msg">{dialog.message}</p>}
        {dialog.input && (
          <input
            ref={inputRef}
            className="dlg-input"
            value={val}
            placeholder={dialog.placeholder}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); }}
            autoFocus
          />
        )}
        <div className="dlg-actions">
          <button className="dlg-btn" onClick={cancel}>{dialog.cancelLabel ?? 'cancelar'}</button>
          <button className={`dlg-btn ${dialog.danger ? 'dlg-danger' : 'dlg-primary'}`} onClick={ok}>{dialog.confirmLabel ?? 'aceptar'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
