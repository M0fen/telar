import { useEffect, useState } from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { useSongStore } from '../../store/useSongStore';
import { heardCycle } from '../../audio/engine';
import { OPS_BY_ID } from '../../graph/ops';
import { cleanAuto, type AutoPoint } from '../../lib/automation';
import { fxCurve } from '../../lib/fxAutomation';
import { curveAt } from '../../lib/timeline';
import { timelinePos } from '../../lib/songClock';
import { cleanMacros, macroValue, MACRO_SLOTS, type Macro } from '../../lib/mixMath';
import type { NodeData } from '../../graph/types';
import { Knob } from '../Knob';

// CADENA Y MODULACIÓN (Fase 11.5): la cadena de la pista en orden (sus perillas de canal y cada
// efecto por el que pasa hasta la salida). Una perilla con curva de automatización lleva un ANILLO
// ámbar con lo que suena ahora. MACROS: cuatro perillas del proyecto que mueven varias a la vez
// (cada una entre el valor que tenía al asignarla y su máximo): «asignar» y toca + en las perillas.

const gs = () => useGraphStore.getState();

// nodos de efecto/transformación desde la pista hasta la salida, en orden
function chainOf(id: string, nodes: { id: string; data: NodeData }[], edges: { source: string; target: string }[]): { id: string; data: NodeData }[] {
  const out: { id: string; data: NodeData }[] = [];
  const seen = new Set<string>([id]);
  const q = [id];
  while (q.length) {
    const cur = q.shift()!;
    for (const e of edges) {
      if (e.source !== cur || seen.has(e.target)) continue;
      seen.add(e.target);
      const n = nodes.find((x) => x.id === e.target);
      if (!n) continue;
      if (n.data.kind === 'fx' || n.data.kind === 'transform') out.push(n);
      q.push(n.id);
    }
  }
  return out;
}

// el compás que suena (para los anillos), refrescado ~8 veces por segundo
function usePlayBar(): number {
  const [bar, setBar] = useState(NaN);
  useEffect(() => {
    const t = window.setInterval(() => {
      const playing = gs().playing;
      const now = playing ? heardCycle() : NaN;
      setBar(Number.isFinite(now) ? timelinePos(now, useSongStore.getState()) : NaN);
    }, 120);
    return () => window.clearInterval(t);
  }, []);
  return bar;
}
const ringOf = (pts: AutoPoint[] | undefined, bar: number) => (pts && pts.length && Number.isFinite(bar) ? curveAt(pts, Math.max(0, bar)) : null);

