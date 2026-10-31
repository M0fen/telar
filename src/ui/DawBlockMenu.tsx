import { useDetailStore } from '../store/useDetailStore';
import { useEffect, useRef, useState } from 'react';
import type { DawBlock, DawTrack } from '../lib/dawModel';
import { dawBlock, dawClip, dawClipboard, blockVariation } from '../lib/dawActions';
import { VARIATION_EVERY, type FillKind } from '../lib/variation';

// MENÚ DEL BLOQUE (Modo DAW, Fase 2.3): clic derecho o mantener pulsado sobre un bloque.
// Encender/apagar · copiar · pegar · vaciar · duplicar en la sección siguiente · editar en la
// vista estándar (abre el nodo en esa sección). Se cierra con Esc o clic fuera.
export function DawBlockMenu({
  x, y, track, block, canToggle, onToggle, onClose, total, bar,
}: {
  x: number;
  y: number;
  track: DawTrack;
  block: DawBlock;
  canToggle: boolean;
  onToggle: () => void;
  onClose: () => void;
  total: number; // compases de la línea de tiempo (clips libres, 10.1)
  bar?: number; // compás donde se abrió el menú (partir aquí)
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<FillKind>('copy');
  const vari = block.code ? blockVariation(block.code) : null;
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
  const top = Math.min(y, window.innerHeight - 300);

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
      {/* CLIPS LIBRES (10.2) */}
      {!plain && block.state !== 'empty' && !block.ghost && (
        <>
          <button role="menuitem" disabled={bar == null || bar <= block.start || bar >= block.start + block.bars} onClick={run(() => dawClip.split(track.id, bar!, total))}
            title="dos clips que suenan igual que antes (luego mueves o editas cada uno)">partir en el compás {bar != null ? bar + 1 : ''} <kbd>Ctrl+E</kbd></button>
          <button role="menuitem" onClick={run(() => dawClip.join(track.id, block.start, total))} title="este clip ocupa también el siguiente (con su patrón)">unir con el siguiente <kbd>Ctrl+J</kbd></button>
          <button role="menuitem" disabled={block.start + block.bars >= total} onClick={run(() => dawClip.duplicate(track.id, block.start, total))} title="una copia justo detrás">duplicar detrás <kbd>Ctrl+D</kbd></button>
        </>
      )}
      <button role="menuitem" onClick={run(() => useDetailStore.getState().open(track.id, block.arm))}>editar abajo, en grande <kbd>doble clic · E</kbd></button>
      <button role="menuitem" onClick={run(() => dawBlock.edit(track.id, block.arm))}>abrir en la vista estándar</button>
      {/* VARIACIÓN cada N compases (7.3): el último de cada N toca un fill */}
      {block.code && block.state !== 'empty' && (
        <div className="daw-ctx-var" role="group" aria-label="variación cada N compases">
          <span title="el ÚLTIMO compás de cada N toca otro patrón (el fill): una copia para editar, un corte o un roll">variación cada</span>
          {VARIATION_EVERY.map((n) => (
            <button key={n} className={vari?.every === n ? 'on' : ''} onClick={run(() => dawBlock.variation(track.id, block.arm, n, kind, vari?.half ?? false))} title={`el último compás de cada ${n} toca el fill`}>{n}</button>
          ))}
          {vari && <button onClick={run(() => dawBlock.variation(track.id, block.arm, 0))} title="quitar la variación (queda el patrón)">×</button>}
        </div>
      )}
      {block.code && block.state !== 'empty' && !vari && (
        <div className="daw-ctx-var" role="group" aria-label="fill de la variación">
          <span>fill</span>
          {(['copy', 'cut', 'roll'] as FillKind[]).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} title={k === 'copy' ? 'una copia del patrón para editarla en el secuenciador (pestaña «variación»)' : k === 'cut' ? 'corte: la pista calla en ese compás' : 'roll: cada golpe ×2'}>
              {k === 'copy' ? 'copia' : k === 'cut' ? 'corte' : 'roll'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
