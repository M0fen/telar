import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { getScheduler } from '../audio/engine';

// Rejilla de ROLLS / repeticiones por Source (prima hermana de la rejilla de silencios).
// Cada paso se repite N veces (1 = normal, 2/3/4 = redoble/roll) → fills y redobles de
// batería/hats sin tocar código. Emite un sufijo `.ply("1 1 3 1 …")` (autocontenido, no
// choca con gain/mask). Clic sube el nivel (1→2→3→4→1); arrastra para pintar. Cabezal
// sincronizado. Si todo es 1, se quita (código limpio).
export function parsePly(code: string): { base: string; vals: number[] } {
  const m = code.match(/^([\s\S]*?)\.ply\("([\d\s]+)"\)\s*$/);
  if (m) {
    const vals = m[2].trim().split(/\s+/).map((x) => Math.max(1, Math.min(4, parseInt(x, 10) || 1)));
    if (vals.length) return { base: m[1].replace(/\s+$/, ''), vals };
  }
  return { base: code.replace(/\s+$/, ''), vals: [] };
}
function buildPly(base: string, vals: number[]): string {
  if (!vals.length || vals.every((v) => v === 1)) return base;
  return `${base}.ply("${vals.join(' ')}")`;
}

export function PlyStrip({ id, code }: { id: string; code: string }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const { base, vals } = useMemo(() => parsePly(code), [code]);
  const [steps, setSteps] = useState(() => vals.length || 8);
  const [head, setHead] = useState(-1);
  const drawing = useRef<number | null>(null);

  useEffect(() => { if (vals.length) setSteps((s) => Math.max(s, vals.length)); }, [vals.length]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = getScheduler()?.now?.();
      setHead(typeof now === 'number' ? Math.floor((((now % 1) + 1) % 1) * steps) % steps : -1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [steps]);
  useEffect(() => {
    const up = () => { drawing.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const cells = useMemo(() => {
    const arr = vals.slice(0, steps);
    while (arr.length < steps) arr.push(1);
    return arr;
  }, [vals, steps]);

  const commit = (next: number[]) => update(id, { code: buildPly(base, next) });
  const paint = (i: number, v: number) => { const n = cells.slice(); n[i] = v; commit(n); };
  const setStepCount = (n: number) => {
    const clamped = Math.max(2, Math.min(32, n));
    if (cells.some((c) => c > 1)) {
      const arr = cells.slice(0, clamped);
      while (arr.length < clamped) arr.push(1);
      commit(arr);
    }
    setSteps(clamped);
  };
  const clear = () => update(id, { code: base });
  const hasRolls = cells.some((c) => c > 1);

  return (
    <div className="gate ply nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="gate-ctl">
        <span className="gate-tag">rolls</span>
        <div className="gate-steps">
          <button onClick={() => setStepCount(steps - 1)} title="menos pasos">−</button>
          <b>{steps}<i>pasos</i></b>
          <button onClick={() => setStepCount(steps + 1)} title="más pasos">+</button>
        </div>
        <button className="gate-clear" onClick={clear} disabled={!hasRolls} title="quitar todos los rolls">limpiar</button>
      </div>
      <div className="gate-grid ply-grid" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
        {cells.map((c, i) => (
          <button
            key={i}
            className={`ply-cell lv${c}${i === head ? ' play' : ''}${i % 4 === 0 ? ' beat' : ''}`}
            onPointerDown={() => { const v = (c % 4) + 1; drawing.current = v; paint(i, v); }}
            onPointerEnter={() => { if (drawing.current != null) paint(i, drawing.current); }}
            title={`paso ${i + 1} · ×${c} (clic sube: 1→2→3→4)`}
          >
            <span className="ply-bars">{'▍'.repeat(c)}</span>
          </button>
        ))}
      </div>
      <p className="gate-hint">clic sube el nº de repeticiones (redoble) · ×2 = doble ("tutu") · ×3/×4 = rolls · <b>para AÑADIR golpes distintos usa el secuenciador ▦</b></p>
    </div>
  );
}
