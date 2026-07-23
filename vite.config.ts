import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { telarDownloader } from './vite-plugin-downloader';

// COOP/COEP: superdough puede necesitar SharedArrayBuffer en su AudioWorklet
// (master-prompt §7). Usamos COEP `credentialless` en vez de `require-corp`:
// mantiene crossOriginIsolated=true (SAB disponible) PERO permite cargar samples
// cross-origin sin CORP (github:..., shabda, URLs) que `require-corp` bloquea.
const COOP = 'same-origin';
const COEP = 'credentialless';

// Las rutas `api/*.js` (Nod-IA, copiloto, TTS, voces, shorten…) son FUNCIONES SERVERLESS
// de Vercel: el server de Vite NO las ejecuta, así que en `npm run dev` respondían 404 y
// Nod-IA moría con "no se pudo consultar a Nod-IA (404)". En dev las reenviamos al
// despliegue de producción, de modo que la ANTHROPIC_API_KEY siga viviendo SOLO en Vercel
// (nunca hace falta copiarla a tu equipo).
//
// El lookahead excluye `/api/yt/` y `/api/rec/`, que SÍ son locales: los sirve el plugin
// telarDownloader (yt-dlp corre en tu máquina). Sin esa exclusión, el descargador dejaría
// de funcionar en dev.
const API_UPSTREAM = process.env.TELAR_API_UPSTREAM || 'https://telar-livid.vercel.app';

export default defineConfig({
  plugins: [react(), telarDownloader()],
  server: {
    port: 5173,
    proxy: {
      '^/api/(?!yt/|rec/)': {
        target: API_UPSTREAM,
        changeOrigin: true,
        secure: true,
      },
    },
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
