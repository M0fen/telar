// SAMPLES PARA UN PAD (Fase 9.7): con qué otros samples se puede cambiar un sonido de la batería —
// el mismo sonido en otras cajas de ritmos (bancos) y las variantes de su banco («bd:0», «bd:1»…).
// Se leen del mapa de sonidos cargado (prebake + packs).
import { soundMap } from '@strudel/web';
import { bankExempt } from '../nodes/stepseqCode';

type SoundEntry = { data?: { samples?: unknown } };
const mapNow = (): Record<string, SoundEntry> => {
  try { return ((soundMap as unknown as { get?: () => Record<string, SoundEntry> }).get?.() ?? {}); } catch { return {}; }
};
// el mapa guarda los nombres como se registraron («RolandTR909_bd» o en minúsculas, según el pack):
// se busca sin distinguir mayúsculas
let lowerIdx: { src: Record<string, SoundEntry>; keys: Map<string, string> } | null = null;
function keyFor(name: string): string | null {
  const m = mapNow();
  if (m[name]) return name;
  if (!lowerIdx || lowerIdx.src !== m || lowerIdx.keys.size !== Object.keys(m).length) {
    lowerIdx = { src: m, keys: new Map(Object.keys(m).map((k) => [k.toLowerCase(), k])) };
  }
  return lowerIdx.keys.get(name.toLowerCase()) ?? null;
}
export const soundKeys = (): string[] => Object.keys(mapNow());
// nombre REAL en el mapa (para la onda y la audición)
export const resolveSoundKey = (name: string): string => keyFor(name) ?? name;

export const baseSound = (s: string) => s.replace(/:\d+$/, '');
// nombre en el mapa de sonidos (con su banco) y cuántos samples tiene
export const mapName = (sound: string, bank: string) => (bank && !bankExempt(sound) ? `${bank}_${baseSound(sound)}` : baseSound(sound));
export function sampleCount(name: string): number {
  const k = keyFor(name);
  const e = k ? mapNow()[k] : undefined;
  const smp = e?.data?.samples;
  if (Array.isArray(smp)) return smp.length;
  return e ? 1 : 0;
}

export interface SoundAlt { label: string; sound: string; bank: string }

// cajas de ritmos que más se usan, primero
const PREFERRED = ['RolandTR909', 'RolandTR808', 'RolandTR707', 'LinnDrum', 'AkaiMPC60', 'EmuSP12', 'RolandTR606', 'RolandCR78', 'BossDR110', 'KorgMinipops'];

export function soundAlternatives(sound: string, bank: string): SoundAlt[] {
  const base = baseSound(sound);
  const out: SoundAlt[] = [];
  const seen = new Set<string>();
  const push = (a: SoundAlt) => { const k = `${a.bank}|${a.sound}`; if (!seen.has(k)) { seen.add(k); out.push(a); } };
  push({ label: `${bank ? bank + ' · ' : ''}${sound}`, sound, bank });
  if (bankExempt(sound)) {
    const n = sampleCount(base);
    for (let k = sound === base ? 1 : 0; k < Math.min(n, 24); k++) push({ label: `${base}:${k}`, sound: `${base}:${k}`, bank: '' });
    return out;
  }
  // variantes del mismo banco («oh» = «oh:0»: no se repite)
  const n = sampleCount(mapName(base, bank));
  for (let k = sound === base ? 1 : 0; k < Math.min(n, 24); k++) push({ label: `${bank ? bank + ' · ' : ''}${base}:${k}`, sound: `${base}:${k}`, bank });
  // el mismo sonido en otras cajas
  const lb = base.toLowerCase();
  const cur = bank.toLowerCase();
  const banks = Object.keys(mapNow()).filter((key) => key.toLowerCase().endsWith(`_${lb}`)).map((key) => key.slice(0, -(base.length + 1))).filter((b) => b.toLowerCase() !== cur);
  const pref = PREFERRED.map((p) => p.toLowerCase());
  banks.sort((a, b) => {
    const ia = pref.indexOf(a.toLowerCase()), ib = pref.indexOf(b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const b of banks) push({ label: `${b} · ${base}`, sound: base, bank: b });
  return out;
}
