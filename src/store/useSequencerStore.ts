import { create } from 'zustand';
import { useGraphStore } from './useGraphStore';
import { laneCode } from '../lib/laneCode';

// SECUENCIADOR de pasos multipista (drum machine). Cada PISTA = un Source del grafo
// (owned: se marca con data.seqLane = lane.id). Al editar la rejilla se sincroniza el
// código de ese Source como `s("bd").struct("x ~ x ~ …")`. El grafo sigue siendo la
// verdad para sonar; el secuenciador es una vista que crea/edita esas pistas y las
// conecta al Out. Persiste en localStorage.

export interface Lane {
  id: string;
  name: string;
  sound: string; // ej. bd, sd, hh, cp, 808…
  bank: string; // ej. RolandTR808 ('' = sin banco)
  steps: boolean[]; // longitud >= stepCount
  gain: number;
  muted: boolean;
}

const KEY = 'telar.seq.v1';
const BANKS = ['', 'RolandTR808', 'RolandTR909', 'LinnDrum', 'AkaiLinn'];
export const SEQ_BANKS = BANKS;
// paleta de sonidos habituales para añadir pistas rápido
export const SEQ_SOUNDS = ['bd', 'sd', 'rim', 'cp', 'hh', 'oh', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb'];

const uid = () => 'l_' + Math.random().toString(36).slice(2, 8);
function blankSteps(n = 32): boolean[] { return Array.from({ length: n }, () => false); }

function defaultLanes(): Lane[] {
  const mk = (name: string, sound: string, on: number[]): Lane => {
    const steps = blankSteps();
    on.forEach((i) => { steps[i] = true; });
    return { id: uid(), name, sound, bank: 'RolandTR808', steps, gain: 1, muted: false };
  };
  return [
    mk('kick', 'bd', [0, 4, 8, 12]),
    mk('snare', 'sd', [4, 12]),
    mk('hat', 'hh', [0, 2, 4, 6, 8, 10, 12, 14]),
  ];
}

interface Saved { lanes: Lane[]; stepCount: number; swing: number }
// Sanea una pista guardada: pistas de versiones viejas podían venir SIN gain/steps →
// `l.gain.toFixed()` o `l.steps[i]` reventaban el render (pantalla en negro al abrir).
// Rellenamos valores por defecto y garantizamos tipos, para que NUNCA rompa.
function sanitizeLane(l: unknown): Lane {
  const o = (l ?? {}) as Partial<Lane>;
  const sound = typeof o.sound === 'string' && o.sound ? o.sound : 'bd';
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uid(),
    name: typeof o.name === 'string' ? o.name : sound,
    sound,
    bank: typeof o.bank === 'string' ? o.bank : '',
    steps: Array.isArray(o.steps) ? o.steps.map((s) => !!s) : blankSteps(),
    gain: typeof o.gain === 'number' && isFinite(o.gain) ? o.gain : 1,
    muted: !!o.muted,
  };
}
function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.lanes)) {
        const sc = Number(s.stepCount);
        return {
          lanes: s.lanes.map(sanitizeLane),
          stepCount: sc >= 4 && sc <= 32 ? sc : 16,
          swing: typeof s.swing === 'number' && isFinite(s.swing) ? Math.max(0, Math.min(0.6, s.swing)) : 0,
        };
      }
    }
  } catch { /* ignore */ }
  return { lanes: defaultLanes(), stepCount: 16, swing: 0 };
}

interface State {
  lanes: Lane[];
  stepCount: number;
  swing: number;
  open: boolean;
  setOpen: (o: boolean) => void;
  setStepCount: (n: number) => void;
  setSwing: (s: number) => void;
  addLane: (sound?: string, bank?: string) => void;
  removeLane: (id: string) => void;
  // "fijar/guardar": desliga la pista del secuenciador → su Source queda como un nodo
  // normal (sigue sonando, editable, se guarda con el proyecto) y sale de la rejilla.
  freezeLane: (id: string) => void;
  toggleStep: (id: string, i: number) => void;
  clearLane: (id: string) => void;
  setLaneSound: (id: string, sound: string) => void;
  setLaneBank: (id: string, bank: string) => void;
  setLaneGain: (id: string, gain: number) => void;
  toggleMute: (id: string) => void;
  syncAll: () => void; // reconstruye todas las pistas en el grafo (al abrir / cambiar pasos)
}

