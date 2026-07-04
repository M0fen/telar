import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { getAudioCtx } from '../audio/engine';
import { resolveSampleUrl } from '../lib/sampleResolve';

// RECORTE VISUAL universal: dibuja la forma de onda de CUALQUIER sample (built-in,
// importado o descargado, vía resolveSampleUrl) y deja arrastrar dos manijas
// (inicio/fin). Guarda begin/end en el nodo → el compilador añade .begin()/.end().
// Si el sample no se puede resolver/decodificar, cae a una barra lisa (el recorte
// sigue funcionando, solo sin onda). Reutilizable en el estudio de sonido.
export function WaveTrim({ nodeId, name, begin, end }: { nodeId: string; name: string | null; begin?: number; end?: number }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [state, setState] = useState<'load' | 'ok' | 'none'>('load');

  const url = useMemo(() => resolveSampleUrl(name), [name]);

  useEffect(() => {
    let alive = true;
    setPeaks(null);
    if (!url) { setState('none'); return; }
    setState('load');
    (async () => {
      try {
        const ab = await (await fetch(url)).arrayBuffer();
        const buf = await getAudioCtx().decodeAudioData(ab);
        const data = buf.getChannelData(0);
        const N = 200;
        const step = Math.max(1, Math.floor(data.length / N));
        const p: number[] = [];
        for (let i = 0; i < N; i++) {
          let mx = 0;
          for (let j = 0; j < step; j++) { const v = Math.abs(data[i * step + j] || 0); if (v > mx) mx = v; }
          p.push(mx);
        }
        if (alive) { setPeaks(p); setState('ok'); }
      } catch {
        if (alive) setState('none');
      }
    })();
    return () => { alive = false; };
  }, [url]);

  const b = begin ?? 0;
  const e = end ?? 1;

  const dragHandle = (which: 'b' | 'e') => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = wrapRef.current!.getBoundingClientRect();
    const move = (m: PointerEvent) => {
      let f = (m.clientX - rect.left) / rect.width;
      f = Math.max(0, Math.min(1, f));
      if (which === 'b') update(nodeId, { begin: Math.min(f, (end ?? 1) - 0.02) });
      else update(nodeId, { end: Math.max(f, (begin ?? 0) + 0.02) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const trimmed = b > 0.001 || e < 0.999;
  return (
    <div className="ss-trim">
      <div className="ss-trim-box" ref={wrapRef}>
        <div className={`ss-trim-wave${state !== 'ok' ? ' flat' : ''}`}>
          {state === 'ok' && peaks
            ? peaks.map((p, i) => <span key={i} style={{ height: `${Math.max(3, p * 100)}%` }} />)
            : <span className="ss-trim-msg">{state === 'load' ? 'decodificando onda…' : 'sin onda (recorte igual funciona)'}</span>}
        </div>
        <div className="ss-trim-mask" style={{ left: 0, width: `${b * 100}%` }} />
        <div className="ss-trim-mask" style={{ left: `${e * 100}%`, right: 0 }} />
        <div className="ss-trim-handle" style={{ left: `${b * 100}%` }} onPointerDown={dragHandle('b')} title="inicio" />
        <div className="ss-trim-handle" style={{ left: `${e * 100}%` }} onPointerDown={dragHandle('e')} title="fin" />
      </div>
      <div className="ss-trim-foot">
        <span>recorte {(b * 100).toFixed(0)}%–{(e * 100).toFixed(0)}%</span>
        {trimmed && <button onClick={() => update(nodeId, { begin: 0, end: 1 })} title="quitar el recorte">reset</button>}
      </div>
    </div>
  );
}
