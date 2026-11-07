// PRUEBA EN EL NAVEGADOR: abre la app ya compilada (npm run build), carga una plantilla, la hace
// sonar y exporta el tema. Atrapa lo que las pruebas de Node no ven: que la página arranque,
// que el motor suene y que la exportación entregue un archivo.
//   npm run build && npm run e2e
// Necesita Playwright con Chromium (npm i -D playwright && npx playwright install chromium).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Falta Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const fails = [];
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'OK   ' : 'FALLA'} ${name}${extra ? ' · ' + extra : ''}`); if (!cond) fails.push(name); };

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* */ } };
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('telar-tutorial-seen', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE);
  await page.waitForSelector('.react-flow', { timeout: 20000 });
  ok('la app arranca', true);

  await page.getByRole('button', { name: /proyecto ▾/ }).click();
  await page.locator('.pm-demo').first().click();
  await page.waitForTimeout(1500);
  const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('telar.project.v1') ?? 'null'); } catch { return null; } });
  ok('carga una plantilla', !!saved && Array.isArray(saved.nodes) && saved.nodes.length > 2, saved?.title ?? '');

  await page.mouse.click(720, 450);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => /live/.test(document.querySelector('.status-txt')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  ok('▶ suena', /live/.test((await page.locator('.status-txt').first().textContent()) ?? ''));
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('exportar el tema');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('[role="menuitem"]').first().click();
  const file = await dl.catch(() => null);
  ok('exporta el tema', !!file, file ? file.suggestedFilename() : 'sin descarga');

  ok('sin errores de página', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
} finally {
  stop();
}
if (fails.length) { console.error(`\n${fails.length} prueba(s) fallaron`); process.exit(1); }
console.log('\ntodo bien');
