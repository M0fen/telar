// En el teléfono Telar se ve cortada (a 390 px la barra mide más de 1200 px y ▶ queda fuera).
// La primera vez en pantalla chica se avisa, con la opción de seguir igual (se recuerda).
import { useState } from 'react';

const KEY = 'telar.phone.ok';

export function PhoneGate() {
  const [open, setOpen] = useState(() => {
    try { return window.matchMedia('(max-width: 760px)').matches && localStorage.getItem(KEY) !== '1'; } catch { return false; }
  });
  const [href] = useState(() => location.href); // con el proyecto (#p=…) si vino por un enlace
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const go = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* sin almacenamiento: vuelve a preguntar */ }
    setOpen(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(href); setCopied(true); } catch { /* sin portapapeles */ }
  };
  return (
    <div className="phone-gate" role="dialog" aria-modal="true" aria-labelledby="phone-gate-t">
      <div className="phone-gate-card">
        <h2 id="phone-gate-t">Telar es para computador</h2>
        <p>Hacer música con nodos pide pantalla grande, teclado y ratón: en el teléfono la app se ve cortada.</p>
        <p>Ábrela en un computador con Chrome o Edge. Si te llegó un proyecto por enlace, cópialo y ábrelo allá.</p>
        <div className="phone-gate-actions">
          <button className="phone-gate-primary" onClick={() => void copy()}>{copied ? 'enlace copiado' : 'copiar el enlace'}</button>
          <button className="phone-gate-ghost" onClick={go}>seguir igual</button>
        </div>
      </div>
    </div>
  );
}
