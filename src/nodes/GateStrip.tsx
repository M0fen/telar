import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { getScheduler } from '../audio/engine';

// Rejilla de SILENCIOS (gate) por Source: apaga pasos para meter espacios/silencios
// EXACTOS en el patrón —p. ej. abrir un hueco en un break— de forma visual, sin tocar
// código. Emite un sufijo `.mask("1 0 1 …")`: Strudel RECORTA el sonido en los pasos
// en 0 (silencio real, no re-dispara), conservando el timing. Cabezal sincronizado
// con el reloj (como el secuenciador de pasos). Si todos los pasos están activos, se
// quita la máscara (código limpio).

// Separa un `.mask("…")` final del resto del código.
export function parseMask(code: string): { base: string; bits: number[] } {
  const m = code.match(/^([\s\S]*?)\.mask\("([01\s]+)"\)\s*$/);
  if (m) {
    const bits = m[2].trim().split(/\s+/).map((x) => (x === '0' ? 0 : 1));
    if (bits.length) return { base: m[1].replace(/\s+$/, ''), bits };
  }
  return { base: code.replace(/\s+$/, ''), bits: [] };
}
function buildMask(base: string, bits: number[]): string {
  if (!bits.length || bits.every((b) => b === 1)) return base; // todo activo → sin máscara
  return `${base}.mask("${bits.join(' ')}")`;
}

export function GateStrip({ id, code }: { id: string; code: string }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const { base, bits } = useMemo(() => parseMask(code), [code]);
  const [steps, setSteps] = useState(() => bits.length || 8);
  const [head, setHead] = useState(-1);
  const drawing = useRef<number | null>(null); // valor que se está pintando al arrastrar

  // el patrón puede haber crecido (máscara cargada de un proyecto): no ocultar pasos
  useEffect(() => { if (bits.length) setSteps((s) => Math.max(s, bits.length)); }, [bits.length]);

  // cabezal: paso activo del ciclo actual (la máscara se repite cada ciclo)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = getScheduler()?.now?.();
      setHead(typeof now === 'number' ? Math.floor(((now % 1) + 1) % 1 * steps) % steps : -1);
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
    const arr = bits.slice(0, steps);
    while (arr.length < steps) arr.push(1); // pasos nuevos = activos
    return arr;
  }, [bits, steps]);

  const commit = (next: number[]) => update(id, { code: buildMask(base, next) });
  const paint = (i: number, val: number) => { const n = cells.slice(); n[i] = val; commit(n); };
  const setStepCount = (n: number) => {
    const clamped = Math.max(2, Math.min(32, n));
    // si hay silencios, re-emitir la máscara al nuevo tamaño; si no, solo cambiar la vista
    if (cells.some((c) => c === 0)) {
      const arr = cells.slice(0, clamped);
      while (arr.length < clamped) arr.push(1);
      commit(arr);
    }
    setSteps(clamped);
  };
  const clearGaps = () => { setSteps((s) => s); update(id, { code: base }); };

  const hasGaps = cells.some((c) => c === 0);

  return (
    <div className="gate nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="gate-ctl">
        <span className="gate-tag">silencios</span>
        <div className="gate-steps">
          <button onClick={() => setStepCount(steps - 1)} title="menos pasos">−</button>
          <b>{steps}<i>pasos</i></b>
          <button onClick={() => setStepCount(steps + 1)} title="más pasos">+</button>
        </div>
        <button className="gate-clear" onClick={clearGaps} disabled={!hasGaps} title="quitar todos los silencios (patrón continuo)">limpiar</button>
      </div>
      <div className="gate-grid" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
        {cells.map((c, i) => (
          <button
            key={i}
            className={`gate-cell${c ? ' on' : ' off'}${i === head ? ' play' : ''}${i % 4 === 0 ? ' beat' : ''}`}
            onPointerDown={() => { const v = c ? 0 : 1; drawing.current = v; paint(i, v); }}
            onPointerEnter={() => { if (drawing.current != null) paint(i, drawing.current); }}
            title={`paso ${i + 1} · ${c ? 'suena (clic = silenciar)' : 'silencio (clic = activar)'}`}
          />
        ))}
      </div>
      <p className="gate-hint">apaga pasos para abrir huecos/silencios exactos · arrastra para pintar · <b>para AÑADIR golpes usa el secuenciador ▦</b> (esto solo silencia)</p>
    </div>
  );
}
