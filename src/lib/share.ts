// Compartir por URL sin backend (Fase C): serializa el proyecto, lo comprime con
// gzip nativo del navegador (CompressionStream) y lo mete en el hash como base64url.
// Al abrir un enlace con #p=… se decodifica y se carga. Los samples locales
// (objectURL) no viajan en el enlace; el resto del patch sí.
import type { ProjectSnapshot } from './projectStore';

async function gzip(str: string): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(str));
  void writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(ab);
}

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// Construye un enlace compartible con el proyecto embebido en el hash.
export async function buildShareUrl(snap: Partial<ProjectSnapshot>): Promise<string> {
  const packed = toB64url(await gzip(JSON.stringify(snap)));
  return `${location.origin}${location.pathname}#p=${packed}`;
}

// Pide al proxy serverless (/api/shorten) un enlace corto (TinyURL) para el enlace
// largo. Se hace server-side porque los acortadores no exponen CORS y un fetch
// directo desde el navegador queda bloqueado. Devuelve null si la función no existe
// (p. ej. en `vite dev`, sin /api) o si el acortador falla → el llamador usa el largo.
export async function shortenUrl(longUrl: string): Promise<string | null> {
  try {
    const r = await fetch('/api/shorten?url=' + encodeURIComponent(longUrl));
    if (!r.ok) return null;
    const j = (await r.json()) as { short?: string };
    return j.short && /^https?:\/\//.test(j.short) ? j.short : null;
  } catch {
    return null;
  }
}

// Si la URL trae un proyecto (#p=…), lo decodifica. Devuelve null si no hay o falla.
export async function readSharedProject(): Promise<Partial<ProjectSnapshot> | null> {
  const m = /[#&]p=([^&]+)/.exec(location.hash);
  if (!m) return null;
  try {
    const json = await gunzip(fromB64url(m[1]));
    return JSON.parse(json) as Partial<ProjectSnapshot>;
  } catch (e) {
    console.warn('share: enlace inválido', e);
    return null;
  }
}

// Quita el #p=… de la barra sin recargar (tras cargar el proyecto compartido).
export function clearShareHash(): void {
  if (location.hash.includes('p=')) history.replaceState(null, '', location.pathname + location.search);
}
