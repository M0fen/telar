import { useGraphStore } from '../store/useGraphStore';
import { useDockStore, type DockView } from '../store/useDockStore';

// ABRIR LA BIBLIOTECA desde cualquier parte (Ctrl+K, el tutorial): despliega el panel de la
// izquierda de la vista (plegado no está montado y nadie oía el pedido) y le pide que abra
// «explorar sonidos». La ventana va aparte del panel; sale aunque el panel sea angosto.
export function openLibrary(): void {
  const mode = useGraphStore.getState().mode;
  if (mode !== 'dj') {
    const view: DockView = mode === 'daw' ? 'daw' : 'std';
    const d = useDockStore.getState();
    if (!d.open[view].l) d.setOpen(view, 'l', true);
  }
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('telar:library', { detail: { id: Date.now() } })), 80);
}
