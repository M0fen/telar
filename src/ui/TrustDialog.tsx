// Aviso de proyecto ajeno con código que Telar no pudo verificar. Nada de ese código se ha
// ejecutado: la compuerta lo frena hasta que el usuario elige.
import { useEffect } from 'react';
import { useTrustStore } from '../store/useTrustStore';
import { acceptExternalProject, dismissForeignCode, rejectExternalProject } from '../lib/externalProject';

export function TrustDialog() {
  const origin = useTrustStore((s) => s.origin);
  const problems = useTrustStore((s) => s.problems);
  const phase = useTrustStore((s) => s.phase);
  const open = !!problems;
  const back = phase === 'open' ? rejectExternalProject : dismissForeignCode;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); back(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, back]);

  if (!open) return null;
  return (
    <>
      <div className="ai-backdrop" />
      <div className="ai-panel trust" role="alertdialog" aria-modal="true" aria-labelledby="trust-title" aria-describedby="trust-desc">
        <header className="ai-head">
          <span className="ai-title" id="trust-title">proyecto ajeno · código sin verificar</span>
        </header>
        <div className="trust-body" id="trust-desc">
          {phase === 'open' ? (
            <p>Este proyecto viene de <b>{origin ?? 'fuera'}</b> y trae código que Telar no pudo verificar. No lo ejecuté ni lo hice sonar.</p>
          ) : (
            <p>Este proyecto vino de <b>{origin ?? 'fuera'}</b>. Lo que iba a sonar ahora trae código que Telar no pudo verificar, así que no lo ejecuté: sigue sonando lo de antes.</p>
          )}
          <p>El código de un proyecto ajeno puede leer o borrar lo que guardas en Telar. Ejecútalo solo si es tuyo o confías en quien te lo envió.</p>
          <ul className="trust-list">
            {problems!.slice(0, 4).map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
        <footer className="trust-foot">
          <button className="trust-safe" autoFocus onClick={back}>{phase === 'open' ? 'volver a mi proyecto' : 'no ejecutarlo'}</button>
          <button className="trust-risk" onClick={acceptExternalProject}>{phase === 'open' ? 'abrir igual · confío' : 'confío en este proyecto'}</button>
        </footer>
      </div>
    </>
  );
}
