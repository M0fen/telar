// Proxy serverless que lista las VOCES de ElevenLabs (para el selector de voz IA).
// Devuelve id, nombre, etiquetas y preview_url (audio de muestra que el cliente
// reproduce SIN gastar cuota de síntesis). Clave solo en el servidor.
export default async function handler(req, res) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { res.status(500).json({ error: 'Falta ELEVENLABS_API_KEY' }); return; }
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) { res.status(r.status || 502).json({ error: 'no se pudieron listar las voces' }); return; }
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
