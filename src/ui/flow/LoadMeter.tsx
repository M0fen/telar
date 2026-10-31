import { useEffect, useRef, useState } from 'react';
import { readLoad, startLoadMonitor } from '../../audio/loadMonitor';
import { useGraphStore } from '../../store/useGraphStore';
import { toast } from '../../store/useNotifyStore';

// MEDIDOR DE CARGA (Fase 12.4): una barrita en la barra de arriba (verde · ámbar · rojo) con lo que
// tarda el hilo principal y, si el navegador lo dice, la carga del audio. Avisa (una vez cada tanto)
// antes de que el audio se corte.
export function LoadMeter() {
  const [r, setR] = useState(() => readLoad());
  const warned = useRef(0);
  useEffect(() => {
    startLoadMonitor();
    const t = window.setInterval(() => {
      const x = readLoad();
      setR(x);
      if (x.risky && useGraphStore.getState().playing && performance.now() - warned.current > 60_000) {
        warned.current = performance.now();
        toast.warn(`El audio va justo (el navegador se trabó ${x.lagMs} ms). Cierra pestañas pesadas, pliega el visualizador o congela pistas con muchos efectos.`);
      }
    }, 400);
    return () => window.clearInterval(t);
  }, []);
  const pct = Math.round(r.load * 100);
  const lvl = r.load > 0.75 ? 'hot' : r.load > 0.45 ? 'warm' : '';
  return (
    <div className={`loadm ${lvl}`} title={`carga: ${pct}% · el hilo principal se trabó hasta ${r.lagMs} ms (el audio se agenda 100 ms antes)${r.audio != null ? ` · hilo de audio ${Math.round(r.audio * 100)}%` : ''}${r.underruns ? ` · ${r.underruns} cortes` : ''}`}>
      <span className="loadm-l">cpu</span>
      <span className="loadm-bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></span>
    </div>
  );
}
