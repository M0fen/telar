import { useMemo, useRef } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { splitArrange, spliceArm, setArmBars, addSilentArm, removeArm } from './stepseqCode';

// Editor visual de ENTRADAS / SECCIONES para un Source que usa `arrange([n, pat], …)`.
// Deja cambiar FÁCILMENTE cuándo entra cada sonido (● suena / ○ silencio por sección)
// y cuántos ciclos dura cada sección (+/−), sin editar el código a mano. Regenera el
// `arrange(...)` preservando el patrón de cada sección. Muestra el TOTAL de ciclos para
// alinear todas las pistas (todas deben sumar lo mismo). Usa el MISMO parser y los mismos
// empalmes por span que el secuenciador (stepseqCode): solo cambian los bytes tocados.

export function ArrangeStrip({ id, code }: { id: string; code: string }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const arms = useMemo(() => splitArrange(code), [code]);
  // recuerda el patrón de una sección al silenciarla, para restaurarlo exacto al reactivar.
  const restore = useRef<Record<number, string>>({});

  if (!arms) {
    return <p className="arr-none nodrag">envuelve el patrón en <code>arrange([4, …], [4, …])</code> para editar entradas por sección aquí</p>;
  }
  const isSilent = (c: string) => c.trim() === 'silence';
  const total = arms.reduce((a, s) => a + Math.max(1, s.bars), 0);
  const base = arms.find((s) => !isSilent(s.code))?.code ?? 's("bd*4")';
  const commit = (next: string) => { if (next !== code) update(id, { code: next }); };

  const setCycles = (i: number, d: number) => commit(setArmBars(code, arms[i], arms[i].bars + d));

  const toggle = (i: number) => {
    const arm = arms[i];
    if (isSilent(arm.code)) { commit(spliceArm(code, arm, restore.current[i] ?? base)); return; }
    restore.current[i] = arm.code;
    commit(spliceArm(code, arm, 'silence'));
  };

  const addSection = () => commit(addSilentArm(code, arms[arms.length - 1], 4));
  const delSection = (i: number) => { const next = removeArm(code, arms, i); if (next !== null) commit(next); };

  return (
    <div className="arr nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="arr-track">
        {arms.map((s, i) => {
          const silent = isSilent(s.code);
          return (
            <div key={i} className={`arr-sec${silent ? ' off' : ''}`} style={{ flexGrow: Math.max(1, s.bars) }} title={silent ? 'silencio' : s.code}>
              <div className="arr-sec-top">
                <button className="arr-onoff" onClick={() => toggle(i)} title={silent ? 'activar: el sonido entra en esta sección' : 'silenciar esta sección'}>{silent ? '○' : '●'}</button>
                <button className="arr-del" onClick={() => delSection(i)} disabled={arms.length < 2} title={arms.length < 2 ? 'es la única sección' : 'quitar sección'}>×</button>
              </div>
              <div className="arr-cyc">
                <button onClick={() => setCycles(i, -1)} title="menos ciclos">−</button>
                <b>{s.bars}</b>
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
