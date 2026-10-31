import { useSyncExternalStore } from 'react';
import { soundMap } from '@strudel/web';

// VERSIÓN DE LOS SONIDOS REGISTRADOS: sube (agrupada, 300 ms) cada vez que superdough registra
// sonidos — el banco que termina de cargar, un pack, un loop al tempo con su copia nueva. Quien
// dibuja ondas por nombre la usa para volver a pedir las que aún no existían o cambiaron de audio.

let ver = 0;
let timer = 0;
let hooked = false;
const subs = new Set<() => void>();

function hook(): void {
  if (hooked) return;
  hooked = true;
  try {
    (soundMap as unknown as { listen?: (fn: () => void) => () => void }).listen?.(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { ver++; for (const f of subs) f(); }, 300);
    });
  } catch { /* sin aviso: las ondas se piden al cambiar el código */ }
}

const subscribe = (f: () => void) => { hook(); subs.add(f); return () => { subs.delete(f); }; };
const snap = () => ver;

export function useSoundsVersion(): number {
  return useSyncExternalStore(subscribe, snap, snap);
}
