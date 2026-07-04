// Estética: underground / glitch / minimalista. Monospace técnico, fondo casi
// negro, un acento frío. El visualizador manda; todo lo demás flota en bajo
// contraste sobre él. (master-prompt §8)
export const tokens = {
  bg: '#050608',
  bgPanel: 'rgba(10, 13, 18, 0.72)',
  bgPanelSolid: '#0a0d12',
  grid: '#232d38', // puntos del fondo: visibles pero sutiles (efecto "pro")
  line: '#1b2530',
  text: '#c5d0d8',
  textDim: '#5d6b78',
  textFaint: '#39454f',
  accent: '#3df0d0', // cyan frío
  accentDim: '#1c6b60',
  warn: '#e0633a',
  edge: '#2a3a47',
  edgeActive: '#3df0d0',
  fontMono: "'IBM Plex Mono', ui-monospace, monospace",
  fontTech: "'Chakra Petch', 'IBM Plex Mono', monospace",
} as const;
