import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { telarDownloader } from './vite-plugin-downloader';

// COOP/COEP: superdough puede necesitar SharedArrayBuffer en su AudioWorklet
// (master-prompt §7). Usamos COEP `credentialless` en vez de `require-corp`:
// mantiene crossOriginIsolated=true (SAB disponible) PERO permite cargar samples
// cross-origin sin CORP (github:..., shabda, URLs) que `require-corp` bloquea.
const COOP = 'same-origin';
const COEP = 'credentialless';

export default defineConfig({
  plugins: [react(), telarDownloader()],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': COOP,
      'Cross-Origin-Embedder-Policy': COEP,
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': COOP,
      'Cross-Origin-Embedder-Policy': COEP,
    },
  },
});
