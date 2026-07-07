import { useState } from 'react';

// Botón de FX MOMENTÁNEO: aplica mientras lo mantienes pulsado y se quita al soltar
// (aunque sueltes fuera). Con SHIFT+clic se FIJA (latch): queda activo hasta que sueltes
// Shift, dejando el cursor libre para mover otras cosas a la vez. Lo comparten la fila de
// performance del máster (Performance.tsx) y la de cada source (nodeTypes.tsx).
// `onDown`/`onUp` quedan listos para mapearse a teclado/MIDI más adelante.
export function HoldFx({ label, title, active, onDown, onUp }: {
  label: string; title: string; active: boolean; onDown: () => void; onUp: () => void;
}) {
  const [latched, setLatched] = useState(false);
  const press = (e: React.PointerEvent) => {
    e.preventDefault();
    // FRENA el pointerdown ANTES de que llegue al nodo de React Flow: con Shift, React Flow
    // (multiSelectionKeyCode="Shift") ALTERNA la selección → deselecciona el source → su fila
    // de performance (visible solo con el nodo seleccionado) se DESMONTA justo al fijar (latch),
    // y no deja sostener/ajustar el efecto. El `nodrag`/stopPropagation de mousedown del wrapper
    // no basta: React Flow v12 selecciona por pointer events. Estos botones nunca tocan selección.
    e.stopPropagation();
    onDown();
    if (e.shiftKey) {
      // fijado: permanece hasta soltar Shift (cursor libre)
      setLatched(true);
      const onKeyUp = (ke: KeyboardEvent) => {
        if (ke.key === 'Shift') {
          setLatched(false);
          onUp();
          window.removeEventListener('keyup', onKeyUp);
        }
      };
      window.addEventListener('keyup', onKeyUp);
    } else {
      const up = () => {
        onUp();
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointerup', up);
    }
  };
  return (
    <button
      className={`perf-fx${active ? ' on' : ''}${latched ? ' latched' : ''}`}
      title={`${title} · shift+clic = fijar`}
      onPointerDown={press}
      onMouseDown={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}
