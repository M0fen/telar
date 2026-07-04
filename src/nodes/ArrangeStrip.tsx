import { useMemo, useRef } from 'react';
import { useGraphStore } from '../store/useGraphStore';

// Editor visual de ENTRADAS / SECCIONES para un Source que usa `arrange([n, pat], …)`.
// Deja cambiar FÁCILMENTE cuándo entra cada sonido (● suena / ○ silencio por sección)
// y cuántos ciclos dura cada sección (+/−), sin editar el código a mano. Regenera el
// `arrange(...)` preservando el patrón de cada sección. Muestra el TOTAL de ciclos para
// alinear todas las pistas (todas deben sumar lo mismo).

// Divide `s` por comas de NIVEL SUPERIOR (respeta (), [], {} y comillas).
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q && s[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

export interface ArrSection { cycles: number; pattern: string }
interface Parsed { pre: string; sections: ArrSection[]; post: string }

// Parsea el PRIMER arrange(...) de nivel superior del código.
export function parseArrange(code: string): Parsed | null {
  const idx = code.indexOf('arrange');
  if (idx < 0) return null;
  const open = code.indexOf('(', idx);
  if (open < 0) return null;
  let depth = 0;
  let q: string | null = null;
  let close = -1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (q) { if (c === q && code[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) return null;
  const inner = code.slice(open + 1, close);
  const args = splitTop(inner).map((a) => a.trim()).filter(Boolean);
  const sections: ArrSection[] = [];
  for (const a of args) {
    const lb = a.indexOf('[');
    const rb = a.lastIndexOf(']');
    if (lb < 0 || rb < 0) return null;
    const parts = splitTop(a.slice(lb + 1, rb));
    if (parts.length < 2) return null;
    const cyc = parseInt(parts[0].trim(), 10);
    if (!isFinite(cyc)) return null;
    sections.push({ cycles: cyc, pattern: parts.slice(1).join(',').trim() });
  }
  if (!sections.length) return null;
  return { pre: code.slice(0, idx), sections, post: code.slice(close + 1) };
}

function build(p: Parsed): string {
  return `${p.pre}arrange(${p.sections.map((s) => `[${s.cycles}, ${s.pattern}]`).join(', ')})${p.post}`;
}

export function ArrangeStrip({ id, code }: { id: string; code: string }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const parsed = useMemo(() => parseArrange(code), [code]);
  // recuerda el patrón de una sección al silenciarla, para restaurarlo exacto al reactivar.
  const restore = useRef<Record<number, string>>({});

  if (!parsed) {
    return <p className="arr-none nodrag">envuelve el patrón en <code>arrange([4, …], [4, …])</code> para editar entradas por sección aquí</p>;
  }
  const { sections } = parsed;
  const total = sections.reduce((a, s) => a + Math.max(1, s.cycles), 0);
  const base = sections.find((s) => s.pattern.trim() !== 'silence')?.pattern ?? 's("bd*4")';
  const commit = (next: ArrSection[]) => update(id, { code: build({ ...parsed, sections: next }) });

  const setCycles = (i: number, d: number) =>
    commit(sections.map((s, j) => (j === i ? { ...s, cycles: Math.max(1, Math.min(64, s.cycles + d)) } : s)));

  const toggle = (i: number) => {
    const silent = sections[i].pattern.trim() === 'silence';
    commit(sections.map((s, j) => {
      if (j !== i) return s;
      if (silent) return { ...s, pattern: restore.current[i] ?? base };
      restore.current[i] = s.pattern;
      return { ...s, pattern: 'silence' };
    }));
  };

  const addSection = () => commit([...sections, { cycles: 4, pattern: 'silence' }]);
  const delSection = (i: number) => commit(sections.filter((_, j) => j !== i));

  return (
    <div className="arr nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="arr-track">
        {sections.map((s, i) => {
          const silent = s.pattern.trim() === 'silence';
          return (
            <div key={i} className={`arr-sec${silent ? ' off' : ''}`} style={{ flexGrow: Math.max(1, s.cycles) }} title={silent ? 'silencio' : s.pattern}>
              <div className="arr-sec-top">
                <button className="arr-onoff" onClick={() => toggle(i)} title={silent ? 'activar: el sonido entra en esta sección' : 'silenciar esta sección'}>{silent ? '○' : '●'}</button>
                <button className="arr-del" onClick={() => delSection(i)} title="quitar sección">×</button>
              </div>
              <div className="arr-cyc">
                <button onClick={() => setCycles(i, -1)} title="menos ciclos">−</button>
                <b>{s.cycles}</b>
                <button onClick={() => setCycles(i, 1)} title="más ciclos">+</button>
              </div>
            </div>
          );
        })}
        <button className="arr-add" onClick={addSection} title="añadir sección al final">＋</button>
      </div>
      <div className="arr-foot">
        <span className="arr-total">total {total} ciclos</span>
        <span className="arr-hint">● suena · ○ silencio · +/− ciclos · alinea el total en todas las pistas</span>
      </div>
    </div>
  );
}
