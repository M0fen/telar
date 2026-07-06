// Catálogo CURADO de packs de sonidos (repos Strudel que resuelven un strudel.json). Se
// cargan de un clic desde la galería (SampleBrowser); tras cargar, sus nombres quedan como
// s("nombre") y aparecen categorizados. Todos comprobados con HTTP 200 en su rama.
//
// LICENCIAS (regla §0): la galería es PÚBLICA (se comparte por URL) → idealmente solo
// material redistribuible. `license` es el SPDX real (auditado con la API de GitHub) o
// 'NONE' (sin archivo de licencia = "todos los derechos reservados" por defecto). Ojo:
// la galería REFERENCIA los repos (no los rehospeda), pero el sharer debe saber qué es
// libre. Ver gallerySafe() y la nota en la UI. Verificados 2026-07-06.
export interface CuratedPack {
  ref: string;       // referencia github:usuario/repo para loadSamplePack
  title: string;     // nombre corto para el chip
  desc: string;      // qué trae
  tags: string[];    // géneros/uso
  license: string;   // SPDX (CC0-1.0, Unlicense, MIT, GPL-3.0…) o 'NONE'
}

// ¿la licencia permite redistribución (galería-segura)? CC0/dominio público/permisivas y
// copyleft (GPL permite redistribuir). 'NONE' = sin licencia → NO verificado como libre.
const REDIST = new Set(['CC0-1.0', 'Unlicense', 'MIT', 'BSD-3-Clause', 'Apache-2.0', 'GPL-3.0', 'GPL-2.0', 'AGPL-3.0', 'CC-BY-4.0', 'CC-BY-3.0']);
export function gallerySafe(license: string): boolean { return REDIST.has(license); }
// Etiqueta corta y legible de la licencia para la UI.
export function licenseNote(license: string): string {
  if (license === 'CC0-1.0' || license === 'Unlicense') return `${license} · dominio público`;
  if (license === 'NONE') return 'sin licencia · úsalo bajo tu criterio';
  return license;
}

