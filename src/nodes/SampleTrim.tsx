import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useDownloadsStore } from '../store/useDownloadsStore';
import { getAudioCtx } from '../audio/engine';
import { naturalLoop } from '../lib/audioMeta';

// Recortador de forma de onda: dibuja el sample referenciado por el código del
// Source y deja arrastrar dos manijas (inicio/fin). Guarda begin/end en el nodo;
// el compilador añade .begin()/.end() → el audio se corta a esa región. Es la
// forma más sencilla de "cortar" el sample sin tocar el código.
export function SampleTrim({
  nodeId,
  code,
  begin,
  end,
}: {
  nodeId: string;
  code: string;
  begin?: number;
  end?: number;
}) {
  const update = useGraphStore((s) => s.updateNodeData);
  const tracks = useDownloadsStore((s) => s.tracks);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [applied, setApplied] = useState(false);

  // nombre del sample dentro de s("…")
  const name = useMemo(() => {
    const m = /s\(\s*["'`]([^"'`]+)/.exec(code || '');
    if (!m) return null;
    const tok = /[A-Za-z0-9_]+/.exec(m[1]);
    return tok ? tok[0] : null;
  }, [code]);
  const track = useMemo(() => tracks.find((t) => t.name === name) ?? null, [tracks, name]);

  // decodifica una vez y reduce a ~160 picos para dibujar
  useEffect(() => {
    let alive = true;
    if (!track) {
      setPeaks(null);
      return;
    }
    setPeaks(null);
    (async () => {
      try {
        const ab = await (await fetch(track.file)).arrayBuffer();
        const buf = await getAudioCtx().decodeAudioData(ab);
        if (alive) setDuration(buf.duration);
        const data = buf.getChannelData(0);
        const N = 160;
        const step = Math.max(1, Math.floor(data.length / N));
        const p: number[] = [];
        for (let i = 0; i < N; i++) {
          let mx = 0;
          for (let j = 0; j < step; j++) {
            const v = Math.abs(data[i * step + j] || 0);
            if (v > mx) mx = v;
          }
          p.push(mx);
        }
        if (alive) setPeaks(p);
      } catch {
        if (alive) setPeaks(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [track]);

  const b = begin ?? 0;
  const e = end ?? 1;

  // "ok": fija el corte → ajusta loopAt/chop a la duración de la región elegida
  // para que ese trozo suene exacto y en bucle (no estirado sobre toda la canción).
  const apply = () => {
    const frac = Math.max(0.02, e - b);
    const cyc = naturalLoop(duration * frac, useGraphStore.getState().cps);
    let next = code;
    next = /\.loopAt\([\d.]+\)/.test(next)
      ? next.replace(/\.loopAt\([\d.]+\)/, `.loopAt(${cyc})`)
      : `${next}.loopAt(${cyc})`;
    next = /\.chop\(\d+\)/.test(next)
      ? next.replace(/\.chop\(\d+\)/, `.chop(${cyc})`)
      : `${next}.chop(${cyc})`;
    update(nodeId, { code: next });
    setApplied(true);
    setTimeout(() => setApplied(false), 1300);
  };

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
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!track) {
    return <div className="tn-trim-none nodrag">graba o descarga un sample para recortarlo</div>;
  }

  return (
    <div className="tn-trim nodrag">
      <div className="tn-trim-box" ref={wrapRef} onMouseDown={(e2) => e2.stopPropagation()}>
        <div className="tn-trim-wave">
          {peaks
            ? peaks.map((p, i) => <span key={i} style={{ height: `${Math.max(4, p * 100)}%` }} />)
            : <span className="tn-trim-load">decodificando…</span>}
        </div>
        <div className="tn-trim-mask" style={{ left: 0, width: `${b * 100}%` }} />
        <div className="tn-trim-mask" style={{ left: `${e * 100}%`, right: 0 }} />
        <div className="tn-trim-handle" style={{ left: `${b * 100}%` }} onPointerDown={dragHandle('b')} />
        <div className="tn-trim-handle" style={{ left: `${e * 100}%` }} onPointerDown={dragHandle('e')} />
      </div>
      <div className="tn-trim-foot">
        <span>{(b * 100).toFixed(0)}%–{(e * 100).toFixed(0)}%</span>
        <div className="tn-trim-actions">
          <button onClick={() => update(nodeId, { begin: 0, end: 1 })} title="restablecer recorte">reset</button>
          <button className="ok" onClick={apply} title="fijar el corte a la región elegida">
            {applied ? '✓ hecho' : 'ok'}
          </button>
        </div>
      </div>
    </div>
  );
}
