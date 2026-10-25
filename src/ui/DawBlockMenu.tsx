import { useEffect, useRef } from 'react';
import type { DawBlock, DawTrack } from '../lib/dawModel';
import { dawBlock, dawClipboard } from '../lib/dawActions';

// MENÚ DEL BLOQUE (Modo DAW, Fase 2.3): clic derecho o mantener pulsado sobre un bloque.
// Encender/apagar · copiar · pegar · vaciar · duplicar en la sección siguiente · editar en la
// vista estándar (abre el nodo en esa sección). Se cierra con Esc o clic fuera.
export function DawBlockMenu({
  x, y, track, block, canToggle, onToggle, onClose,
}: {
  x: number;
  y: number;
  track: DawTrack;
  block: DawBlock;
  canToggle: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);

  const plain = track.plain;
  const lastArm = Math.max(...track.blocks.map((b) => b.arm));
  const clip = dawClipboard.get();
  const run = (f: () => unknown) => () => { f(); onClose(); };
  const toggleLabel = block.state === 'on' ? 'apagar en esta sección' : block.state === 'off' ? 'encender (vuelve tal cual)' : 'encender (entra con su patrón)';
  // dentro de la ventana
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y, window.innerHeight - 230);

  return (
    <div className="daw-menu daw-ctx" ref={ref} role="menu" style={{ position: 'fixed', left, top }} onContextMenu={(e) => e.preventDefault()}>
      <span className="daw-ctx-h">{track.name}{plain ? ' · sin secciones' : ` · sección ${block.arm + 1}`}</span>
      <button role="menuitem" disabled={!canToggle} onClick={run(onToggle)}>{toggleLabel} <kbd>clic</kbd></button>
      <button role="menuitem" onClick={run(() => dawBlock.copy(track.id, block.arm))}>copiar <kbd>Ctrl+C</kbd></button>
      <button role="menuitem" disabled={!clip || plain} onClick={run(() => dawBlock.paste(track.id, block.arm))} title={clip ? `pega: ${clip.expr.slice(0, 120)}` : 'primero copia un bloque'}>
        pegar{clip ? ` «${clip.from}»` : ''} <kbd>Ctrl+V</kbd>
      </button>
      <button role="menuitem" disabled={plain || block.state === 'empty'} onClick={run(() => dawBlock.clear(track.id, block.arm))}>vaciar (silencio) <kbd>Supr</kbd></button>
      <button role="menuitem" disabled={plain || block.arm >= lastArm} onClick={run(() => dawBlock.toNext(track.id, block.arm))}>copiar en la sección siguiente</button>
      <button role="menuitem" onClick={run(() => dawBlock.edit(track.id, block.arm))}>editar en la vista estándar <kbd>E</kbd></button>
    </div>
  );
}
