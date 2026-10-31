// EQ DEL DECK (modo DJ) — lógica PURA: perillas de 3 bandas con KILL, y cómo una perilla MIDI de
// 0..1 se vuelve dB como en una mesa (tope a la izquierda = kill, el centro = 0 dB, derecha = +6).
import { DEFAULT_CHANNEL_EQ, type ChannelEq, type NodeData } from '../graph/types';

export const KILL_DB = -30; // dB de corte del KILL (el compilador permite hasta −30)
export const EQ_MIN = -26;
export const EQ_MAX = 6;
export type EqBand = 'low' | 'mid' | 'high';
export const deckEq = (d: NodeData): ChannelEq => ({ ...DEFAULT_CHANNEL_EQ, ...(d.eq ?? {}) });
export const eqPatch = (d: NodeData, patch: Partial<ChannelEq>): Partial<NodeData> => ({ eq: { ...deckEq(d), on: true, ...patch } });
export const isKilled = (d: NodeData, band: EqBand) => (deckEq(d)[band] ?? 0) <= KILL_DB + 1;
export const killPatch = (d: NodeData, band: EqBand): Partial<NodeData> => eqPatch(d, { [band]: isKilled(d, band) ? 0 : KILL_DB } as Partial<ChannelEq>);
// perilla física 0..1 → dB como una mesa: tope a la izquierda = kill, el centro = 0 dB
export const eqFrom01 = (v: number) => (v <= 0.01 ? KILL_DB : v < 0.5 ? EQ_MIN * (1 - v / 0.5) : ((v - 0.5) / 0.5) * EQ_MAX);
export const eqTo01 = (db: number) => (db <= KILL_DB + 1 ? 0 : db < 0 ? 0.5 * (1 - db / EQ_MIN) : 0.5 + (0.5 * db) / EQ_MAX);

