// MEZCLA EN VIVO DEL MODO DJ: volumen, crossfader, filtro, EQ, mute y solo de cada deck van a su bus
// (engine: setStripLive) en el acto, sin recompilar el patrón. Las ENTRADAS y SALIDAS (mute/solo)
// caen en el 1 del próximo compás si «al compás» está activo (el patrón sigue sonando debajo: entra
// justo, nunca a mitad de compás). El valor de verdad sigue en los nodos (deshacer, guardar, escenas).
// El CUE (audífonos) es aparte: no toca la sala ni el historial (cueOut.ts lo saca por otra salida).
import { create } from 'zustand';
import { busFaderOf } from '../graph/compile';
import { channelEqActive, type NodeData } from '../graph/types';
import { audioNow, hasStrip, nextBarAudioTime, setCue, setStripLive } from './engine';

const Q_KEY = 'telar.dj.quantize';
const HP_KEY = 'telar.dj.hp';
const readQ = () => { try { return localStorage.getItem(Q_KEY) !== '0'; } catch { return true; } };
interface HpPrefs { device: string | null; mix: number; vol: number }
const readHp = (): HpPrefs => {
  try {
    const v = JSON.parse(localStorage.getItem(HP_KEY) ?? '{}') as Partial<HpPrefs>;
    return { device: typeof v.device === 'string' ? v.device : null, mix: clamp01(v.mix ?? 0.25), vol: Math.max(0, Math.min(1.5, Number(v.vol ?? 1))) };
  } catch {
    return { device: null, mix: 0.25, vol: 1 };
  }
};
const clamp01 = (x: unknown) => Math.max(0, Math.min(1, Number(x) || 0));

interface DjState {
  quantize: boolean; // entradas/salidas al compás
  pending: Record<string, number>; // deck → hora (ms de performance) en que cae su entrada/salida
  cue: Record<string, boolean>; // decks en los audífonos
  hp: HpPrefs; // salida de audífonos (null = apagada), mezcla cue◄►máster (0 = solo cue), volumen
  setQuantize: (v: boolean) => void;
  toggleCue: (id: string) => void;
  setHp: (p: Partial<HpPrefs>) => void;
}
export const useDjStore = create<DjState>((set, get) => ({
  quantize: readQ(),
  pending: {},
  cue: {},
  hp: readHp(),
  setQuantize: (quantize) => { set({ quantize }); try { localStorage.setItem(Q_KEY, quantize ? '1' : '0'); } catch { /* sesión */ } },
  toggleCue: (id) => {
    const on = !get().cue[id];
    const cue = { ...get().cue };
    if (on) cue[id] = true; else delete cue[id];
    set({ cue });
    setCue(id, on);
  },
  setHp: (p) => {
    const hp = { ...get().hp, ...p };
    set({ hp });
    try { localStorage.setItem(HP_KEY, JSON.stringify(hp)); } catch { /* sesión */ }
  },
}));

// claves que el modo DJ aplica en vivo (sin recompilar)
export const DJ_LIVE_KEYS = new Set(['gain', 'chFilter', 'eq', 'mute', 'solo', 'xfa']);

interface DeckNode { id: string; data: NodeData }
export const isDeck = (n: DeckNode) => n.data.kind === 'source' && !Array.isArray(n.data.transitions);

export { KILL_DB, EQ_MIN, EQ_MAX, deckEq, eqPatch, isKilled, killPatch, eqFrom01, eqTo01, type EqBand } from '../lib/djEq';

// EQ de la tira (plano si el EQ está apagado), con los mismos topes que el compilador
const eqOf = (d: NodeData) => {
  const on = channelEqActive(d.eq);
  const e = d.eq ?? { low: 0, mid: 0, high: 0 };
  const c = (v: unknown) => Math.max(-30, Math.min(15, Number(v) || 0));
  return on ? { low: c(e.low), mid: c(e.mid), high: c(e.high), midFreq: Math.max(200, Math.min(8000, Number((e as { midFreq?: number }).midFreq) || 1000)) } : { low: 0, mid: 0, high: 0, midFreq: 1000 };
};

// ¿Cambiar mute/solo de este deck cambia el CÓDIGO? Sí si hay sidechain duck y el deck es su bombo
// (o cambia un solo: puede callar al bombo). Entonces hay que recompilar (en el compás).
export function djEntryNeedsCode(nodes: DeckNode[], id: string, keys: string[]): boolean {
  const ducks = nodes.filter((n) => n.data.kind === 'fx' && n.data.opId === 'sidechain' && String(n.data.params?.mode ?? 'gen') === 'duck');
  if (!ducks.length) return false;
  if (keys.includes('solo')) return true;
  return keys.includes('mute') && ducks.some((n) => String(n.data.params?.trigger ?? '') === id);
}

// segundos hasta que conviene hot-swapear para que el código nuevo rija desde el 1 del próximo
// compás (el planificador consulta ~latencia + intervalo antes de que suene); 0 = ya
export function swapDelayForBar(): number {
  if (!useDjStore.getState().quantize) return 0;
  const bar = nextBarAudioTime();
  if (!bar) return 0;
  return Math.max(0, bar.at - audioNow() - 0.1 - 0.09);
}

// Aplica en vivo lo que cambió. Mute/solo se agendan al compás (si «al compás» está activo).
// false = alguna pista aún no tiene su tira (el llamador recompila).
export function applyDjLive(nodes: DeckNode[], xfader: number, changed: { id?: string; keys: string[] }): boolean {
  const decks = nodes.filter(isDeck);
  if (!decks.length || !decks.every((n) => hasStrip(n.id))) return false;
  const keys = new Set(changed.keys);
  const anySolo = decks.some((n) => n.data.solo);
  const entry = keys.has('mute') || keys.has('solo');
  const bar = entry && useDjStore.getState().quantize ? nextBarAudioTime() : null;
  let ok = true;
  if (changed.id && keys.has('eq')) {
    const d = decks.find((n) => n.id === changed.id);
    if (d) ok = setStripLive(d.id, eqOf(d.data)) && ok;
  }
  if (changed.id && keys.has('chFilter')) {
    const d = decks.find((n) => n.id === changed.id);
    if (d) ok = setStripLive(d.id, { filter: Math.max(-1, Math.min(1, Number(d.data.chFilter) || 0)) }) && ok;
  }
  if (keys.has('gain') || keys.has('xfa') || keys.has('xfader') || entry) {
    for (const n of decks) ok = setStripLive(n.id, { fader: busFaderOf(n.data, xfader, anySolo) }, bar?.at) && ok;
  }
  // aviso visual: el deck que entra/sale parpadea hasta el 1
  if (bar && changed.id) {
    const id = changed.id;
    const ms = performance.now() + Math.max(0, (bar.at - audioNow()) * 1000);
    useDjStore.setState((s) => ({ pending: { ...s.pending, [id]: ms } }));
    window.setTimeout(() => useDjStore.setState((s) => {
      if (s.pending[id] !== ms) return s;
      const p = { ...s.pending };
      delete p[id];
      return { pending: p };
    }), Math.max(0, ms - performance.now()) + 30);
  }
  return ok;
}
