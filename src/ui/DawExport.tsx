import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { useExportStore, exportWav, cancelExport, stamp, EXPORT_TAIL_S } from '../lib/songExport';

// EXPORTAR desde el DAW (Fase 3.3): la canción entera o la región marcada a WAV (32-bit
// float, lo que suena tras el máster). En tiempo real: dura lo que dura la canción.
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function DawExport({ total, fromSong, extra }: { total: number; fromSong: boolean; extra?: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const busy = useExportStore((s) => s.busy);
  const frac = useExportStore((s) => s.frac);
  const label = useExportStore((s) => s.label);
  const region = useSongStore((s) => s.region);
  const cps = useGraphStore((s) => s.cps) || 0.5;
  const dur = (bars: number) => mmss(bars / cps + EXPORT_TAIL_S);

  if (busy) {
    return (
      <span className="daw-export busy" role="status" aria-live="polite">
        <span className="daw-export-lbl">{label}… {Math.round(frac * 100)}%</span>
        <span className="daw-export-bar"><span style={{ width: `${Math.round(frac * 100)}%` }} /></span>
        <button className="daw-btn" onClick={cancelExport} title="cancelar la exportación (no se descarga nada)">■ cancelar</button>
      </span>
    );
  }
  return (
    <span className="daw-create">
      <button className={`daw-btn${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="exportar a WAV (en tiempo real, lo que suena tras el máster)">⤓ exportar ▾</button>
      {open && (
        <span className="daw-menu" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); void exportWav(0, total, `telar-${fromSong ? 'cancion' : 'bucle'}-${stamp()}.wav`); }}>
            {fromSong ? 'canción completa' : `bucle de ${total} compases`} · {total} c. · {dur(total)}
          </button>
          {region && (
            <button role="menuitem" onClick={() => { setOpen(false); void exportWav(region.start, region.bars, `telar-region-${region.start + 1}-${region.start + region.bars}-${stamp()}.wav`); }}>
              región {region.start + 1}–{region.start + region.bars} · {region.bars} c. · {dur(region.bars)}
            </button>
          )}
          {extra?.(() => setOpen(false))}
        </span>
      )}
    </span>
  );
}
