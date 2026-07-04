// Registro name→URL de audios de VOZ (voz IA, demo Master show, futuras grabaciones).
// DESACOPLA el estudio de voz de `downloadsStore`, que en PRODUCCIÓN es dev-only
// (depende de endpoints /api/yt|rec/* que solo existen con el plugin de vite). Se
// rellena al registrar cada voz; el VoiceStudio lo consulta para dibujar la ONDA y el
// preview. Módulo simple (Map) porque la URL se fija ANTES de abrir el estudio.
const urls = new Map<string, string>();

export function setVoiceUrl(name: string, url: string): void {
  if (name && url) urls.set(name, url);
}
export function getVoiceUrl(name: string | null | undefined): string | null {
  return name ? urls.get(name) ?? null : null;
}
