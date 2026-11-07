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
