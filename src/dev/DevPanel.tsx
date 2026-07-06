import { useEffect, useRef, useState } from 'react';
import { useVizFlagsStore, VIZ_FLAG_LABELS, type VizFlagKey } from '../store/useVizFlagsStore';

// Panel de DEV: feature-flags de los visuales + HUD de FPS para medir el costo de cada
// feature EN AISLAMIENTO. Se monta SOLO con import.meta.env.DEV (nunca en producción).
// Atajo: Alt+Shift+D. También un botón pequeño y discreto abajo-izquierda.

// HUD de FPS: un rAF propio (solo mientras el panel está ABIERTO) que promedia el
// frame-time y hace setState ~cada 500 ms (no por frame → el HUD no baja los FPS que mide).
function useFps(active: boolean): { fps: number; ms: number } {
  const [stat, setStat] = useState({ fps: 0, ms: 0 });
  const ref = useRef({ last: 0, acc: 0, frames: 0, since: 0 });
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const s = ref.current;
    s.last = performance.now(); s.acc = 0; s.frames = 0; s.since = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = now - s.last; s.last = now;
      s.acc += dt; s.frames++; s.since += dt;
      if (s.since >= 500) {
        const ms = s.acc / s.frames;
        setStat({ fps: Math.round(1000 / ms), ms: Math.round(ms * 10) / 10 });
        s.acc = 0; s.frames = 0; s.since = 0;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return stat;
}

export function DevPanel() {
  const [open, setOpen] = useState(false);
  const flags = useVizFlagsStore((s) => s.flags);
  const toggle = useVizFlagsStore((s) => s.toggle);
  const { fps, ms } = useFps(open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const keys = Object.keys(flags) as VizFlagKey[];
  const fpsClass = fps === 0 ? '' : fps >= 55 ? ' ok' : fps >= 30 ? ' warn' : ' bad';
  return (
    <>
      <button className="devpanel-toggle" onClick={() => setOpen((o) => !o)} title="dev: flags visuales + FPS (Alt+Shift+D)">
        {open ? 'fps ×' : 'fps'}
      </button>
      {open && (
        <div className="devpanel">
          <div className="devpanel-head">
            <span className={`devpanel-fps${fpsClass}`}>{fps || '—'}<i>fps</i></span>
            <span className="devpanel-ms">{ms || '—'}<i>ms</i></span>
            <span className="devpanel-tag">dev · visuales</span>
          </div>
          <div className="devpanel-flags">
            {keys.map((k) => (
              <label key={k} className={flags[k] ? 'on' : ''}>
                <input type="checkbox" checked={flags[k]} onChange={() => toggle(k)} />
                <span>{VIZ_FLAG_LABELS[k]}</span>
              </label>
            ))}
          </div>
          <p className="devpanel-hint">apaga una feature y mira el FPS: su costo (rAF/escrituras/analysers) desaparece de verdad.</p>
        </div>
      )}
    </>
  );
}
