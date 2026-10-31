// SLOTS MIDI DE LA MESA DJ: crossfader, «al compás» y, por deck (por POSICIÓN: deck 1, 2, 3… así un
// controlador de 4 canales queda mapeado aunque cambies de set), volumen, filtro, EQ con su kill,
// cue, mute y solo. Se aprenden tocando el control en la mesa con «aprender» activo.
import type { MidiSlot } from './midiIn';
import { useGraphStore } from '../store/useGraphStore';
import { deckEq, eqFrom01, eqPatch, eqTo01, isDeck, killPatch, useDjStore, type EqBand } from './djMix';
import type { NodeData } from '../graph/types';

const gs = () => useGraphStore.getState();
const BANDS: EqBand[] = ['high', 'mid', 'low'];
export const BAND_LABEL: Record<EqBand, string> = { high: 'agudos', mid: 'medios', low: 'graves' };
export const deckSlot = (i: number, what: string) => `dj.d${i + 1}.${what}`;

export function buildDjSlots(): Record<string, MidiSlot> {
  const slots: Record<string, MidiSlot> = {};
  slots['dj.xfader'] = { kind: 'knob', get: () => gs().xfader, set: (v) => gs().setXfader(v) };
  slots['dj.quant'] = { kind: 'tap', tap: () => useDjStore.getState().setQuantize(!useDjStore.getState().quantize) };
  const decks = gs().nodes.filter(isDeck).slice(0, 8);
  decks.forEach((n, i) => {
    const id = n.id;
    const data = (): NodeData => (gs().nodes.find((x) => x.id === id)?.data ?? n.data) as NodeData;
    const upd = (p: Partial<NodeData>) => gs().updateNodeData(id, p);
    slots[deckSlot(i, 'gain')] = { kind: 'knob', get: () => (Number(data().gain ?? 1) || 0) / 1.5, set: (v) => upd({ gain: Math.round(v * 1.5 * 100) / 100 }) };
    slots[deckSlot(i, 'filter')] = { kind: 'knob', get: () => ((Number(data().chFilter) || 0) + 1) / 2, set: (v) => upd({ chFilter: Math.abs(v - 0.5) < 0.02 ? 0 : v * 2 - 1 }) };
    for (const b of BANDS) {
      slots[deckSlot(i, `eq${b}`)] = { kind: 'knob', get: () => eqTo01(deckEq(data())[b] ?? 0), set: (v) => upd(eqPatch(data(), { [b]: Math.round(eqFrom01(v) * 2) / 2 })) };
      slots[deckSlot(i, `kill${b}`)] = { kind: 'tap', tap: () => upd(killPatch(data(), b)) };
    }
    slots[deckSlot(i, 'cue')] = { kind: 'tap', tap: () => useDjStore.getState().toggleCue(id) };
    slots[deckSlot(i, 'mute')] = { kind: 'tap', tap: () => upd({ mute: !data().mute }) };
    slots[deckSlot(i, 'solo')] = { kind: 'tap', tap: () => upd({ solo: !data().solo }) };
  });
  return slots;
}

// nombre legible de un slot de la mesa (para «aprender»)
export function djSlotName(slot: string): string | null {
  if (slot === 'dj.xfader') return 'crossfader';
  if (slot === 'dj.quant') return '♩ al compás';
  const m = /^dj\.d(\d+)\.(\w+)$/.exec(slot);
  if (!m) return null;
  const what = m[2];
  const band = (BANDS as string[]).find((b) => what.endsWith(b)) as EqBand | undefined;
  const label = what === 'gain' ? 'volumen' : what === 'filter' ? 'filtro' : what === 'cue' ? 'cue 🎧' : what === 'mute' ? 'mute' : what === 'solo' ? 'solo'
    : band && what.startsWith('eq') ? `EQ ${BAND_LABEL[band]}` : band && what.startsWith('kill') ? `kill ${BAND_LABEL[band]}` : what;
  return `deck ${m[1]} · ${label}`;
}
