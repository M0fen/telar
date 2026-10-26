import { useEffect, useState } from 'react';
import { watchSum, getSumLive, getSumMax, resetSumPeak } from '../audio/levelMeter';
import { headroomFactor, headroomState, dbToMeter, fmtDb, HEADROOM_TARGET_DB } from '../lib/levels';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../store/useNotifyStore';

// MARGEN (Fase 6.2): cómo llega la SUMA de las pistas al máster (antes del bus). Si su pico pasa de
// 0 dBFS, la saturación, el compresor y el limitador del máster trabajan de más. «Dejar margen» baja
// TODAS las pistas a la vez (mismo balance, escenas incluidas) para que el pico quede en −6 dBFS.
const TARGET = `${String(HEADROOM_TARGET_DB).replace('-', '−')} dBFS`;
const MSG = {
  none: 'dale ▶ y mide la parte más fuerte del tema',
  ok: 'con margen: el máster recibe la mezcla con aire',
  justo: 'poco margen: el máster recibe la mezcla muy arriba',
  over: 'pasa de 0 dBFS antes del máster: el máster la aplasta',
} as const;

export function HeadroomMeter() {
  const [live, setLive] = useState(-Infinity);
  const [max, setMax] = useState(-Infinity);
  const playing = useGraphStore((s) => s.playing);
  useEffect(() => {
    const off = watchSum();
    const t = window.setInterval(() => { setLive(getSumLive()); setMax(getSumMax()); }, 150);
    return () => { clearInterval(t); off(); };
  }, []);
  // cada ▶ mide desde cero
  useEffect(() => { if (playing) { resetSumPeak(); setMax(-Infinity); } }, [playing]);
  const st = headroomState(max);
  const k = headroomFactor(max);
  const cutDb = 20 * Math.log10(k);
  const fix = () => {
    const n = useGraphStore.getState().scaleSourceGains(k);
    if (!n) return;
    resetSumPeak(700); // lo que ya estaba programado aún suena con el gain de antes
    setMax(-Infinity);
    toast.ok(`Bajé ${n === 1 ? 'la pista' : `las ${n} pistas`} ${fmtDb(cutDb)} dB a la vez (mismo balance, escenas incluidas). Ctrl+Z lo deshace.`);
  };
  return (
    <div className={`perf-hr ${st}`}>
      <div className="perf-hr-head">
        <span className="perf-bus-tag" title="la suma de todas las pistas justo antes de entrar al máster">suma → máster</span>
        <span className="perf-hr-pk" title="pico de la suma desde ▶ (dBFS)">pico <b>{fmtDb(max)}</b></span>
        <button className="perf-lufs-reset" title="medir desde ahora" onClick={() => { resetSumPeak(); setMax(-Infinity); }}>⟳</button>
      </div>
      <div className="perf-hr-bar" title={`pico de la suma: ahora (barra) y el máximo desde ▶ (raya). Ideal: hasta ${TARGET}`}>
        <div className="perf-hr-fill" style={{ width: `${dbToMeter(live) * 100}%` }} />
        {Number.isFinite(max) && <div className="perf-hr-max" style={{ left: `${dbToMeter(max) * 100}%` }} />}
      </div>
      <div className="perf-hr-msg">
        <span>{MSG[st]}</span>
        {k < 1 && (
          <button className="perf-hr-fix" onClick={fix} title={`baja todas las pistas ${fmtDb(cutDb)} dB a la vez (mismo balance; también el gain que guardan las escenas) para que la suma llegue al máster a ${TARGET} de pico`}>
            dejar margen ({fmtDb(cutDb)} dB)
          </button>
        )}
      </div>
    </div>
  );
}
