import { useRef, useState } from 'react';
import { useKeepInView } from './useKeepInView';
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { useExportStore, exportWav, exportStems, cancelExport, setExportPrefs, EXPORT_TAIL_S, type ExportRate } from '../lib/songExport';
import { FORMAT_LABEL, type ExportFormat } from '../lib/audioFormats';
import { liveSampleRate } from '../audio/engine';

// EXPORTAR desde el DAW (Fases 3.3 y 3.4): la canción entera o la región marcada a WAV (32-bit
// float, lo que suena tras el máster) y los STEMS por pista en un ZIP (cada pista sola, sin el
// bus del máster, todas del mismo largo desde el compás 1). Se renderiza offline (Fase 4.2):
// más rápido que el tiempo real y sin cortes; si el render offline falla, en tiempo real.
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export interface StemTrack { id: string; name: string; muted?: boolean; silent?: boolean }

export function DawExport({ total, fromSong, tracks }: { total: number; fromSong: boolean; tracks: StemTrack[] }) {
  const [open, setOpen] = useState(false);
  const [stemsOpen, setStemsOpen] = useState(false);
  const [off, setOff] = useState<Record<string, boolean>>({}); // pistas que el usuario (des)marcó
  const isOff = (t: StemTrack) => off[t.id] ?? !!t.silent; // las que serían silencio, desmarcadas
  const [withMix, setWithMix] = useState(true);
  const busy = useExportStore((s) => s.busy);
  const frac = useExportStore((s) => s.frac);
  const label = useExportStore((s) => s.label);
  const region = useSongStore((s) => s.region);
  const format = useExportStore((s) => s.format);
  const rate = useExportStore((s) => s.rate);
  const title = useGraphStore((s) => s.title);
  const setTitle = useGraphStore((s) => s.setTitle);
  // frecuencia del audio en vivo (la del render): 'live' = sin convertir
  const live = liveSampleRate();
  const khz = (r: number) => `${(r / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} kHz`;
  const cps = useGraphStore((s) => s.cps) || 0.5;
  const dur = (bars: number) => mmss(bars / cps + EXPORT_TAIL_S);
  const menuRef = useRef<HTMLSpanElement>(null);
  useKeepInView(menuRef, open && !busy, [stemsOpen, region?.start, region?.bars]);

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
      <button className={`daw-btn${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="exportar a WAV (lo que suena tras el máster, con sus escenas; más rápido que el tiempo real)">⤓ exportar ▾</button>
      {open && (
        <span className="daw-menu" role="menu" ref={menuRef}>
          <span className="daw-exp-opts">
            <label className="daw-exp-title">
              nombre del tema
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="sin nombre" maxLength={60} aria-label="nombre del tema (va en el nombre de los archivos)" />
            </label>
            <span className="daw-exp-row" role="radiogroup" aria-label="formato">
              {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((f) => (
                <button key={f} role="radio" aria-checked={format === f} className={`daw-chip${format === f ? ' on' : ''}`} onClick={() => setExportPrefs({ format: f })} title={f === 'wav24' ? 'el estándar para distribuir (LabelGrid) y para mezclar' : f === 'wav16' ? 'calidad CD (con dither)' : f === 'wav32f' ? 'sin pérdida y sin límite de nivel (para seguir trabajando)' : 'para escuchar en el celular o mandar por WhatsApp'}>
                  {FORMAT_LABEL[f]}
                </button>
              ))}
            </span>
            <span className="daw-exp-row" role="radiogroup" aria-label="frecuencia de muestreo">
              {(['live', 44100, 48000] as ExportRate[]).filter((r) => r === 'live' || r !== live).map((r) => (
                <button key={String(r)} role="radio" aria-checked={rate === r} className={`daw-chip${rate === r ? ' on' : ''}`} onClick={() => setExportPrefs({ rate: r })} title={r === 'live' ? 'la misma de tu audio: sin convertir' : 'convertida con un filtro de alta calidad'}>
                  {r === 'live' ? (live ? `${khz(live)} (sin convertir)` : 'la de tu audio') : khz(r)}
                </button>
              ))}
            </span>
          </span>
          <button role="menuitem" onClick={() => { setOpen(false); void exportWav(0, total, fromSong ? 'master' : 'bucle'); }}>
            {fromSong ? 'canción completa' : `bucle de ${total} compases`} · {total} c. · {dur(total)}
          </button>
          {region && (
            <button role="menuitem" onClick={() => { setOpen(false); void exportWav(region.start, region.bars, `region ${region.start + 1}-${region.start + region.bars}`); }}>
              región {region.start + 1}–{region.start + region.bars} · {region.bars} c. · {dur(region.bars)}
            </button>
          )}
          <button role="menuitem" aria-expanded={stemsOpen} onClick={() => setStemsOpen((o) => !o)}>stems por pista (ZIP) {stemsOpen ? '▴' : '▾'}</button>
          {stemsOpen && (() => {
            const chosen = tracks.filter((t) => !isOff(t));
            const passes = chosen.length + (withMix ? 1 : 0);
            return (
              <span className="daw-stems">
                <span className="daw-stems-list">
                  {tracks.map((t) => (
                    <label key={t.id}>
                      <input type="checkbox" checked={!isOff(t)} onChange={(e) => setOff((o) => ({ ...o, [t.id]: !e.target.checked }))} /> {t.name}
                      {t.muted && <span className="daw-stems-mute">en mute</span>}
                    </label>
                  ))}
                </span>
                <label className="daw-stems-mix"><input type="checkbox" checked={withMix} onChange={(e) => setWithMix(e.target.checked)} /> incluir la mezcla (con máster)</label>
                <span className="daw-stems-note">cada pista sola, sin el máster (EQ, glue, limitador) · siempre WAV 32 float: juntas no se recortan aunque pasen de 0 dB</span>
                <span className="daw-stems-est">{passes} pasada{passes === 1 ? '' : 's'} de {dur(total)} · más rápido que el tiempo real</span>
                <button
                  className="daw-btn on"
                  disabled={!chosen.length}
                  onClick={() => { setOpen(false); setStemsOpen(false); void exportStems(chosen.map((t) => ({ id: t.id, name: t.name })), total, withMix); }}
                  title="cada pista sola (con sus FX y secciones), sin el bus del máster, todas del mismo largo"
                >
                  exportar {chosen.length} stem{chosen.length === 1 ? '' : 's'}
                </button>
              </span>
            );
          })()}
        </span>
      )}
    </span>
  );
}
