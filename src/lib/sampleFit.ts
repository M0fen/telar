// Reglas PURAS de reproducción de samples (sin dependencias del motor → testeables en
// Node). Las usan el drag, el generador de packs y el auto-encaje al Play.

// loopAt razonable para que un sample suene a velocidad natural al cps dado.
// Clampa a un rango finito y sensato (evita loopAt(Infinity) / valores absurdos).
export function naturalLoop(durationSec: number, cps: number): number {
  if (!isFinite(durationSec) || durationSec <= 0) return 8;
  const n = Math.round(durationSec * (cps || 0.5));
  return Math.max(1, Math.min(512, n));
}

// Código de Source para un sample que PUEDE ser largo. Un s("x") pelado se re-dispara
// cada ciclo; si el sample dura más que ~1 ciclo se solapa consigo mismo. Lo espaciamos
// con .slow(N) donde N = su duración en ciclos → se re-dispara justo al terminar: SIN
// solape y a su TEMPO NATURAL (manda el BPM del sample). NO usamos loopAt: loopAt hace
// varispeed (estira el sample para encajarlo → le cambia el tempo/pitch). N fraccionario
// = re-disparo exacto (loop natural continuo). Los one-shots cortos quedan como s("name").
export function sampleSourceCode(name: string, durationSec: number, cps: number): string {
  const c = cps || 0.5;
  const cycles = (durationSec || 0) * c;
  if (durationSec && cycles > 1.2) {
    const n = Math.max(1, Math.round(cycles * 100) / 100);
    return `s("${name}").slow(${n})`;
  }
  return `s("${name}")`;
}

// ¿El código es un ÚNICO sample PELADO (s("x")), opcionalmente ya con un .loopAt(x)/.slow(x)
// y nada más? Devuelve el nombre del sample o null. Lo usa el auto-encaje al Play para saber
// qué sources reparar (samples largos que se solapan) SIN tocar patrones (bd*4, "a b"),
// indexados (bd:3), ni cadenas con más métodos (.chop/.gain/…).
export function bareSampleName(code: string): string | null {
  const m = /^s(?:ound)?\(\s*(["'`])([A-Za-z0-9_]+)\1\s*\)(?:\.(?:loopAt|slow)\(\s*[0-9.]+\s*\))?$/.exec((code || '').trim());
  return m ? m[2] : null;
}