// crea/actualiza el Source de una pista y lo conecta al Out. Un recompile por llamada.
// Envuelto en try/catch: una pista corrupta NO debe tumbar la app.
function syncLane(l: Lane, stepCount: number, swing: number): void {
  try {
    const gs = useGraphStore.getState();
    const node = gs.nodes.find((n) => (n.data as { seqLane?: string }).seqLane === l.id);
    const code = laneCode(l, stepCount, swing, node?.data.code ?? '');
    if (node) {
      gs.updateNodeData(node.id, { code, mute: l.muted }); // no pisa el name (respeta renombrados)
    } else {
      const id = gs.addPattern(code, l.name, { seqLane: l.id, mute: l.muted });
      const out = useGraphStore.getState().nodes.find((n) => n.data.kind === 'out');
      if (out) gs.onConnect({ source: id, target: out.id, sourceHandle: null, targetHandle: null });
    }
  } catch {
    /* una pista mala no debe romper el secuenciador ni la app */
  }
}

function persist(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const useSequencerStore = create<State>((set, get) => {
  const save = () => persist({ lanes: get().lanes, stepCount: get().stepCount, swing: get().swing });
  const patch = (id: string, fn: (l: Lane) => Lane, sync = true) => {
    let changed: Lane | null = null;
    const lanes = get().lanes.map((l) => (l.id === id ? (changed = fn(l)) : l));
    set({ lanes });
    save();
    if (sync && changed) syncLane(changed, get().stepCount, get().swing);
  };
  return {
    ...load(),
    open: false,
    setOpen: (open) => { set({ open }); if (open) get().syncAll(); },
    setStepCount: (n) => { set({ stepCount: Math.max(4, Math.min(32, n)) }); save(); get().syncAll(); },
    setSwing: (swing) => { set({ swing: Math.max(0, Math.min(0.6, swing)) }); save(); get().syncAll(); },
    addLane: (sound = 'bd', bank = 'RolandTR808') => {
      const lane: Lane = { id: uid(), name: sound, sound, bank, steps: blankSteps(), gain: 1, muted: false };
      set({ lanes: [...get().lanes, lane] });
      save();
      syncLane(lane, get().stepCount, get().swing);
    },
    removeLane: (id) => {
      const gs = useGraphStore.getState();
      const node = gs.nodes.find((n) => (n.data as { seqLane?: string }).seqLane === id);
      if (node) gs.removeNode(node.id);
      set({ lanes: get().lanes.filter((l) => l.id !== id) });
      save();
    },
    freezeLane: (id) => {
      const gs = useGraphStore.getState();
      const node = gs.nodes.find((n) => (n.data as { seqLane?: string }).seqLane === id);
      // desliga: quita seqLane → el secuenciador deja de sincronizar/pisar este Source,
      // que se queda sonando tal cual y editable (persiste con el proyecto).
      if (node) gs.updateNodeData(node.id, { seqLane: undefined });
      set({ lanes: get().lanes.filter((l) => l.id !== id) });
      save();
    },
    toggleStep: (id, i) => patch(id, (l) => { const steps = l.steps.slice(); steps[i] = !steps[i]; return { ...l, steps }; }),
    clearLane: (id) => patch(id, (l) => ({ ...l, steps: blankSteps() })),
    setLaneSound: (id, sound) => patch(id, (l) => ({ ...l, sound, name: sound })),
    setLaneBank: (id, bank) => patch(id, (l) => ({ ...l, bank })),
    setLaneGain: (id, gain) => patch(id, (l) => ({ ...l, gain })),
    toggleMute: (id) => patch(id, (l) => ({ ...l, muted: !l.muted })),
    syncAll: () => { const { lanes, stepCount, swing } = get(); lanes.forEach((l) => syncLane(l, stepCount, swing)); },
  };
});
