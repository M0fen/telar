import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store/useGraphStore';
import { useDawUiStore } from '../store/useDawUiStore';
import { TrackMeter, GroupMeter } from './TrackMeter';
import { Knob } from './Knob';
import { dbToGain, fmtDbShort, fmtPan, folderOf, folderToggle, FOLDER_LABEL, FOLDERS, gainToDb, isTall, LANE_H, laneH, type FolderId } from '../lib/dawFolders';
import type { DawTrack } from '../lib/dawModel';

// CABECERAS DE PISTA DEL DAW (Fase 9.6): nombre y M/S/A arriba; con la fila alta, volumen en dB,
// paneo y un medidor vertical con pico. El borde de abajo se arrastra para cambiar el alto (doble
// clic: compacta ↔ con volumen). Clic derecho: mover la pista a otra carpeta.

// cambiar el alto de una fila (vista: deshacer lo agrupa como cualquier arrastre)
export function useLaneResize(): (id: string, h: number) => void {
  return (id, h) => useGraphStore.getState().updateNodeData(id, { laneH: laneH(h) });
}

function FolderMenu({ id, x, y, onClose }: { id: string; x: number; y: number; onClose: () => void }) {
  const data = useGraphStore((s) => s.nodes.find((n) => n.id === id)?.data);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  if (!data) return null;
  const auto = folderOf({ name: data.name, code: data.code });
  const cur = data.folder;
  const pick = (f: FolderId | undefined) => { useGraphStore.getState().updateNodeData(id, { folder: f }); onClose(); };
  // en el <body>: dentro de la cabecera (sticky, con su capa) la tapaban las filas de abajo
  return createPortal(
    <div ref={ref} className="daw-menu daw-fmenu" role="menu" style={{ left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 260) }}>
      <span className="daw-fmenu-h">carpeta de «{data.name ?? 'pista'}»</span>
      <button role="menuitemradio" aria-checked={cur == null} onClick={() => pick(undefined)}>{cur == null ? '● ' : ''}automática ({FOLDER_LABEL[auto]})</button>
      {FOLDERS.map((f) => (
        <button key={f} role="menuitemradio" aria-checked={cur === f} onClick={() => pick(f)}>{cur === f ? '● ' : ''}{FOLDER_LABEL[f]}</button>
      ))}
    </div>,
    document.body,
  );
}

export function DawTrackHead({ t, h, onResize, children }: { t: DawTrack; h: number; onResize: (id: string, h: number) => void; children: ReactNode }) {
  const data = useGraphStore((s) => s.nodes.find((n) => n.id === t.id)?.data);
  const update = useGraphStore((s) => s.updateNodeData);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ y0: number; h0: number } | null>(null);
  const tall = isTall(h);
  const gain = Number(data?.gain ?? 1);
  const pan = typeof data?.chPan === 'number' ? data.chPan : 0.5;
  const db = gainToDb(Number.isFinite(gain) ? gain : 1);
  return (
    <div className={`daw-tname daw-th${tall ? ' tall' : ''}`} onContextMenu={(e) => { if ((e.target as HTMLElement).closest('input,button,select')) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <div className="daw-th-top">{children}</div>
      {tall && (
        <div className="daw-th-mix">
          <input
            className="daw-vol"
            type="range"
            min={-60}
            max={6}
            step={0.1}
            value={db}
            style={{ ['--v' as string]: String((db + 60) / 66) } as CSSProperties}
            onChange={(e) => update(t.id, { gain: Math.round(dbToGain(Number(e.target.value)) * 10000) / 10000 })}
            onDoubleClick={() => update(t.id, { gain: 1 })}
            aria-label={`volumen de ${t.name} en dB`}
            title={`volumen: ${fmtDbShort(db)} dB · doble clic = 0 dB`}
          />
          <span className="daw-voldb">{fmtDbShort(db)}</span>
          <span className="daw-pan" title={`paneo: ${fmtPan(pan)} · doble clic = centro`}>
            <Knob value={pan} min={0} max={1} step={0.01} size={18} defaultValue={0.5} label={`paneo de ${t.name}`} hideValue onChange={(v) => update(t.id, { chPan: Math.round(v * 100) / 100 })} />
            <span>{fmtPan(pan)}</span>
          </span>
        </div>
      )}
      {tall ? <TrackMeter id={t.id} className="tmeter-vert" /> : <TrackMeter id={t.id} className="tmeter-daw" />}
      <div
        className="daw-tresize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={`alto de la fila de ${t.name}`}
        title="arrastra para cambiar el alto de la fila · doble clic: compacta ↔ con volumen y paneo"
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y0: e.clientY, h0: h }; }}
        onPointerMove={(e) => { if (drag.current) onResize(t.id, drag.current.h0 + e.clientY - drag.current.y0); }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => onResize(t.id, h >= LANE_H.mid ? LANE_H.compact : LANE_H.mid)}
      />
      {menu && <FolderMenu id={t.id} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

// fila de CARPETA: plegar, M y S de todas sus pistas, medidor del grupo y, en su carril, una raya
// por pista donde suena
export function DawFolderRow({ folder, tracks, colors, width, px, gridBg }: {
  folder: { id: FolderId; label: string; ids: string[]; open: boolean };
  tracks: DawTrack[];
  colors: Record<string, string>;
  width: number;
  px: number;
  gridBg: CSSProperties;
}) {
  const toggle = useDawUiStore((s) => s.toggleFolder);
  const members = tracks.filter((t) => folder.ids.includes(t.id));
  const allMute = members.length > 0 && members.every((t) => t.mute);
  const allSolo = members.length > 0 && members.every((t) => t.solo);
  const setAll = (key: 'mute' | 'solo') => {
    const v = folderToggle(folder.ids, (id) => !!members.find((t) => t.id === id)?.[key]);
    useGraphStore.getState().applyArrangement({}, undefined, Object.fromEntries(folder.ids.map((id) => [id, { [key]: v }])));
  };
  const stripe = Math.max(2, Math.min(4, Math.floor(18 / Math.max(1, members.length))));
  return (
    <div className={`daw-row daw-frow${folder.open ? '' : ' closed'}`}>
      <div className="daw-tname daw-fname">
        <button className="daw-fchev" onClick={() => toggle(folder.id)} aria-expanded={folder.open} title={folder.open ? 'plegar la carpeta' : 'abrir la carpeta'}>{folder.open ? '▾' : '▸'}</button>
        <span className="daw-tn" title={`carpeta ${folder.label}: ${members.map((t) => t.name).join(', ')}`}>{folder.label}</span>
        <span className="daw-fcount">{folder.ids.length}</span>
        <button className={`daw-ms${allMute ? ' on mute' : ''}`} onClick={() => setAll('mute')} title="mute de toda la carpeta">M</button>
        <button className={`daw-ms${allSolo ? ' on solo' : ''}`} onClick={() => setAll('solo')} title="solo de toda la carpeta">S</button>
        <GroupMeter ids={folder.ids} className="tmeter-daw" />
      </div>
      <div className="daw-lane" style={{ width, ...gridBg }}>
        {members.map((t, k) => t.blocks.filter((b) => b.state === 'on').map((b, i) => (
          <div key={`${t.id}_${i}`} className={`daw-fblk${t.audible ? '' : ' muted'}`} style={{ left: b.start * px, width: Math.max(2, b.bars * px - 2), top: 4 + k * (stripe + 1), height: stripe, background: colors[t.id] }} />
        )))}
      </div>
    </div>
  );
}
