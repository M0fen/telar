// CANCIÓN HORNEADA (Fase 4.1): la canción con sus escenas convertida en UN patrón, para el
// render offline. En vivo las escenas cambian la mezcla en el momento (SongEngine dispara la
// escena de cada sección → cambia mute/solo/gain/filtro/EQ/params de los nodos y el máster →
// recompila). Offline no hay nadie que dispare nada: cada sección se compila con la mezcla de
// SU escena y se recorta a sus compases; las secciones con la misma mezcla comparten código.
// Lo que las escenas cambian en el BUS del máster (filtro/drive DJ, EQ, glue…) no va en el
// código: sale por sección para que el render lo aplique en el compás exacto.
//
// Lógica PURA (sin stores ni motor) → testeable en Node con Strudel real.
import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '../graph/types';
import {
  compileGraph,
  applyGlobalMaster,
  withoutMomentary,
  releaseMomentary,
  duckSidechainIds,
  eqSourceIds,
  type ChannelEqRoute,
  type MasterFx,
  type OrbitPlan,
} from '../graph/compile';
import type { Scene } from '../store/useScenesStore';
import { songTotal } from './songClock';

type N = Node<NodeData>;

export interface BakeStep {
  scene: number;
  bars: number;
}

export interface BakeInput {
  nodes: N[];
  edges: Edge[];
  steps: BakeStep[]; // secciones de la canción ([] = sin canción: el bucle tal cual)
  scenes: Record<number, Scene>;
  master: MasterFx; // máster actual (antes de la primera escena)
  transpose?: number;
  xfader?: number;
  only?: string | null; // stem: solo esta pista
  analyze?: boolean; // true = cada evento lleva la etiqueta de su pista (MIDI); por defecto no
}

export interface BakedSection {
  start: number; // compás de canción (desde 0)
  bars: number;
  master: MasterFx; // máster de la sección (el render aplica su parte de BUS en el compás exacto)
  channelEqs: ChannelEqRoute[]; // EQ por canal de la sección (orbits fijos del plan)
}

export interface BakeResult {
  code: string | null; // patrón completo con el máster global (sin `from`/región/`stopAt`)
  error: string | null;
  total: number; // compases de la canción (0 = sin canción)
  sections: BakedSection[];
  variants: number; // mezclas distintas (1 = sin cambios de escena: el mismo código que en vivo)
}

// Igual que useGraphStore.applyNodeStates (lo que hace disparar una escena): cada nodo de la
// escena se mezcla con su estado; los params se combinan; los nodos que no están, siguen igual.
export function applySceneState(nodes: N[], state: Record<string, Partial<NodeData>>): N[] {
  return nodes.map((n) => {
    const p = state[n.id];
    if (!p) return n;
    const params = p.params ? { ...n.data.params, ...p.params } : n.data.params;
    return { ...n, data: { ...n.data, ...p, params } as NodeData };
  });
}

// La parte del máster que va al CÓDIGO (groove, crush/eco/room, ganancia…), como clave: dos
// másters con la misma envoltura suenan igual en el código (su parte de bus va aparte).
const masterKey = (m: MasterFx) => applyGlobalMaster('__P__', m);

const gateCode = (code: string, ranges: [number, number][], L: number) => {
  const cond = ranges.map(([a, b]) => `(x>=${a}&&x<${b})`).join('||');
  return `(${code}\n).filterHaps((h)=>{const t=h.whole?Number(h.whole.begin):0;const x=((t%${L})+${L})%${L};return ${cond};})`;
};

export function bakeSong(input: BakeInput): BakeResult {
  const { edges, scenes } = input;
  const startMaster = releaseMomentary(input.master);
  const steps = input.steps.filter((s) => s.bars >= 1);
  const total = songTotal(steps);
  const base = { transpose: input.transpose, xfader: input.xfader, songBars: total, only: input.only ?? null, analyze: !!input.analyze };

  // estados por sección: la escena de la sección SOBRE lo que venía (lo que no guarda, sigue)
  const states: { start: number; bars: number; nodes: N[]; master: MasterFx }[] = [];
  let nodes = input.nodes;
  let master = startMaster;
  let acc = 0;
  for (const st of steps) {
    const sc = scenes[st.scene];
    if (sc) {
      nodes = applySceneState(nodes, sc.state as Record<string, Partial<NodeData>>);
      if (sc.master) master = { ...master, ...withoutMomentary(sc.master) };
    }
    states.push({ start: acc, bars: st.bars, nodes, master });
    acc += st.bars;
  }
  if (!states.length) states.push({ start: 0, bars: 0, nodes, master });

  // ORBITS FIJOS: toda pista que tenga EQ (o todo sidechain duck) en ALGUNA sección conserva su bus
  const scIds = new Set<string>();
  const eqIds = new Set<string>();
  for (const s of states) {
    for (const id of duckSidechainIds(s.nodes)) scIds.add(id);
    for (const id of eqSourceIds(s.nodes)) eqIds.add(id);
  }
  const plan: OrbitPlan = { sidechain: new Map(), eq: new Map() };
  let orbit = 2; // 0/1: bus por defecto
  for (const n of input.nodes) if (scIds.has(n.id)) plan.sidechain.set(n.id, orbit++);
  for (const n of input.nodes) if (eqIds.has(n.id)) plan.eq.set(n.id, orbit++);

  // compilar cada sección y agrupar las que suenan igual
  const sections: BakedSection[] = [];
  const variants = new Map<string, { code: string; master: MasterFx; ranges: [number, number][] }>();
  for (const s of states) {
    const r = compileGraph(s.nodes, edges, { ...base, orbitPlan: plan });
    if (!r.code) return { code: null, error: r.error ?? 'no se pudo compilar', total, sections: [], variants: 0 };
    sections.push({ start: s.start, bars: s.bars, master: s.master, channelEqs: r.channelEqs });
    const key = `${r.code}\u0000${masterKey(s.master)}`;
    const v = variants.get(key);
    if (v) v.ranges.push([s.start, s.start + s.bars]);
    else variants.set(key, { code: r.code, master: s.master, ranges: [[s.start, s.start + s.bars]] });
  }

  const list = [...variants.values()];
  // una sola mezcla en toda la canción → el mismo código que en vivo (sin recortes)
  if (list.length === 1) return { code: applyGlobalMaster(list[0].code, list[0].master), error: null, total, sections, variants: 1 };
  const sameWrap = list.every((v) => masterKey(v.master) === masterKey(list[0].master));
  const gated = list.map((v) => gateCode(v.code, v.ranges, total));
  const code = sameWrap
    ? applyGlobalMaster(`stack(\n${gated.join(',\n')}\n)`, list[0].master)
    : `stack(\n${list.map((v, i) => applyGlobalMaster(gated[i], v.master)).join(',\n')}\n)`;
  return { code, error: null, total, sections, variants: list.length };
}
