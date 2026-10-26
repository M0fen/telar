// MEDIDORES POR PISTA Y MARGEN (Fase 6.2) — lógica PURA (testeable en Node).
//
// Pico y RMS en dBFS de verdad (no el VU aproximado del nodo), retención del pico y la cuenta
// del «dejar margen»: cuánto bajar todas las pistas a la vez para que la suma llegue al máster
// con aire (−6 dBFS de pico), sin cambiar el balance entre ellas.

export const METER_FLOOR = -60;
export const METER_TOP = 6;

export function peakRmsDb(buf: Float32Array): { peak: number; rms: number } {
  let p = 0;
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    const a = v < 0 ? -v : v;
    if (a > p) p = a;
    s += v * v;
  }
  const rms = Math.sqrt(s / Math.max(1, buf.length));
  return { peak: p > 1e-9 ? 20 * Math.log10(p) : -Infinity, rms: rms > 1e-9 ? 20 * Math.log10(rms) : -Infinity };
}

// dBFS → 0…1 en el medidor (−60 … +6, lineal en dB)
export const dbToMeter = (db: number) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db - METER_FLOOR) / (METER_TOP - METER_FLOOR))) : 0);

// PICO RETENIDO = el máximo de los últimos `ms` (ventana deslizante). No «cae» a la cola entre
// golpes: con un bombo cada medio segundo siempre hay uno dentro de la ventana y el número queda
// quieto; si la pista se calla, baja cuando el último golpe sale de la ventana.
export class PeakWindow {
  private at: number[] = [];
  private db: number[] = [];
  constructor(private ms = 1500) {}
  push(db: number, now: number): number {
    // monótona: un valor nuevo descarta los menores que él (nunca volverán a ser el máximo)
    while (this.db.length && this.db[this.db.length - 1] <= db) { this.db.pop(); this.at.pop(); }
    this.db.push(db);
    this.at.push(now);
    while (this.at.length > 1 && now - this.at[0] > this.ms) { this.at.shift(); this.db.shift(); }
    return this.db[0];
  }
  reset(): void {
    this.at = [];
    this.db = [];
  }
}

// caída del RMS mostrado (balística de medidor): sube al instante, baja `rate` dB por segundo
export function fallDb(prev: number, cur: number, dtSec: number, rate = 20): number {
  if (!(cur < prev) || !Number.isFinite(prev)) return cur;
  const v = prev - rate * Math.max(0, Math.min(0.25, dtSec));
  if (v <= METER_FLOOR) return Number.isFinite(cur) ? Math.max(cur, METER_FLOOR) : -Infinity;
  return Math.max(cur, v);
}

// dBFS para leer: «−3.2», «+1.4», «−∞»
export function fmtDb(db: number): string {
  if (!Number.isFinite(db) || db <= METER_FLOOR) return '−∞';
  const r = Math.round(db * 10) / 10;
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(1);
}

// «dejar margen»: el factor (lineal) que multiplica TODAS las ganancias de pista para que el
// pico de la suma quede en `targetDb`. Solo BAJA (subir topa con el máximo de los faders y
// cambiaría el balance); 1 = no tocar (sin medida, o ya hay margen).
export const HEADROOM_TARGET_DB = -6;
export function headroomFactor(sumPeakDb: number, targetDb = HEADROOM_TARGET_DB): number {
  if (!Number.isFinite(sumPeakDb)) return 1;
  const d = targetDb - sumPeakDb;
  if (d > -0.5) return 1;
  return Math.pow(10, Math.max(-24, d) / 20);
}

// cómo llega la suma al máster: sin medida · con margen · justa · pasada de 0 dBFS
export type HeadroomState = 'none' | 'ok' | 'justo' | 'over';
export function headroomState(sumPeakDb: number, targetDb = HEADROOM_TARGET_DB): HeadroomState {
  if (!Number.isFinite(sumPeakDb) || sumPeakDb <= METER_FLOOR) return 'none';
  if (sumPeakDb > 0) return 'over';
  return headroomFactor(sumPeakDb, targetDb) < 1 ? 'justo' : 'ok';
}

// aplicar el factor a las ganancias de pista (0…1,5): devuelve las nuevas y si alguna topó
export function scaleGains(gains: number[], k: number): { gains: number[]; capped: boolean } {
  let capped = false;
  const out = gains.map((g) => {
    const v = (Number.isFinite(g) ? g : 1) * k;
    if (v > 1.5) { capped = true; return 1.5; }
    return Math.max(0, Math.round(v * 1000) / 1000);
  });
  return { gains: out, capped };
}

// lo mismo sobre el estado guardado por nodo (escenas): solo las pistas `ids` que traen gain
export function scaleStateGains<T extends { gain?: number }>(state: Record<string, T>, ids: Set<string>, k: number): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, s] of Object.entries(state)) {
    out[id] = ids.has(id) && typeof s.gain === 'number' ? { ...s, gain: scaleGains([s.gain], k).gains[0] } : s;
  }
  return out;
}
