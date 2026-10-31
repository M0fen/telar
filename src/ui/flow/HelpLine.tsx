import { useEffect, useRef, useState } from 'react';

// AYUDA CONTEXTUAL (Fase 12.2): una línea abajo que dice qué es lo que hay bajo el ratón (lee la
// ayuda que ya traen los controles: su title, aria-label o data-help). «?» abre la hoja de atajos;
// «ayuda» la apaga (se recuerda en este navegador).
const KEY = 'telar.helpline';
const readOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

function helpOf(el: Element | null): string {
  for (let e = el, d = 0; e && d < 8; e = e.parentElement, d++) {
    const h = (e as HTMLElement).dataset?.help || e.getAttribute('title') || (e.tagName === 'BUTTON' || e.getAttribute('role') ? e.getAttribute('aria-label') : null);
    if (h && h.trim()) return h.replace(/\s+/g, ' ').trim();
  }
  return '';
}

export function HelpLine({ onSheet }: { onSheet: () => void }) {
  const [on, setOn] = useState(readOn);
  const [text, setText] = useState('');
  const raf = useRef(0);
  useEffect(() => {
    if (!on) return;
    let pending: Element | null = null;
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pending = e.target as Element;
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => { raf.current = 0; setText(helpOf(pending)); });
    };
    document.addEventListener('pointerover', over, true);
    return () => document.removeEventListener('pointerover', over, true);
  }, [on]);
  const toggle = () => { const v = !on; setOn(v); setText(''); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* */ } };
  return (
    <div className={`helpline${on ? '' : ' off'}`} role="status" aria-live="off">
      {on && <span className="helpline-t">{text || 'pasa el ratón sobre cualquier control para saber qué hace · Ctrl+K: buscar una acción · ?: atajos'}</span>}
      <button className="helpline-b" onClick={onSheet} title="atajos de teclado (?)">?</button>
      <button className="helpline-b" onClick={toggle} title={on ? 'apagar la ayuda contextual' : 'encender la ayuda contextual'}>{on ? 'ayuda ✓' : 'ayuda'}</button>
    </div>
  );
}
