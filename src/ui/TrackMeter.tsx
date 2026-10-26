import { useEffect, useRef } from 'react';
import { registerTrackMeter } from '../audio/levelMeter';

// MEDIDOR DE PISTA en dBFS (Fase 6.2): barra = RMS, raya = pico retenido 1,5 s, en −60…+6 dB con
// las zonas pintadas y 0 dBFS marcado. Mide lo que la pista aporta a la suma (después de su EQ y
// su compresor). `db` añade el pico en número. Lo anima un rAF compartido, sin re-render.
export function TrackMeter({ id, db = false, className }: { id: string; db?: boolean; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const txt = useRef<HTMLSpanElement>(null);
  useEffect(() => registerTrackMeter(id, el.current!, txt.current), [id]);
  return (
    <div ref={el} className={`tmeter${className ? ' ' + className : ''}`} title="nivel de la pista (dBFS): barra = RMS, raya = pico. En rojo, la pista llega a 0 dB: bájala o usa «dejar margen» en el máster">
      <div className="tmeter-bar">
        <div className="tmeter-rms" />
        <div className="tmeter-pk" />
      </div>
      {db && <span ref={txt} className="tmeter-db">−∞</span>}
    </div>
  );
}
