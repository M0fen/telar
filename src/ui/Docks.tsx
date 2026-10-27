import { useRef } from 'react';
import { useDockStore, type RightTab, type DockView } from '../store/useDockStore';
import { useGraphStore } from '../store/useGraphStore';

const useView = (): DockView => (useGraphStore((s) => s.mode) === 'daw' ? 'daw' : 'std');
import { ErrorBoundary } from './ErrorBoundary';
import { Palette } from './Palette';
import { MidiLive } from './MidiLive';
import { Performance } from './Performance';

// PANELES ACOPLADOS (Fase 8.6): ya no flotan encima del lienzo. A la izquierda la BIBLIOTECA (nodos,
// efectos, sonidos, nube, voz); a la derecha EN VIVO (MIDI y pistas) y el MÁSTER en pestañas. Cada
// uno se pliega a una franja con su nombre y se ensancha arrastrando su borde; el lienzo del grafo y
// la línea de tiempo del DAW ocupan lo que queda (variables --dock-l / --dock-r en .app).

function Splitter({ side }: { side: 'l' | 'r' }) {
  const setWidth = useDockStore((s) => s.setWidth);
  const drag = useRef<{ x0: number; w0: number } | null>(null);
  return (
    <div
      className={`dock-split dock-split-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'l' ? 'ancho de la biblioteca' : 'ancho del panel derecho'}
      title="arrastra para cambiar el ancho · doble clic: ancho por defecto"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const st = useDockStore.getState();
        drag.current = { x0: e.clientX, w0: side === 'l' ? st.l : st.r };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x0;
        setWidth(side, side === 'l' ? d.w0 + dx : d.w0 - dx);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => setWidth(side, side === 'l' ? 236 : 288)}
    />
  );
}

function Rail({ side, label, onOpen }: { side: 'l' | 'r'; label: string; onOpen: () => void }) {
  return (
    <button className={`dock-rail dock-rail-${side}`} onClick={onOpen} title={`abrir ${label}`} aria-label={`abrir ${label}`}>
      <span>{side === 'l' ? '▸' : '◂'}</span>
      <b>{label}</b>
    </button>
  );
}

export function LeftDock() {
  const view = useView();
  const open = useDockStore((s) => s.open[view].l);
  const setOpen = useDockStore((s) => s.setOpen);
  if (!open) return <aside className="dock dock-l closed"><Rail side="l" label="biblioteca" onOpen={() => setOpen(view, 'l', true)} /></aside>;
  return (
    <aside className="dock dock-l" aria-label="biblioteca">
      <div className="dock-head">
        <span className="dock-title">biblioteca</span>
        <button className="dock-fold" onClick={() => setOpen(view, 'l', false)} title="plegar la biblioteca" aria-label="plegar la biblioteca">◂</button>
      </div>
      <div className="dock-body">
        <ErrorBoundary variant="panel" label="paleta"><Palette /></ErrorBoundary>
      </div>
      <Splitter side="l" />
    </aside>
  );
}

const TABS: { id: RightTab; label: string; title: string }[] = [
  { id: 'live', label: 'en vivo', title: 'MIDI, perillas de efectos, pads y pistas para tocar' },
  { id: 'master', label: 'máster', title: 'nivel, limitador, EQ, LUFS y retornos del máster' },
];

export function RightDock() {
  const view = useView();
  const open = useDockStore((s) => s.open[view].r);
  const tab = useDockStore((s) => s.rTab);
  const setOpen = useDockStore((s) => s.setOpen);
  const setRTab = useDockStore((s) => s.setRTab);
  if (!open) {
    return (
      <aside className="dock dock-r closed">
        <Rail side="r" label={TABS.find((t) => t.id === tab)?.label ?? 'en vivo'} onOpen={() => setOpen(view, 'r', true)} />
      </aside>
    );
  }
  return (
    <aside className="dock dock-r" aria-label="en vivo y máster">
      <Splitter side="r" />
      <div className="dock-head">
        <div className="dock-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setRTab(view, t.id)} title={t.title}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="dock-fold" onClick={() => setOpen(view, 'r', false)} title="plegar el panel" aria-label="plegar el panel">▸</button>
      </div>
      <div className="dock-body">
        {tab === 'live'
          ? <ErrorBoundary variant="panel" label="MIDI en vivo"><MidiLive docked /></ErrorBoundary>
          : <ErrorBoundary variant="panel" label="máster"><Performance /></ErrorBoundary>}
      </div>
    </aside>
  );
}