export const CURATED_PACKS: CuratedPack[] = [
  // --- verificados CC0 / dominio público / permisiva (galería-seguros §0) ---
  { ref: 'github:cleary/samples-flbass', title: 'fl bass', desc: 'Bajos FL (flbass): sub, reese y tonos graves — trap, drift-phonk, EBM, dancehall.', tags: ['bajos', '808', 'trap', 'phonk'], license: 'CC0-1.0' },
  { ref: 'github:tidalcycles/uzu-drumkit', title: 'uzu drumkit', desc: 'Kit de batería completo y versátil: bd/sd/hh/oh, toms, platos, cowbell y un break.', tags: ['batería', 'kit'], license: 'Unlicense' },
  { ref: 'github:felixroos/estuary-samples', title: 'estuary', desc: 'Colección amplia y variada: acordeón, bajos, cuerdas frotadas, plucks y percusión de mundo.', tags: ['instrumentos', 'mundo', 'perc'], license: 'CC0-1.0' },
  { ref: 'github:switchangel/breaks', title: 'breaks', desc: 'Breakbeats para dnb, jungle y footwork — ideales para trocear.', tags: ['breaks', 'dnb', 'jungle'], license: 'Unlicense' },
  { ref: 'github:switchangel/pad', title: 'pads', desc: 'Pads y texturas atmosféricas para colchones y ambientes.', tags: ['pads', 'atmos', 'ambient'], license: 'Unlicense' },
  { ref: 'github:TodePond/samples', title: 'todepond', desc: 'Voces y texturas atmosféricas (ooh, air, love, dark) para ganchos y ambientes.', tags: ['vox', 'atmos', 'textura'], license: 'MIT' },
  { ref: 'github:Bubobubobubobubo/dough-samples', title: 'dough', desc: 'Cajas de ritmo variadas (TR-808/909, LinnDrum…) listas para urbano/electrónica.', tags: ['drum-machines', 'batería'], license: 'GPL-3.0' },
  // --- SIN LICENCIA explícita (§0: no verificado como redistribuible; para tus demos con
  //     criterio propio). La galería los referencia, no los rehospeda. ---
  { ref: 'github:tidalcycles/dirt-samples', title: 'dirt-samples', desc: 'El clásico: cientos de baterías, sintes, voces y fx (TidalCycles).', tags: ['batería', 'sintes', 'vox', 'fx'], license: 'NONE' },
  { ref: 'github:eddyflux/crate', title: 'crate', desc: 'Crate lo-fi / hip-hop: baterías cálidas y texturas con carácter.', tags: ['lo-fi', 'hip-hop', 'batería'], license: 'NONE' },
  { ref: 'github:yaxu/clean-breaks', title: 'clean-breaks', desc: 'Breaks limpios y bien cortados, fáciles de rebanar (.slice/.chop).', tags: ['breaks', 'dnb'], license: 'NONE' },
  { ref: 'github:felixroos/samples', title: 'felix', desc: 'Instrumentos y misceláneos (pianos, teclados y más).', tags: ['instrumentos', 'teclados'], license: 'NONE' },
  { ref: 'github:mot4i/garden', title: 'garden', desc: 'Kit lo-fi completo: garden_bd/sd/hh/oh/cp/rim/toms + fx, strings y loops con carácter.', tags: ['lo-fi', 'batería', 'textura'], license: 'NONE' },
  { ref: 'github:Bubobubobubobubo/Dough-Amen', title: 'amen', desc: 'Amen breaks (amen1/2/3) para dnb, jungle y breakcore — trocéalos con .slice/.chop.', tags: ['breaks', 'dnb', 'jungle'], license: 'NONE' },
  { ref: 'github:salsicha/capoeira_strudel', title: 'capoeira', desc: 'Percusión de mundo: berimbau y golpes/loops de capoeira (hits, loops).', tags: ['percusión', 'mundo'], license: 'NONE' },
  { ref: 'github:TristanCacqueray/mirus', title: 'mirus', desc: 'Foley y texturas experimentales (placas, agua, ambientes) para diseño sonoro.', tags: ['textura', 'fx', 'experimental'], license: 'NONE' },
  { ref: 'github:algorave-dave/samples', title: 'algorave-dave', desc: 'Loops y chops vocales/temáticos listos para algorave.', tags: ['loops', 'vox'], license: 'NONE' },
  { ref: 'github:Bubobubobubobubo/Dough-Fox', title: 'fox drums', desc: 'Batería oscura y contundente: fdarkkick, fclap y percusión — techno/EBM y urbano.', tags: ['batería', 'techno', 'oscuro'], license: 'NONE' },
  { ref: 'github:Bubobubobubobubo/Dough-Amiga', title: 'amiga', desc: 'Samples de tracker Amiga (STA3): acordes, bajos, cuerdas y hits vintage — retro/chip/synthwave.', tags: ['retro', 'chip', 'synthwave', 'instrumentos'], license: 'NONE' },
  { ref: 'github:Bubobubobubobubo/Dough-Juj', title: 'juj vox', desc: 'Fonemas/sílabas vocales para chops y texturas de voz — ganchos y ambientes.', tags: ['vox', 'chops', 'textura'], license: 'NONE' },
  { ref: 'github:eddyflux/wax', title: 'wax', desc: 'Atmósferas, loops de sinte vintage (perrey/teentonic) y voces largas — lo-fi, textura, ambient.', tags: ['lo-fi', 'atmos', 'vox', 'textura'], license: 'NONE' },
  { ref: 'github:switchangel/beginningtrance', title: 'trance kit', desc: 'Vocales y elementos listos para trance/progressive (ctvox y más).', tags: ['trance', 'vox', 'elementos'], license: 'NONE' },
];
