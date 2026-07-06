// V2 — mapa de energía del arreglo (lógica PURA, testeable en Node). La "energía" de una
// sección = cuántos sources quedan AUDIBLES en su escena (respeta solo/mute/gain). Sirve
// para ver de un vistazo si el arreglo respira (intro con aire) o si el drop está saturado
// (regla #1 del dancehall: dejar aire). No mide audio: lee el estado de mezcla capturado.

// Estructura mínima de una escena (desacoplado del store): estado de mezcla por nodeId.
export interface SceneLike {
  state?: Record<string, { mute?: boolean; solo?: boolean; gain?: number }>;
}

export interface SectionEnergy {
  active: number; // sources audibles
  total: number; // sources del grafo
  frac: number; // active / total (0..1) — altura de la barra
  captured: boolean; // false = la escena de esta sección no se ha capturado (sin datos)
}

export function sectionEnergy(scene: SceneLike | undefined, sourceIds: string[]): SectionEnergy {
  const total = sourceIds.length;
  if (!scene || !scene.state) return { active: 0, total, frac: 0, captured: false };
  const st = scene.state;
  // si algún source está en SOLO, solo esos suenan (el resto se silencia).
  const anySolo = sourceIds.some((id) => st[id]?.solo);
  let active = 0;
  for (const id of sourceIds) {
    const ss = st[id];
    const muted = ss?.mute ?? false;
    const gain = ss?.gain ?? 1; // sin dato = a nivel (sources no capturados suenan por defecto)
    const soloed = ss?.solo ?? false;
    if (!muted && gain > 0.02 && (!anySolo || soloed)) active++;
  }
  return { active, total, frac: total ? active / total : 0, captured: true };
}
