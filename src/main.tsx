import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fuentes servidas desde Telar (antes Google Fonts: cada visita le pasaba la IP a Google).
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';
import { primeSavedProject } from './lib/projectStore';

// Tras publicar una versión, una pestaña vieja ya no encuentra las partes que carga después
// (los archivos cambian de nombre): en vez de fallar, se ofrece recargar.
function offerReload(): void {
  if (document.getElementById('nueva-version')) return;
  const b = document.createElement('div');
  b.id = 'nueva-version';
  b.setAttribute('role', 'alert');
  const t = document.createElement('span');
  t.textContent = 'Hay una versión nueva de Telar.';
  const r = document.createElement('button');
  r.type = 'button';
  r.textContent = 'recargar';
  r.addEventListener('click', () => location.reload());
  b.append(t, r);
  document.body.appendChild(b);
}
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); offerReload(); });
window.addEventListener('unhandledrejection', (e) => {
  const m = String((e.reason as { message?: unknown } | undefined)?.message ?? e.reason ?? '');
  if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(m)) offerReload();
});

// Los stores leen el proyecto guardado al crearse: primero se trae la copia más nueva
// (localStorage o IndexedDB) y solo después se carga la app.
async function boot(): Promise<void> {
  try { await primeSavedProject(); } catch { /* sigue con localStorage */ }
  const [{ default: App }, { ErrorBoundary }] = await Promise.all([import('./App'), import('./ui/ErrorBoundary')]);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary variant="app">
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
void boot();
