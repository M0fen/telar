import { useLayoutEffect, type RefObject } from 'react';

// Un desplegable absoluto que se sale de la ventana (en el teléfono el botón queda a la
// derecha) se corre a la izquierda lo justo para verse entero, sin pasar del margen izquierdo,
// y nunca es más ancho que la ventana. `deps`: lo que cambia su tamaño estando abierto.
const M = 8;
export function useKeepInView(ref: RefObject<HTMLElement | null>, open: boolean, deps: unknown[] = []): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const fit = () => {
      el.style.transform = '';
      const vw = document.documentElement.clientWidth || window.innerWidth;
      el.style.maxWidth = `${Math.max(160, vw - 2 * M)}px`;
      const r = el.getBoundingClientRect();
      let dx = 0;
      if (r.right > vw - M) dx = vw - M - r.right;
      if (r.left + dx < M) dx = M - r.left;
      if (Math.abs(dx) >= 1) el.style.transform = `translateX(${Math.round(dx)}px)`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
}
