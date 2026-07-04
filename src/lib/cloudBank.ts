import { registerSample } from '../audio/engine';
import { useUserSoundsStore } from '../store/useUserSoundsStore';
import { useCloudBankStore } from '../store/useCloudBankStore';

// Registro de samples de un banco propio en la nube (Cloudflare R2 u otro). El audio
// se sirve SIEMPRE por el proxy /api/sample (mismo dominio que Telar → sin CORS; la
// URL r2.dev no aplica CORS). Ver [[useCloudBankStore]] / api/sample.js.

// Une base + archivo y lo envuelve en el proxy. encodeURIComponent de la URL COMPLETA
// para que caracteres del nombre no rompan el query string.
export function cloudProxyUrl(baseUrl: string, file: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const full = `${base}/${file.trim().replace(/^\/+/, '')}`;
  return `/api/sample?url=${encodeURIComponent(full)}`;
}

// Nombre de sample válido para s("…") desde un filename: sin extensión, minúsculas,
// solo [a-z0-9_]. (R2 distingue mayúsculas en la CLAVE del archivo; el nombre es un alias.)
export function cloudName(file: string): string {
  return (
    file
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'sample'
  );
}

// Registra UN sample de la nube como s("name"). Devuelve el nombre usado.
export async function registerCloudItem(baseUrl: string, file: string, name?: string): Promise<string> {
  const nm = name || cloudName(file);
  await registerSample(nm, cloudProxyUrl(baseUrl, file)); // registerSample resuelve la URL relativa a same-origin
  useUserSoundsStore.getState().add(nm);
  return nm;
}

// Re-registra TODO el banco de nube guardado (al reproducir / arrancar). Idempotente:
// samples() sobre el mismo nombre es inofensivo. Un fallo suelto no corta el resto.
export async function registerCloudBank(): Promise<void> {
  const { baseUrl, items } = useCloudBankStore.getState();
  if (!baseUrl || !items.length) return;
  for (const it of items) {
    try {
      await registerCloudItem(baseUrl, it.file, it.name);
    } catch {
      /* un sample que falla no tumba el banco */
    }
  }
}