export function ChainView({ id }: { id: string }) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const update = useGraphStore((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === id);
  const out = nodes.find((n) => n.data.kind === 'out');
  const bar = usePlayBar();
  const [arm, setArm] = useState(-1); // macro que se está asignando
  if (!node) return null;
  const d = node.data;
  const songBars = useSongStore.getState().steps.reduce((a, s) => a + s.bars, 0);
  const pos = Number.isFinite(bar) && songBars > 0 ? bar % songBars : bar;
  const au = cleanAuto(d.auto);
  const macros: Macro[] = cleanMacros(out?.data.macros);
  const chain = chainOf(id, nodes, edges);

  const setMacros = (next: Macro[]) => { if (out) update(out.id, { macros: next } as Partial<NodeData>); };
  const moveMacro = (k: number, v: number) => {
    const m = macros[k];
    setMacros(macros.map((x, i) => (i === k ? { ...x, v } : x)));
    for (const t of m.targets) {
      const n = gs().nodes.find((x) => x.id === t.node);
      if (!n) continue;
      update(t.node, { params: { ...(n.data.params ?? {}), [t.key]: Math.round(macroValue(t, v) * 1000) / 1000 } });
    }
  };
  const isTarget = (k: number, nodeId: string, key: string) => macros[k]?.targets.some((t) => t.node === nodeId && t.key === key);
  const toggleTarget = (k: number, nodeId: string, key: string, cur: number, max: number) => {
    const m = macros[k];
    const targets = isTarget(k, nodeId, key) ? m.targets.filter((t) => !(t.node === nodeId && t.key === key)) : [...m.targets, { node: nodeId, key, min: cur, max }];
    setMacros(macros.map((x, i) => (i === k ? { ...x, targets: targets.slice(0, 8) } : x)));
  };

  const trackKnobs: { key: string; label: string; value: number; min: number; max: number; def: number; patch: (v: number) => Partial<NodeData>; auto?: AutoPoint[] }[] = [
    { key: 'gain', label: 'volumen', value: Number(d.gain ?? 1), min: 0, max: 1.5, def: 1, patch: (v) => ({ gain: v }), auto: au.vol },
    { key: 'pan', label: 'paneo', value: typeof d.chPan === 'number' ? d.chPan : 0.5, min: 0, max: 1, def: 0.5, patch: (v) => ({ chPan: v }), auto: au.pan },
    { key: 'filt', label: 'filtro', value: Number(d.chFilter ?? 0), min: -1, max: 1, def: 0, patch: (v) => ({ chFilter: v }), auto: au.filt },
    { key: 'rev', label: '→ reverb', value: Number(d.sends?.rev ?? 0), min: 0, max: 1, def: 0, patch: (v) => ({ sends: { ...(d.sends ?? {}), rev: v } }), auto: au.rev },
    { key: 'del', label: '→ eco', value: Number(d.sends?.del ?? 0), min: 0, max: 1, def: 0, patch: (v) => ({ sends: { ...(d.sends ?? {}), del: v } }), auto: au.del },
  ];

  return (
    <div className="mx-chain">
      <div className="mx-macros" role="group" aria-label="macros">
        <span className="mx-sec">macros</span>
        {macros.slice(0, MACRO_SLOTS).map((m, k) => (
          <div key={k} className={`mx-macro${arm === k ? ' arm' : ''}`}>
            <Knob value={m.v} min={0} max={1} step={0.01} size={32} defaultValue={0} label={`${m.name}: mueve ${m.targets.length} perilla${m.targets.length === 1 ? '' : 's'}`} hideValue onChange={(v) => moveMacro(k, v)} />
            <input className="mx-macro-name" value={m.name} maxLength={16} onChange={(e) => setMacros(macros.map((x, i) => (i === k ? { ...x, name: e.target.value } : x)))} aria-label={`nombre de la macro ${k + 1}`} />
            <button className={`mx-tog sm${arm === k ? ' on' : ''}`} onClick={() => setArm(arm === k ? -1 : k)} title={arm === k ? 'terminar de asignar' : 'asignar perillas a esta macro: toca + en las de abajo'}>
              {arm === k ? 'listo' : `asignar · ${m.targets.length}`}
            </button>
          </div>
        ))}
      </div>

      <div className="mx-chain-list">
        <div className="mx-fx">
          <span className="mx-fx-name">canal</span>
          <div className="mx-fx-knobs">
            {trackKnobs.map((k) => (
              <label key={k.key} className="mx-pk">
                <Knob value={k.value} min={k.min} max={k.max} step={0.01} size={28} defaultValue={k.def} label={k.label} hideValue ring={ringOf(k.auto, pos)} onChange={(v) => update(id, k.patch(v))} />
                <span>{k.label}</span>
                {k.auto?.length ? <i className="mx-auto" title="tiene curva de automatización (anillo ámbar = lo que suena ahora)">A</i> : null}
              </label>
            ))}
          </div>
        </div>
        {chain.length === 0 && <p className="mx-note">Esta pista va directa a la salida (sin efectos en el grafo).</p>}
        {chain.map((n) => {
          const op = n.data.opId ? OPS_BY_ID[n.data.opId] : undefined;
          const nums = (op?.params ?? []).filter((p) => p.kind === 'number' && p.min != null && p.max != null);
          return (
            <div key={n.id} className="mx-fx">
              <span className="mx-fx-name" title={n.data.kind === 'fx' ? 'efecto' : 'transformación'}>{op?.label ?? n.data.opId ?? n.data.kind}</span>
              <div className="mx-fx-knobs">
                {nums.length === 0 && <span className="mx-note">sin perillas</span>}
                {nums.map((p) => {
                  const v = Number(n.data.params?.[p.key] ?? p.default);
                  const curve = fxCurve(n.data, p.key);
                  return (
                    <label key={p.key} className="mx-pk">
                      <Knob value={v} min={p.min!} max={p.max!} step={p.step ?? 0.01} scale={p.scale} size={28} defaultValue={Number(p.default)} label={`${op?.label ?? ''} · ${p.label}`} hideValue
                        ring={ringOf(curve, pos)} onChange={(x) => update(n.id, { params: { ...(n.data.params ?? {}), [p.key]: x } })} />
                      <span>{p.label}</span>
                      {curve.length ? <i className="mx-auto" title="tiene curva de automatización">A</i> : null}
                      {arm >= 0 && (
                        <button className={`mx-assign${isTarget(arm, n.id, p.key) ? ' on' : ''}`} onClick={(e) => { e.preventDefault(); toggleTarget(arm, n.id, p.key, v, p.max!); }}
                          title={isTarget(arm, n.id, p.key) ? `quitar de ${macros[arm].name}` : `añadir a ${macros[arm].name}: irá de ${v} (ahora) a ${p.max}`}>
                          {isTarget(arm, n.id, p.key) ? `✓M${arm + 1}` : `+M${arm + 1}`}
                        </button>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
