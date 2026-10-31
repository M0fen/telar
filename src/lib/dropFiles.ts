// ARCHIVOS SOLTADOS (lienzo del grafo o decks del modo DJ): .mid → un Source por pista con su synth;
// audio → loop al tempo del tema si lo es (Fase 5.2), si no un sample a su tempo natural.
import { registerLocalSample } from '../audio/engine';
import { sampleDuration, sampleSourceCode } from './audioMeta';
import { addLoopToCanvas } from './warpActions';
import { addMidiToCanvas, isMidiFile } from './midiActions';
import { useGraphStore } from '../store/useGraphStore';

export const isAudioFile = (f: File) => !isMidiFile(f) && (f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|aac|m4a|webm)$/i.test(f.name));

export function importDroppedFiles(files: FileList | File[], at?: { x: number; y: number }): number {
  const list = Array.from(files);
  const base0 = at ?? { x: 120 + Math.random() * 260, y: 220 + Math.random() * 200 };
  for (const f of list.filter(isMidiFile)) void addMidiToCanvas(f, { x: base0.x - 60, y: base0.y - 30 });
  const audio = list.filter(isAudioFile);
  audio.forEach((f, i) => {
    const base = f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sample';
    const name = `local_${base}`.slice(0, 40);
    // Registrar ANTES de compilar (si no, el 1er compile no encuentra el sample → suena mudo) y
    // medir la duración: un sample LARGO va con su vuelta para no re-dispararse cada ciclo.
    void (async () => {
      const pos = { x: base0.x - 60 + i * 24, y: base0.y - 30 + i * 24 };
      if (await addLoopToCanvas(f, f.name, { pos }).catch(() => null)) return;
      await registerLocalSample(name, f).catch(() => {});
      const cps = useGraphStore.getState().cps || 0.5;
      const dur = await sampleDuration(URL.createObjectURL(f)).catch(() => 0);
      useGraphStore.getState().addPattern(sampleSourceCode(name, dur, cps), base, undefined, pos);
    })();
  });
  return list.filter(isMidiFile).length + audio.length;
}
