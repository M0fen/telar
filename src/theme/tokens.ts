// Estética: underground / glitch / minimalista. Monospace técnico, fondo casi
// negro, un acento frío. El visualizador manda; todo lo demás flota en bajo
// contraste sobre él. (master-prompt §8)
//
// FUENTE DE VERDAD: el bloque :root de src/styles.css. Este módulo expone esa
// paleta a TS (canvas del visualizador, tema de CodeMirror, React Flow) leyendo
// las variables CSS en runtime. Los literales de FALLBACK deben ser IDÉNTICOS al
// :root — sirven para contextos sin DOM (tests en Node) y como red si la hoja aún
// no aplicó; tests/tokens.test.ts compara ambos y falla si vuelven a derivar.

const CSS_VARS = {
  bg: '--bg',
  bgPanel: '--panel',
  bgPanelSolid: '--panel-solid',
  grid: '--grid',
  line: '--line',
  text: '--text',
  textDim: '--dim',
  textFaint: '--faint',
  accent: '--accent',
  accentDim: '--accent-dim',
  warn: '--warn',
  edge: '--edge',
  edgeActive: '--edge-active',
  fontMono: '--mono',
  fontTech: '--tech',
} as const;

export type TokenKey = keyof typeof CSS_VARS;

export const FALLBACK: Record<TokenKey, string> = {
  bg: '#040506',
  bgPanel: 'rgba(12, 16, 22, 0.88)',
  bgPanelSolid: '#0a0d12',
  grid: '#232d38', // puntos del fondo: visibles pero sutiles (efecto "pro")
  line: '#202c38',
  text: '#d4dee6',
  textDim: '#6b7a88',
  textFaint: '#44515c',
  accent: '#3df0d0', // cyan frío
  accentDim: '#1c6b60',
  warn: '#e0633a',
  edge: '#2a3a47',
  edgeActive: '#3df0d0',
  fontMono: "'IBM Plex Mono', ui-monospace, monospace",
  fontTech: "'Chakra Petch', 'IBM Plex Mono', monospace",
};

// lectura perezosa con caché: la 1ª lectura buena (hoja aplicada) se congela; si
// la hoja aún no está (o no hay DOM), devuelve el fallback SIN cachear para poder
// recoger el valor real más tarde.
const cache: Partial<Record<TokenKey, string>> = {};
function read(key: TokenKey): string {
  const hit = cache[key];
  if (hit) return hit;
  if (typeof document === 'undefined') return FALLBACK[key];
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(CSS_VARS[key]).trim();
    if (v) { cache[key] = v; return v; }
  } catch { /* sin estilos aún */ }
  return FALLBACK[key];
}

export const tokens: Record<TokenKey, string> = Object.defineProperties(
  {} as Record<TokenKey, string>,
  Object.fromEntries(
    (Object.keys(CSS_VARS) as TokenKey[]).map((k) => [k, { get: () => read(k), enumerable: true }]),
  ),
);
