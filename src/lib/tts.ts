// Cliente de VOZ IA: lista las voces (con preview) desde /api/voices y pide el audio
// de un texto a /api/tts (proxy ElevenLabs). Devuelve Blob para registrarlo como
// sample local y trabajarlo en el estudio de voz.

export interface TtsVoice { id: string; name: string; tag: string; preview?: string }

// Fallback si /api/voices no responde (IDs estables curados).
export const FALLBACK_VOICES: TtsVoice[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', tag: 'f · segura' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', tag: 'f · con actitud' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', tag: 'f · cálida' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', tag: 'm · resonante' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', tag: 'm · enérgico' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', tag: 'm · urbano' },
];

let cache: TtsVoice[] | null = null;

export async function fetchVoices(): Promise<TtsVoice[]> {
  if (cache) return cache;
  try {
    const r = await fetch('/api/voices');
    const j = (await r.json().catch(() => null)) as { voices?: { id: string; name: string; preview?: string; labels?: string[] }[] } | null;
    if (r.ok && j && Array.isArray(j.voices) && j.voices.length) {
      cache = j.voices.map((v) => ({ id: v.id, name: v.name, tag: (v.labels || []).join(' · '), preview: v.preview }));
      return cache;
    }
  } catch {
    /* usa fallback */
  }
  cache = FALLBACK_VOICES;
  return cache;
}

export interface TtsOpts { voiceId: string; stability?: number; similarity?: number; style?: number }

export async function requestTts(text: string, opts: TtsOpts): Promise<Blob> {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...opts }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error((j && (j as { error?: string }).error) || 'no se pudo generar la voz');
  }
  return await r.blob();
}
