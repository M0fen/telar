// SLOTS MIDI DE LA MESA DJ: crossfader, «al compás» y, por deck (por POSICIÓN: deck 1, 2, 3… así un
// controlador de 4 canales queda mapeado aunque cambies de set), volumen, filtro, EQ con su kill,
// cue, mute y solo. Se aprenden tocando el control en la mesa con «aprender» activo.
import type { MidiSlot } from './midiIn';
import { useGraphStore } from '../store/useGraphStore';
import { deckEq, eqFrom01, eqPatch, eqTo01, isDeck, killPatch, orderDecks, useDjStore, type EqBand } from './djMix';
import type { NodeData } from '../graph/types';
import { startSet, stopSet, useSetRec } from './setRecorder';
import { BEAT_LOOP_SIZES, beatLoopSlot } from '../lib/controllerMaps';
import { deckAlignBars, deckBrake, deckCueDown, deckEchoOut, deckCueUp, deckGrid, deckHot, deckJump, deckLoop, deckLoopResize, deckNudge, deckPitch, deckRoll, deckSync, deckToggle, HOT_N, PITCH_RANGE } from './songDeck';

const gs = () => useGraphStore.getState();
const BANDS: EqBand[] = ['high', 'mid', 'low'];
export const BAND_LABEL: Record<EqBand, string> = { high: 'agudos', mid: 'medios', low: 'graves' };
export const deckSlot = (i: number, what: string) => `dj.d${i + 1}.${what}`;

export function buildDjSlots(): Record<string, MidiSlot> {
  const slots: Record<string, MidiSlot> = {};
  slots['dj.xfader'] = { kind: 'knob', get: () => gs().xfader, set: (v) => gs().setXfader(v) };
  slots['dj.quant'] = { kind: 'tap', tap: () => useDjStore.getState().setQuantize(!useDjStore.getState().quantize) };
  slots['dj.setrec'] = { kind: 'tap', tap: () => { if (useSetRec.getState().rec) void stopSet(); else void startSet(); } };
  slots['dj.hpmix'] = { kind: 'knob', get: () => useDjStore.getState().hp.mix, set: (v) => useDjStore.getState().setHp({ mix: v }) };
  const decks = orderDecks(gs().nodes.filter(isDeck)).slice(0, 8);
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
    // deck de TEMA (DJ-1): transporte, cues rápidos, loop, saltos y empujar
    if (n.data.djTrack) {
      slots[deckSlot(i, 'play')] = { kind: 'tap', tap: () => deckToggle(id) };
      slots[deckSlot(i, 'cuebtn')] = { kind: 'pad', down: () => void deckCueDown(id), up: () => deckCueUp(id) };
      slots[deckSlot(i, 'sync')] = { kind: 'tap', tap: () => void deckSync(id, data().djTrack?.sync === false) };
      for (let k = 0; k < HOT_N; k++) slots[deckSlot(i, `hot${k + 1}`)] = { kind: 'tap', tap: () => void deckHot(id, k) };
      slots[deckSlot(i, 'loop')] = { kind: 'tap', tap: () => void deckLoop(id, 4) };
      slots[deckSlot(i, 'loophalf')] = { kind: 'tap', tap: () => void deckLoopResize(id, 0.5) };
      slots[deckSlot(i, 'loopdouble')] = { kind: 'tap', tap: () => void deckLoopResize(id, 2) };
      slots[deckSlot(i, 'roll')] = { kind: 'pad', down: () => void deckRoll(id, 0.5), up: () => void deckRoll(id, null) };
      slots[deckSlot(i, 'jumpb')] = { kind: 'tap', tap: () => void deckJump(id, -4) };
      slots[deckSlot(i, 'jumpf')] = { kind: 'tap', tap: () => void deckJump(id, 4) };
      slots[deckSlot(i, 'nudgeb')] = { kind: 'pad', down: () => deckNudge(id, -1), up: () => deckNudge(id, 0) };
      slots[deckSlot(i, 'nudgef')] = { kind: 'pad', down: () => deckNudge(id, 1), up: () => deckNudge(id, 0) };
      slots[deckSlot(i, 'pitch')] = {
        kind: 'knob',
        get: () => ((Number(data().djTrack?.pitch) || 0) + PITCH_RANGE) / (2 * PITCH_RANGE),
        set: (v) => deckPitch(id, Math.abs(v - 0.5) < 0.015 ? 0 : v * 2 * PITCH_RANGE - PITCH_RANGE),
      };
      // el fader de tempo de los controladores Pioneer: arriba = más lento
      slots[deckSlot(i, 'pitchinv')] = {
        kind: 'knob',
        get: () => 1 - ((Number(data().djTrack?.pitch) || 0) + PITCH_RANGE) / (2 * PITCH_RANGE),
        set: (v) => deckPitch(id, Math.abs(v - 0.5) < 0.015 ? 0 : (1 - v) * 2 * PITCH_RANGE - PITCH_RANGE),
      };
      for (const b of BEAT_LOOP_SIZES) slots[deckSlot(i, beatLoopSlot(b))] = { kind: 'tap', tap: () => void deckLoop(id, b / Math.max(1, data().djTrack?.beats || 4)) };
      slots[deckSlot(i, 'loopexit')] = { kind: 'tap', tap: () => void deckLoop(id, null) };
      // JOG: cada giro empuja el tema en su sentido; al dejar de girar, suelta (empujar a mano)
      let jogT = 0;
      slots[deckSlot(i, 'jog')] = {
        kind: 'knob',
        get: () => 0.5,
        set: (v) => {
          if (Math.abs(v - 0.5) < 1e-6) return;
          deckNudge(id, v > 0.5 ? 1 : -1);
          window.clearTimeout(jogT);
          jogT = window.setTimeout(() => deckNudge(id, 0), 120);
        },
      };
      slots[deckSlot(i, 'align')] = { kind: 'tap', tap: () => void deckAlignBars(id) };
      slots[deckSlot(i, 'gridone')] = { kind: 'tap', tap: () => void deckGrid(id, { kind: 'one' }) };
      slots[deckSlot(i, 'echoout')] = { kind: 'tap', tap: () => deckEchoOut(id) };
      slots[deckSlot(i, 'brake')] = { kind: 'tap', tap: () => deckBrake(id) };
    }
  });
  return slots;
}

