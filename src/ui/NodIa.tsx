import { useEffect, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { AiHelp } from './AiHelp';

// Nod-IA como BOTÓN FLOTANTE minimalista (abajo-derecha, sobre la pantalla del viz).
// Acompaña sin estorbar: un toque abre el panel; se cierra con la ×, el fondo o Esc.
// Si hay un error en el proyecto, el botón lo señala con un punto (pulso suave).
export function NodIa() {
  const [open, setOpen] = useState(false);
  const hasError = useGraphStore((s) => !!s.compileError || !!s.runtimeError);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          className={`nodia-fab${hasError ? ' err' : ''}`}
          onClick={() => setOpen(true)}
          title={hasError ? 'Nod-IA · hay algo que resolver' : 'Nod-IA · ayuda y reparación'}
          aria-label="Abrir Nod-IA"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {/* burbuja + chispa (nodo·IA) */}
            <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5z" />
            <path d="M12 8.4l.9 2.2 2.2.9-2.2.9L12 14.6l-.9-2.2-2.2-.9 2.2-.9z" fill="currentColor" stroke="none" />
          </svg>
          <span className="nodia-fab-label">Nod-IA</span>
          {hasError && <span className="nodia-fab-dot" />}
        </button>
      )}
      <AiHelp open={open} onClose={() => setOpen(false)} />
    </>
  );
}
