// Tap tempo (Fase A): registra pulsaciones y devuelve el cps resultante. Un tap
// = un beat (negra). Promedia los últimos intervalos; si pausas >2 s, reinicia.
// Lo usan el botón del Transport y la tecla T.
let taps: number[] = [];

export function tapTempo(): number | null {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; // pausa larga → reinicia
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
  const avgMs = sum / (taps.length - 1);
  const bpm = Math.max(40, Math.min(300, 60000 / avgMs));
  return bpm / 240; // cps = bpm / (60 * 4 tiempos por ciclo)
}