// nombre legible de un slot de la mesa (para «aprender»)
export function djSlotName(slot: string): string | null {
  if (slot === 'dj.xfader') return 'crossfader';
  if (slot === 'dj.quant') return '♩ al compás';
  if (slot === 'dj.setrec') return 'grabar el set';
  if (slot === 'dj.hpmix') return 'audífonos: cue ◄► máster';
  const m = /^dj\.d(\d+)\.(\w+)$/.exec(slot);
  if (!m) return null;
  const what = m[2];
  const band = (BANDS as string[]).find((b) => what.endsWith(b)) as EqBand | undefined;
  const song: Record<string, string> = { play: '▶/⏸', cuebtn: 'CUE', sync: 'SYNC', loop: 'loop de 4', jumpb: 'saltar −4', jumpf: 'saltar +4', nudgeb: 'empujar ‹', nudgef: 'empujar ›', ...Object.fromEntries(Array.from({ length: HOT_N }, (_, k) => [`hot${k + 1}`, `cue rápido ${k + 1}`])), loophalf: 'loop ÷2', loopdouble: 'loop ×2', roll: 'roll de ½ tiempo', pitchinv: 'tempo a mano (fader Pioneer)', loopexit: 'salir del loop', jog: 'jog (empujar)',
    ...Object.fromEntries(BEAT_LOOP_SIZES.map((b) => [beatLoopSlot(b), `loop de ${b} ${b === 1 ? 'tiempo' : 'tiempos'}`])), pitch: 'tempo a mano', align: 'alinear compás', gridone: 'el 1 aquí', echoout: 'eco out', brake: 'freno' };
  if (song[what]) return `deck ${m[1]} · ${song[what]}`;
  const label = what === 'gain' ? 'volumen' : what === 'filter' ? 'filtro' : what === 'cue' ? 'cue 🎧' : what === 'mute' ? 'mute' : what === 'solo' ? 'solo'
    : band && what.startsWith('eq') ? `EQ ${BAND_LABEL[band]}` : band && what.startsWith('kill') ? `kill ${BAND_LABEL[band]}` : what;
  return `deck ${m[1]} · ${label}`;
}
