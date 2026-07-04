import { useEffect, useRef, useState } from 'react';
import { getLufs, startLufs, stopLufs, resetLufsIntegrated, type LufsReading } from '../audio/lufsMeter';
import { useGraphStore } from '../store/useGraphStore';

// Objetivos de sonoridad habituales (LUFS integrada). El usuario elige la referencia
// y la barra indica si está por encima/debajo.
const TARGETS: { label: string; value: number; hint: string }[] = [
  { label: 'stream', value: -14, hint: 'Spotify/YouTube −14' },
  { label: 'club', value: -8, hint: 'club/EDM −8' },
  { label: 'master', value: -6, hint: 'loud master −6' },
];

function fmt(v: number): string {
  if (!isFinite(v)) return '−∞';
  return v.toFixed(1);
}

// Medidor de LUFS (M2): momentary / short / integrated + true-peak. Barra relativa
// al objetivo elegido (−14/−8/−6). Se refresca ~8 Hz; el tap es pasivo (no altera
// el audio). El botón ⟳ reinicia la integrada para medir un tramo desde cero.
export function LufsMeter() {
  const [r, setR] = useState<LufsReading>({ momentary: -Infinity, short: -Infinity, integrated: -Infinity, truePeakDb: -Infinity });
  const [target, setTarget] = useState(-14);
  const mastering = useGraphStore((s) => s.mastering);
  const playing = useGraphStore((s) => s.playing);
  const autoMaster = useGraphStore((s) => s.autoMaster);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    startLufs();
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 120) { setR(getLufs()); last = t; }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      stopLufs();
    };
  }, []);

  // posición de la barra: −30 LUFS (izq) .. 0 LUFS (der), con marca del objetivo.
  const toPct = (v: number) => (isFinite(v) ? Math.max(0, Math.min(100, ((v + 30) / 30) * 100)) : 0);
  const momPct = toPct(r.momentary);
  const shortPct = toPct(r.short);
  const targetPct = toPct(target);
  const overTarget = isFinite(r.short) && r.short > target;
  const clip = isFinite(r.truePeakDb) && r.truePeakDb > -1;

  return (
    <div className="perf-lufs">
      <div className="perf-lufs-head">
        <span className="perf-bus-tag">lufs</span>
        <div className="perf-lufs-targets">
          {TARGETS.map((t) => (
            <button key={t.value} className={target === t.value ? 'on' : ''} title={t.hint} onClick={() => setTarget(t.value)}>{t.label}</button>
          ))}
        </div>
        <button
          className={`perf-lufs-auto${mastering ? ' on' : ''}`}
          disabled={!playing || mastering}
          onClick={() => void autoMaster(target)}
          title={playing ? `auto-master: mide la mezcla y la deja a ${target} LUFS (limiter + EQ pulido + ganancia), sin clipear` : 'dale a play primero — mide la mezcla sonando'}
        >{mastering ? 'midiendo…' : '⚡ auto'}</button>
        <button className="perf-lufs-reset" title="reiniciar la medida integrada" onClick={resetLufsIntegrated}>⟳</button>
      </div>
      <div className="perf-lufs-bar" title="sonoridad instantánea (400 ms / 3 s) vs. objetivo">
        <div className="perf-lufs-fill short" style={{ width: `${shortPct}%` }} />
        <div className="perf-lufs-fill mom" style={{ width: `${momPct}%` }} />
        <div className="perf-lufs-target" style={{ left: `${targetPct}%` }} />
      </div>
      <div className="perf-lufs-nums">
        <span title="momentary (400 ms)">M <b>{fmt(r.momentary)}</b></span>
        <span title="short-term (3 s)">S <b>{fmt(r.short)}</b></span>
        <span className={overTarget ? 'over' : ''} title="integrated (con gating BS.1770)">I <b>{fmt(r.integrated)}</b></span>
        <span className={clip ? 'clip' : ''} title="true-peak (dBFS)">pk <b>{isFinite(r.truePeakDb) ? r.truePeakDb.toFixed(1) : '−∞'}</b></span>
      </div>
    </div>
  );
}
