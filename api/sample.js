// PROXY de samples autohospedados en Cloudflare R2.
//
// La URL pública de R2 (pub-xxxx.r2.dev) NO aplica la política CORS del bucket
// (limitación de Cloudflare: el CORS solo funciona con dominio propio). Por eso el
// navegador de Telar NO puede leer los audios directamente (fetch bloqueado). Este
// proxy corre en el MISMO dominio que Telar (→ sin CORS entre ellos), trae el audio
// de R2 (egreso $0 en R2) y lo reenvía con las cabeceras correctas.
//
// Edge runtime: streamea el cuerpo tal cual (sin el límite de 4.5 MB de las funciones
// Node) y reenvía Range (seek de audio). Restringido a hosts de R2 → NO es un proxy
// abierto (anti-SSRF).

export const config = { runtime: 'edge' };

// Solo se permite proxear buckets de R2 (público r2.dev o API S3 de cuenta).
const ALLOWED = /^https:\/\/(?:[a-z0-9-]+\.r2\.dev|[a-z0-9]+\.r2\.cloudflarestorage\.com)\/.+/i;

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'range, content-type',
    'access-control-expose-headers': 'content-length, content-range, accept-ranges',
  };
}

// Candado por contraseña: si CLOUD_BANK_PW está configurada en el entorno, cada petición
// debe traer la cookie cb_pw con ese valor. Sin la env → abierto (retrocompatible). La
// cookie viaja sola en peticiones same-origin (no va en la URL → no se filtra en logs).
function passwordOk(req) {
  const expected = process.env.CLOUD_BANK_PW;
  if (!expected) return true;
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)cb_pw=([^;]+)/.exec(cookie);
  const got = m ? decodeURIComponent(m[1]) : '';
  return got === expected;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'usa GET' }), { status: 405, headers: { ...cors(), 'content-type': 'application/json' } });
  }
  const params = new URL(req.url).searchParams;
  // sonda para validar la contraseña sin pedir un archivo (la usa el candado de la UI).
  if (params.get('probe')) {
    return new Response(JSON.stringify({ ok: passwordOk(req) }), {
      status: passwordOk(req) ? 200 : 401,
      headers: { ...cors(), 'content-type': 'application/json' },
    });
  }
  if (!passwordOk(req)) {
    return new Response(JSON.stringify({ error: 'contraseña requerida' }), { status: 401, headers: { ...cors(), 'content-type': 'application/json' } });
  }
  const url = params.get('url');
  if (!url || !ALLOWED.test(url)) {
    return new Response(JSON.stringify({ error: 'url no permitida (solo buckets Cloudflare R2)' }), { status: 400, headers: { ...cors(), 'content-type': 'application/json' } });
  }
  try {
    const range = req.headers.get('range');
    const upstream = await fetch(url, { method: req.method, headers: range ? { range } : {} });
    const headers = new Headers(cors());
    headers.set('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
    headers.set('cache-control', 'public, max-age=31536000, immutable'); // los samples no cambian
    for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(req.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response(JSON.stringify({ error: 'no se pudo traer el sample de R2' }), { status: 502, headers: { ...cors(), 'content-type': 'application/json' } });
  }
}
