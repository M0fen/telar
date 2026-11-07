// Guardia común de las funciones de /api que gastan dinero (Claude, ElevenLabs) o la
// reputación del dominio (acortador). Vercel no publica como función lo que empieza por `_`.
//
// 1) interruptor: TELAR_APIS_OFF=1 apaga todas; TELAR_AI_OFF=1 Nod-IA; TELAR_VOZ_OFF=1 voz y SFX.
// 2) origen: solo la propia Telar (mismo sitio) o los orígenes de TELAR_ORIGINS (coma).
// 3) tamaño del cuerpo.
// 4) límites por IP (por minuto y por día) y tope global diario por familia.
//    Con UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN los contadores son compartidos
//    entre instancias; sin ellos, viven en la memoria de cada instancia (mejor que nada).
//    Topes globales ajustables: TELAR_AI_DAILY_MAX, TELAR_VOZ_DAILY_MAX, TELAR_LINK_DAILY_MAX.

export const FAMILIES = {
  ai: { off: 'TELAR_AI_OFF', perMin: 6, perDay: 60, dailyEnv: 'TELAR_AI_DAILY_MAX', daily: 400, label: 'Nod-IA' },
  voz: { off: 'TELAR_VOZ_OFF', perMin: 4, perDay: 30, dailyEnv: 'TELAR_VOZ_DAILY_MAX', daily: 150, label: 'la voz IA' },
  voces: { off: 'TELAR_VOZ_OFF', perMin: 30, perDay: 300, dailyEnv: '', daily: 0, label: 'la lista de voces' },
  link: { off: '', perMin: 10, perDay: 100, dailyEnv: 'TELAR_LINK_DAILY_MAX', daily: 2000, label: 'el acortador' },
  errores: { off: '', perMin: 10, perDay: 60, dailyEnv: '', daily: 0, label: 'el registro de errores' },
};

const header = (req, name) => {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : typeof v === 'string' ? v : '';
};

export function allowedOrigins(req) {
  const own = header(req, 'x-forwarded-host') || header(req, 'host');
  const extra = (process.env.TELAR_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const hosts = new Set(extra.map((o) => { try { return new URL(o).host; } catch { return o; } }));
  if (own) hosts.add(own);
  return hosts;
}

// ¿La petición viene de la propia Telar? Fetch Metadata primero; si el navegador no lo
// manda (Safari viejo), el Origin o el Referer tienen que ser de un host permitido.
export function sameSite(req) {
  const hosts = allowedOrigins(req);
  const sfs = header(req, 'sec-fetch-site');
  if (sfs === 'same-origin') return true;
  for (const h of ['origin', 'referer']) {
    const v = header(req, h);
    if (!v || v === 'null') continue;
    try { return hosts.has(new URL(v).host); } catch { return false; }
  }
  return false;
}

export function clientIp(req) {
  const real = header(req, 'x-real-ip');
  if (real) return real.trim();
  const fwd = header(req, 'x-forwarded-for');
  return (fwd.split(',')[0] || '').trim() || req.socket?.remoteAddress || 'desconocida';
}

// ── contadores ────────────────────────────────────────────────────────────────
const mem = new Map(); // clave → { n, until }
function memIncr(key, ttlSec, now) {
  const cur = mem.get(key);
  if (!cur || cur.until <= now) { mem.set(key, { n: 1, until: now + ttlSec * 1000 }); return 1; }
  cur.n += 1;
  return cur.n;
}
function memSweep(now) {
  if (mem.size < 5000) return;
  for (const [k, v] of mem) if (v.until <= now) mem.delete(k);
}

async function upstashIncr(keys) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const cmds = [];
  for (const [k, ttl] of keys) { cmds.push(['INCR', k]); cmds.push(['EXPIRE', k, String(ttl)]); }
  try {
    const r = await fetch(url.replace(/\/+$/, '') + '/pipeline', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(cmds),
    });
    if (!r.ok) return null;
    const out = await r.json();
    return keys.map((_, i) => Number(out[i * 2]?.result) || 0);
  } catch { return null; }
}

export async function countHits(family, ip, now = Date.now()) {
  const f = FAMILIES[family];
  const day = new Date(now).toISOString().slice(0, 10);
  const minute = Math.floor(now / 60000);
  const keys = [[`telar:${family}:m:${ip}:${minute}`, 70], [`telar:${family}:d:${ip}:${day}`, 90000]];
  const dailyMax = f.dailyEnv ? Number(process.env[f.dailyEnv]) || f.daily : f.daily;
  if (dailyMax) keys.push([`telar:${family}:g:${day}`, 90000]);
  const shared = await upstashIncr(keys);
  memSweep(now);
  const n = shared ?? keys.map(([k, ttl]) => memIncr(k, ttl, now));
  return { perMin: n[0], perDay: n[1], global: dailyMax ? n[2] : 0, dailyMax };
}

function fail(res, status, error, extra = {}) {
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.status(status).json({ error });
  return false;
}

// Devuelve true si la petición puede seguir; si no, ya respondió.
export async function guard(req, res, family, { maxBody = 64 * 1024 } = {}) {
  const f = FAMILIES[family];
  if (process.env.TELAR_APIS_OFF === '1' || (f.off && process.env[f.off] === '1')) {
    return fail(res, 503, `${f.label} está en pausa por ahora. Vuelve a intentarlo más tarde.`);
  }
  if (!sameSite(req)) return fail(res, 403, 'origen no permitido');
  const len = Number(header(req, 'content-length')) || 0;
  if (len > maxBody) return fail(res, 413, 'petición demasiado grande');
  const hits = await countHits(family, clientIp(req));
  if (hits.perMin > f.perMin) return fail(res, 429, 'Demasiadas peticiones seguidas: espera un minuto.', { 'Retry-After': '60' });
  if (hits.perDay > f.perDay) return fail(res, 429, `Llegaste al límite de hoy para ${f.label}. Vuelve mañana.`, { 'Retry-After': '3600' });
  if (hits.dailyMax && hits.global > hits.dailyMax) return fail(res, 429, `${f.label} llegó a su límite de hoy. Vuelve mañana.`, { 'Retry-After': '3600' });
  return true;
}

// Error de un proveedor: el detalle va al registro del servidor, al usuario un mensaje genérico.
export function upstreamError(res, name, e, msg) {
  console.error(`[${name}]`, e && (e.status || ''), e && (e.message || e));
  return fail(res, 502, msg);
}

export function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body && typeof body === 'object' ? body : {};
}
