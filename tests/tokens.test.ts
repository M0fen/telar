// Test anti-deriva de la paleta (P2.6 plataforma): el :root de src/styles.css es
// la fuente de verdad; src/theme/tokens.ts la expone a TS con fallbacks que deben
// ser IDÉNTICOS. Antes derivaron en silencio (el editor usaba texto #c5d0d8 y la
// UI #d4dee6) — este test hace que cualquier deriva futura rompa `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tokens, FALLBACK } from '../src/theme/tokens';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css');
const css = readFileSync(cssPath, 'utf8');

// extrae las variables del PRIMER bloque :root { … } de styles.css
function rootVars(src: string): Record<string, string> {
  const m = /:root\s*\{([\s\S]*?)\}/.exec(src);
  assert.ok(m, 'styles.css tiene un bloque :root');
  const out: Record<string, string> = {};
  for (const line of m![1].split('\n')) {
    const v = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line);
    if (v) out[v[1]] = v[2].trim();
  }
  return out;
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// mapa token TS → variable CSS (debe coincidir con CSS_VARS de tokens.ts)
const MAP: Record<string, string> = {
  bg: '--bg', bgPanel: '--panel', bgPanelSolid: '--panel-solid', grid: '--grid',
  line: '--line', text: '--text', textDim: '--dim', textFaint: '--faint',
  accent: '--accent', accentDim: '--accent-dim', warn: '--warn',
  edge: '--edge', edgeActive: '--edge-active', fontMono: '--mono', fontTech: '--tech',
};

test('paleta única: cada token TS existe como variable en el :root del CSS', () => {
  const vars = rootVars(css);
  for (const [key, cssVar] of Object.entries(MAP)) {
    assert.ok(vars[cssVar], `${cssVar} (token ${key}) declarado en :root`);
  }
});

test('anti-deriva: los fallbacks de tokens.ts son idénticos al :root del CSS', () => {
  const vars = rootVars(css);
  for (const [key, cssVar] of Object.entries(MAP)) {
    assert.equal(
      norm(FALLBACK[key as keyof typeof FALLBACK]),
      norm(vars[cssVar]),
      `token "${key}" debe coincidir con ${cssVar} de styles.css`,
    );
  }
});

test('en Node (sin DOM) tokens devuelve los fallbacks', () => {
  assert.equal(tokens.accent, FALLBACK.accent);
  assert.equal(tokens.bg, FALLBACK.bg);
  assert.equal(tokens.fontMono, FALLBACK.fontMono);
});
