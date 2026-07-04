import { registerSample } from '../audio/engine';
import { useDownloadsStore } from '../store/useDownloadsStore';
import { setVoiceUrl } from './voiceUrls';

// Registra una voz (blob de TTS/IA) de forma que sea EDITABLE en el estudio de voz:
//   1) como sample de Strudel (para que s("nombre") suene), vía objectURL;
//   2) como "pista" en downloadsStore con ESE MISMO objectURL — el VoiceStudio busca
//      el audio en downloadsStore (tracks.find(t => t.name === name) → fetch track.file)
//      para dibujar la ONDA y el preview. Sin (2), la voz suena pero no se ve la onda.
export async function registerAiVoice(name: string, blob: Blob, title = 'voz IA'): Promise<string> {
  const url = URL.createObjectURL(blob);
  setVoiceUrl(name, url); // registro propio (fuente de verdad de la onda en el estudio)
  await registerSample(name, url);
  useDownloadsStore.setState((s) =>
    s.tracks.some((t) => t.name === name)
      ? s
      : { tracks: [{ id: name, name, title, file: url, createdAt: Date.now() }, ...s.tracks] },
  );
  return url;
}
