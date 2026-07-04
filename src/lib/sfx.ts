// Cliente de SFX GENERATIVO: pide a /api/sfx (proxy ElevenLabs sound-generation) un
// efecto por texto y lo devuelve como Blob para registrarlo como sample y crear un
// Source en la galería. Incluye plantillas de género para inspirar (un clic).
import { registerLocalSample } from '../audio/engine';

export interface SfxOpts { duration?: number | null; influence?: number; loop?: boolean }

export async function requestSfx(text: string, opts: SfxOpts = {}): Promise<Blob> {
  const r = await fetch('/api/sfx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...opts }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error((j && (j as { error?: string }).error) || 'no se pudo generar el sonido');
  }
  return await r.blob();
}

// Registra un SFX generado como sample local reproducible (`s("nombre")`). No pasa
// por downloadsStore (no es voz); es un one-shot para la galería.
export async function registerSfxSample(name: string, blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  await registerLocalSample(name, blob);
  return url;
}

// Plantillas por categoría (EDM/techno/gótico, alineadas con el Master show). Cada
// una es un prompt afinado + duración sugerida.
export interface SfxTemplate { label: string; text: string; duration: number | null; cat: string; loop: boolean }
export const SFX_TEMPLATES: SfxTemplate[] = [
  { cat: 'transición', label: 'riser tensión', text: 'dark uplifting riser sweep building tension, noise rising, cinematic', duration: 4, loop: false },
  { cat: 'transición', label: 'downlifter', text: 'reverse downlifter whoosh falling in pitch, dark', duration: 3, loop: false },
  { cat: 'impacto', label: 'impacto sub', text: 'huge cinematic sub boom impact hit with long tail, gothic', duration: 3, loop: false },
  { cat: 'impacto', label: 'metal hit', text: 'industrial metallic clang impact, reverb, techno', duration: 2, loop: false },
  { cat: 'percusión', label: 'kick techno', text: 'punchy analog techno kick drum one shot, tight', duration: 1, loop: false },
  { cat: 'percusión', label: 'clap oscuro', text: 'dark reverb clap one shot, EBM', duration: 1, loop: false },
  { cat: 'textura', label: 'drone gótico', text: 'dark ambient gothic drone texture, cold, evolving', duration: 8, loop: true },
  { cat: 'textura', label: 'lluvia noche', text: 'rain and distant thunder night ambience, moody', duration: 8, loop: true },
  { cat: 'foley', label: 'vinilo', text: 'vinyl crackle and dust texture loop, lo-fi', duration: 6, loop: true },
  { cat: 'foley', label: 'respiración', text: 'breathy vocal exhale texture, intimate', duration: 2, loop: false },
];
