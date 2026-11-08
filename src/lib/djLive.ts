// Puente liviano con el modo DJ (que se carga aparte): ¿suena algún tema en un deck? Lo llena
// audio/songDeck.ts al arrancar; antes de eso, nada suena. Así la app (Espacio, cambiar de vista)
// no corta un set sin preguntar, sin cargar el código del DJ.
import { useGraphStore } from '../store/useGraphStore';
import { askConfirm, toast } from '../store/useNotifyStore';

export const djLive = { decksPlaying: (): boolean => false };

// cambiar de vista: salir del DJ con temas sonando los para — se pregunta antes
export async function switchMode(m: 'standard' | 'dj' | 'daw'): Promise<void> {
  const g = useGraphStore.getState();
  if (g.mode === m) return;
  if (g.mode === 'dj' && djLive.decksPlaying()) {
    const ok = await askConfirm('Hay temas sonando', { message: 'Salir del DJ para los temas de los decks (los patrones siguen). ¿Salir igual?', confirmLabel: 'salir', cancelLabel: 'seguir en el DJ' });
    if (!ok) return;
  }
  useGraphStore.getState().setMode(m);
}

let spaceTold = false;
// Espacio en el DJ con temas sonando: no corta el set (cada deck tiene su ▶; ■ arriba para todo)
export function djSpaceGuard(): boolean {
  if (useGraphStore.getState().mode !== 'dj' || !djLive.decksPlaying()) return false;
  if (!spaceTold) { spaceTold = true; toast.info('En el DJ, Espacio no corta el set: cada deck tiene su ▶ y ■ (arriba) para todo.'); }
  return true;
}
