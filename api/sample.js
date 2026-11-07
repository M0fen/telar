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

// Solo se permite proxear buckets de R2 (público r2.dev o API S3 de cuenta). Con
// SAMPLE_HOSTS (hosts separados por coma) se limita además a esos buckets.
const ALLOWED = /^https:\/\/(?:[a-z0-9-]+\.r2\.dev|[a-z0-9]+\.r2\.cloudflarestorage\.com)\/.+/i;
function hostAllowed(url) {
  if (!ALLOWED.test(url)) return false;
  const only = (process.env.SAMPLE_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!only.length) return true;
  try { return only.includes(new URL(url).host.toLowerCase()); } catch { return false; }
}

// Lo que se reenvía se sirve desde el dominio de Telar: NUNCA como página o script. Solo
// audio conserva su tipo; lo demás sale como binario, sin olfateo y en un sandbox.
const SAFE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
};
function safeType(t) {
  const v = String(t || '').toLowerCase().split(';')[0].trim();
  return /^audio\/[a-z0-9.+-]+$/.test(v) || v === 'application/ogg' ? v : 'application/octet-stream';
}
function json(status, obj, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...SAFE_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}

// Candado por contraseña: si CLOUD_BANK_PW está configurada, cada petición debe traer la
// cookie cb_tok (HttpOnly, la pone el servidor al entrar: ?login=1 por POST). Guarda un
// HMAC de la contraseña, no la contraseña. Sin la env → abierto (retrocompatible).
// La cookie vieja cb_pw (la ponía el navegador con la contraseña tal cual) aún se acepta
// para no cortar a quien ya entró; el cliente la cambia por cb_tok y la borra.
const enc = new TextEncoder();
async function tokenFor(pw) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('telar-banco-nube-v1')));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function cookieOf(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.get('cookie') || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}
async function passwordOk(req) {
  const expected = process.env.CLOUD_BANK_PW;
  if (!expected) return true;
  const tok = cookieOf(req, 'cb_tok');
  if (tok && sameText(tok, await tokenFor(expected))) return true;
  return sameText(cookieOf(req, 'cb_pw'), expected);
}

// Solo para la propia Telar: un navegador moderno avisa si la petición viene de otro sitio.
function crossSite(req) {
  const s = req.headers.get('sec-fetch-site');
  return !!s && s !== 'same-origin' && s !== 'none';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: SAFE_HEADERS });
  const params = new URL(req.url).searchParams;
  if (crossSite(req)) return json(403, { error: 'origen no permitido' });

  // entrar: valida la contraseña y deja la cookie HttpOnly (el navegador no la puede leer)
  if (params.get('login')) {
    if (req.method !== 'POST') return json(405, { error: 'usa POST' });
    const expected = process.env.CLOUD_BANK_PW;
    let pw = '';
    try { const b = await req.json(); pw = typeof b?.pw === 'string' ? b.pw.slice(0, 200) : ''; } catch { /* */ }
    if (!expected) return json(200, { ok: true });
    if (!sameText(pw, expected)) return json(401, { ok: false });
    const cookie = `cb_tok=${await tokenFor(expected)}; Path=/api/sample; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`;
    return json(200, { ok: true }, { 'set-cookie': cookie });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'usa GET' });
  // sonda para validar la contraseña sin pedir un archivo (la usa el candado de la UI).
  if (params.get('probe')) {
    const ok = await passwordOk(req);
    return json(ok ? 200 : 401, { ok });
  }
  if (!(await passwordOk(req))) return json(401, { error: 'contraseña requerida' });
  const url = params.get('url');
  if (!url || !hostAllowed(url)) return json(400, { error: 'url no permitida (solo buckets Cloudflare R2)' });
  try {
    const range = req.headers.get('range');
    const upstream = await fetch(url, { method: req.method, headers: range ? { range } : {}, redirect: 'error' });
    const headers = new Headers(SAFE_HEADERS);
    headers.set('content-type', safeType(upstream.headers.get('content-type')));
    // los samples no cambian; con candado, solo en la caché de este navegador
    headers.set('cache-control', !upstream.ok ? 'no-store' : process.env.CLOUD_BANK_PW ? 'private, max-age=31536000, immutable' : 'public, max-age=31536000, immutable');
    for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(req.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
  } catch {
    return json(502, { error: 'no se pudo traer el sample de R2' });
  }
}
