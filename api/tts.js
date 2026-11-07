import { guard, readBody } from './_lib/guard.js';
// Proxy serverless de VOZ IA (ElevenLabs text-to-speech). La clave vive SOLO aquí
// como variable de entorno (ELEVENLABS_API_KEY) — nunca llega al navegador. Devuelve
// el audio (audio/mpeg) en éxito; JSON { error } en fallo. El cliente lo registra como
// sample local y lo abre en el estudio de voz (autotune / al-tempo / afinar).
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'usa POST' }); return; }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { console.error('[tts] falta ELEVENLABS_API_KEY'); res.status(503).json({ error: 'La voz IA no está disponible ahora.' }); return; }
  if (!(await guard(req, res, 'voz', { maxBody: 16 * 1024 }))) return;

  const body = readBody(req);
  const text = body && body.text;
  if (!text || typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'falta el texto' }); return; }
  if (text.length > 800) { res.status(413).json({ error: 'texto demasiado largo (máx. 800 caracteres)' }); return; }

  // voiceId: solo caracteres seguros; por defecto Sarah (multilingüe, natural).
  let voiceId = (body && body.voiceId) || 'EXAVITQu4vr4xnSDxMaL';
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) voiceId = 'EXAVITQu4vr4xnSDxMaL';
  const stability = clamp(num(body && body.stability, 0.4), 0, 1);
  const similarity = clamp(num(body && body.similarity, 0.75), 0, 1);
  const style = clamp(num(body && body.style, 0), 0, 1);

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.slice(0, 800),
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true },
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      console.error('[tts] ElevenLabs', r.status, j && JSON.stringify(j.detail || j.error || j).slice(0, 300));
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
