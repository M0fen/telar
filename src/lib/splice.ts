// Lectura de la convención de nombres de Splice para una importación "suave":
//   ARTIST_PACKCODE_[BPM]_[KEY]_nombre_descriptivo.wav
// - ARTIST y PACKCODE van en MAYÚSCULAS al inicio (se descartan del nombre visible).
// - BPM (tempo) en los archivos periódicos (loops/fills) → número 60–220.
// - Nota raíz o tonalidad (Cmin, C#maj, F, A#) en los tonales.
// - loop vs one-shot: por carpeta ("loop"/"one shot") y por tener BPM.
// Ref: https://www.creators.splice.com/file-naming
export interface SpliceMeta { clean: string; bpm?: number; note?: string; loop: boolean }

// raíz en MAYÚSCULA (Splice capitaliza la tonalidad: C, F#, Cmin, C#maj) → evita
// confundir artículos/palabras en minúscula ("a", "e") con notas.
const KEY_TOK = /^([A-G])([#b]?)(maj|min|major|minor)?$/;

export function parseSpliceName(fileName: string, relPath = ''): SpliceMeta {
  const base = fileName.replace(/\.[^.]+$/, '');
  const toks = base.split(/[_\-\s]+/).filter(Boolean);

  let bpm: number | undefined;
  for (const t of toks) { if (/^\d{2,3}$/.test(t)) { const n = Number(t); if (n >= 60 && n <= 220) { bpm = n; break; } } }

  // nota raíz / tonalidad → nota base en octava 2 (pitch natural del sampler = c2).
  let note: string | undefined;
  for (const t of toks) {
    const m = KEY_TOK.exec(t);
    if (m && t.length <= 6) { const acc = m[2] === 'b' ? 'b' : m[2] === '#' ? '#' : ''; note = `${m[1].toLowerCase()}${acc}2`; break; }
  }

  const path = (relPath || '').toLowerCase();
  const loop = /one[\s_-]?shot/.test(path) ? false : /loop|fill/.test(path) || bpm !== undefined;

  // nombre visible: descarta tokens CAPS iniciales (artista/pack), BPM y tonalidad.
  const out: string[] = [];
  let started = false;
  for (const t of toks) {
    const isBpm = /^\d{2,3}$/.test(t) && Number(t) >= 60 && Number(t) <= 220;
    const isKey = KEY_TOK.test(t) && t.length <= 6;
    const isCaps = /^[A-Z0-9]{2,}$/.test(t);
    if (!started) { if (isCaps || isBpm) continue; started = true; }
    if (isBpm || isKey) continue;
    out.push(t.toLowerCase());
  }
  let clean = out.join('_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!clean) clean = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sample';
  return { clean, bpm, note, loop };
}
