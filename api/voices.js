import { guard } from './_lib/guard.js';
// Proxy serverless que lista las VOCES de ElevenLabs (para el selector de voz IA).
// Devuelve id, nombre, etiquetas y preview_url (audio de muestra que el cliente
// reproduce SIN gastar cuota de síntesis). Clave solo en el servidor.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'usa GET' }); return; }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { console.error('[voices] falta ELEVENLABS_API_KEY'); res.status(503).json({ error: 'La voz IA no está disponible ahora.' }); return; }
  if (!(await guard(req, res, 'voces'))) return;
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) { console.error('[voices] ElevenLabs', r.status); res.status(502).json({ error: 'no se pudieron listar las voces' }); return; }
    const voices = (j.voices || []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      preview: v.preview_url || '',
      // etiquetas útiles: género, edad, acento, caso de uso
      labels: v.labels ? Object.values(v.labels).filter(Boolean).slice(0, 4) : [],
      category: v.category || '',
    }));
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).json({ voices });
  } catch {
    res.status(502).json({ error: 'no se pudo contactar con ElevenLabs' });
  }
};
