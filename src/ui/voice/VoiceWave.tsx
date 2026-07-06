import { useRef } from 'react';
import { clamp01 } from './voiceUtils';

// Onda grande del estudio de voz: barras de picos + máscaras del recorte + cabezal +
// manijas begin/end arrastrables. Presentacional — el estado (peaks/begin/end/head)
// vive en VoiceStudio; aquí solo se convierten los gestos del puntero a fracciones 0..1.
export function VoiceWave({ audioUrl, decodeErr, peaks, b, e, head, onScrub, onBegin, onEnd }: {
  audioUrl: string | null;
  decodeErr: string | null;
  peaks: number[] | null;
  b: number;
  e: number;
  head: number | null;
  onScrub: (frac: number) => void;
  onBegin: (frac: number) => void;
  onEnd: (frac: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const dragHandle = (which: 'b' | 'e') => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = wrapRef.current!.getBoundingClientRect();
    const move = (m: PointerEvent) => {
      const f = clamp01((m.clientX - rect.left) / rect.width);
      if (which === 'b') onBegin(f);
      else onEnd(f);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // clic sobre la onda (no en una manija) = mover el cabezal (scrub)
  const scrub = (ev: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    onScrub(clamp01((ev.clientX - rect.left) / rect.width));
  };

  return (
    <div className="vs-wave" ref={wrapRef} onPointerDown={scrub}>
      {!audioUrl ? (
        <div className="vs-wave-none">graba una voz (● grabar) o descarga un audio para editarlo aquí</div>
      ) : decodeErr ? (
        <div className="vs-wave-none vs-wave-err">⚠ {decodeErr}. Reintenta grabando o recargando el audio.</div>
      ) : !peaks ? (
        <div className="vs-wave-none">decodificando…</div>
      ) : (
        <>
          <div className="vs-wave-bars">
            {peaks.map((p, i) => {
              const frac = i / peaks.length;
              const inRange = frac >= b && frac <= e;
              return <span key={i} className={inRange ? 'on' : ''} style={{ height: `${Math.max(3, p * 100)}%` }} />;
            })}
          </div>
          <div className="vs-mask" style={{ left: 0, width: `${b * 100}%` }} />
          <div className="vs-mask" style={{ left: `${e * 100}%`, right: 0 }} />
          {head != null && <div className="vs-playhead" style={{ left: `${head * 100}%` }} />}
          <div className="vs-handle" style={{ left: `${b * 100}%` }} onPointerDown={dragHandle('b')} />
          <div className="vs-handle" style={{ left: `${e * 100}%` }} onPointerDown={dragHandle('e')} />
        </>
      )}
    </div>
  );
}
