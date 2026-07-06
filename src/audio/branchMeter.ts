// V-infra — medición POR RAMA: nivel (RMS) + centroide espectral (centro de frecuencia)
// por source. Lo ALIMENTA meterEngine, que ya lee el analyser de cada source cada frame
// (`.analyze("telar-src-<id>")` va en TODOS los sources — engine/getSourceAnalyser); el
// centroide es el costo EXTRA y solo se calcula cuando `branchMetering` está activo (el
// nivel ya se computa para el VU/hilo). Consumo IMPERATIVO (V1b flujo por nivel real, V3
// superficie de mezcla) — NO es un store reactivo, para no re-renderizar por frame.

export interface BranchMetric {
  level: number; // 0..1 (RMS suavizado, el mismo del VU)
  centroid01: number; // 0..1 centro de frecuencia normalizado (log) — grave→agudo
  centroidHz: number; // Hz crudos
}

const metrics = new Map<string, BranchMetric>();
let enabled = false;
// El NIVEL es gratis (meterEngine ya lo calcula para el VU). El CENTROIDE (FFT + barrido
// de bins) es el costo real y SOLO lo usa V3 (superficie de mezcla) → se calcula únicamente
// mientras un consumidor lo pide (V3 abierto). Así, en producción con V3 cerrado, no hay
// costo de frecuencia aunque branchMetering esté on (que es el default).
let centroidDemand = 0;

export function setBranchMeteringEnabled(on: boolean): void {
  enabled = on;
  if (!on) metrics.clear(); // apagar = no-op real: se libera el mapa y meterEngine deja de escribir
}
export function isBranchMeteringOn(): boolean { return enabled; }

// Un consumidor del CENTROIDE (V3) lo pide al montar y lo suelta al desmontar (refcount).
export function requestCentroid(): void { centroidDemand++; }
export function releaseCentroid(): void { centroidDemand = Math.max(0, centroidDemand - 1); }
// ¿hay que calcular el centroide? Solo si la medición está on Y alguien lo pide.
export function isCentroidWanted(): boolean { return enabled && centroidDemand > 0; }

export function setBranchMetric(id: string, m: BranchMetric): void { metrics.set(id, m); }
export function getBranchMetric(id: string): BranchMetric | undefined { return metrics.get(id); }
export function getBranchMetrics(): ReadonlyMap<string, BranchMetric> { return metrics; }

// --- centroide espectral (PURO, testeable en Node) -----------------------------------
// centroide = media de los índices de bin ponderada por su magnitud → bin dominante.
// bin → Hz: bin * (sampleRate/2) / nBins.
export function spectralCentroid(freq: ArrayLike<number>, sampleRate: number): { hz: number; norm: number } {
  let num = 0, den = 0;
  for (let i = 0; i < freq.length; i++) { const m = freq[i]; num += i * m; den += m; }
  const bin = den > 0 ? num / den : 0;
  const hz = freq.length > 0 ? (bin * (sampleRate / 2)) / freq.length : 0;
  return { hz, norm: normHz(hz) };
}

// normaliza Hz a 0..1 en escala LOG (perceptual) entre ~60 Hz y ~12 kHz.
const F_LO = 60;
const F_HI = 12000;
export function normHz(hz: number): number {
  if (hz <= F_LO) return 0;
  if (hz >= F_HI) return 1;
  return (Math.log(hz) - Math.log(F_LO)) / (Math.log(F_HI) - Math.log(F_LO));
}
