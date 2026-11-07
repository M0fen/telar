import { guard, readBody } from './_lib/guard.js';
// Proxy serverless de SFX GENERATIVO (ElevenLabs sound-generation). Genera efectos
// por TEXTO — risers, impactos, sub-drops, foley, one-shots — sin tener que buscar
// samples. La clave vive SOLO aquí (ELEVENLABS_API_KEY), nunca en el navegador.
// Devuelve audio/mpeg en éxito; JSON { error } en fallo. El cliente lo registra como
// sample local y crea un Source en la galería, listo para tocar/editar.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'usa POST' }); return; }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { console.error('[sfx] falta ELEVENLABS_API_KEY'); res.status(503).json({ error: 'La voz IA no está disponible ahora.' }); return; }
  if (!(await guard(req, res, 'voz', { maxBody: 16 * 1024 }))) return;

  const body = readBody(req);
  const text = body && body.text;
  if (!text || typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'falta la descripción del sonido' }); return; }
  if (text.length > 450) { res.status(413).json({ error: 'descripción demasiado larga (máx. 450 caracteres)' }); return; }

  // duración 0.5..22 s (límite del modelo); si no se pasa, el modelo la decide (auto).
  const duration = body && body.duration != null ? clamp(num(body.duration, 0), 0.5, 22) : null;
  // prompt_influence 0..1: cuánto se ciñe al texto (más alto = más literal, menos creativo).
  const influence = clamp(num(body && body.influence, 0.4), 0, 1);
  // loop: pide al modelo un sonido que empalme consigo mismo (útil para texturas/loops).
  const loop = !!(body && body.loop);

  const payload = {
    text: text.slice(0, 450),
    prompt_influence: influence,
    loop,
  };
  if (duration != null) payload.duration_seconds = duration;

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      console.error('[sfx] ElevenLabs', r.status, j && JSON.stringify(j.detail || j.error || j).slice(0, 300));
      const msg = r.status === 429 ? 'La voz IA está saturada: prueba en un momento.'
        : r.status === 400 || r.status === 422 ? 'ElevenLabs no aceptó ese texto: prueba a escribirlo de otra forma.'
          : 'La voz IA no está disponible ahora.';
      res.setHeader('Cache-Control', 'no-store');
      res.status(r.status === 429 ? 429 : 502).json({ error: msg });
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buf);
  } catch {
    res.status(502).json({ error: 'no se pudo contactar con ElevenLabs' });
  }
};

function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
