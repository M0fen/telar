// Catálogo CURADO de packs de sonidos (repos Strudel verificados que resuelven un
// strudel.json). Se cargan de un clic desde la galería de sonidos (SampleBrowser);
// tras cargar, sus nombres quedan disponibles como s("nombre") y aparecen
// categorizados por instrumento. Todos comprobados con HTTP 200 en su rama.
export interface CuratedPack {
  ref: string;       // referencia github:usuario/repo para loadSamplePack
  title: string;     // nombre corto para el chip
  desc: string;      // qué trae
  tags: string[];    // géneros/uso
}

export const CURATED_PACKS: CuratedPack[] = [
  { ref: 'github:tidalcycles/dirt-samples', title: 'dirt-samples', desc: 'El clásico: cientos de baterías, sintes, voces y fx (TidalCycles).', tags: ['batería', 'sintes', 'vox', 'fx'] },
  { ref: 'github:Bubobubobubobubo/dough-samples', title: 'dough', desc: 'Cajas de ritmo variadas (TR-808/909, LinnDrum…) listas para urbano/electrónica.', tags: ['drum-machines', 'batería'] },
  { ref: 'github:eddyflux/crate', title: 'crate', desc: 'Crate lo-fi / hip-hop: baterías cálidas y texturas con carácter.', tags: ['lo-fi', 'hip-hop', 'batería'] },
  { ref: 'github:switchangel/breaks', title: 'breaks', desc: 'Breakbeats para dnb, jungle y footwork — ideales para trocear.', tags: ['breaks', 'dnb', 'jungle'] },
  { ref: 'github:yaxu/clean-breaks', title: 'clean-breaks', desc: 'Breaks limpios y bien cortados, fáciles de rebanar (.slice/.chop).', tags: ['breaks', 'dnb'] },
  { ref: 'github:switchangel/pad', title: 'pads', desc: 'Pads y texturas atmosféricas para colchones y ambientes.', tags: ['pads', 'atmos', 'ambient'] },
  { ref: 'github:felixroos/samples', title: 'felix', desc: 'Instrumentos y misceláneos (pianos, teclados y más).', tags: ['instrumentos', 'teclados'] },
  // --- Añadidos (verificados HTTP 200 en su rama) ---
  { ref: 'github:mot4i/garden', title: 'garden', desc: 'Kit lo-fi completo: garden_bd/sd/hh/oh/cp/rim/toms + fx, strings y loops con carácter.', tags: ['lo-fi', 'batería', 'textura'] },
  { ref: 'github:Bubobubobubobubo/Dough-Amen', title: 'amen', desc: 'Amen breaks (amen1/2/3) para dnb, jungle y breakcore — trocéalos con .slice/.chop.', tags: ['breaks', 'dnb', 'jungle'] },
  { ref: 'github:salsicha/capoeira_strudel', title: 'capoeira', desc: 'Percusión de mundo: berimbau y golpes/loops de capoeira (hits, loops).', tags: ['percusión', 'mundo'] },
  { ref: 'github:TodePond/samples', title: 'todepond', desc: 'Voces y texturas atmosféricas (ooh, air, love, dark) para ganchos y ambientes.', tags: ['vox', 'atmos', 'textura'] },
  { ref: 'github:TristanCacqueray/mirus', title: 'mirus', desc: 'Foley y texturas experimentales (placas, agua, ambientes) para diseño sonoro.', tags: ['textura', 'fx', 'experimental'] },
  { ref: 'github:algorave-dave/samples', title: 'algorave-dave', desc: 'Loops y chops vocales/temáticos listos para algorave.', tags: ['loops', 'vox'] },
  // --- serie Dough (misma procedencia que dough-samples; verificados HTTP 200) ---
  { ref: 'github:Bubobubobubobubo/Dough-Fox', title: 'fox drums', desc: 'Batería oscura y contundente: fdarkkick, fclap y percusión — techno/EBM y urbano.', tags: ['batería', 'techno', 'oscuro'] },
  { ref: 'github:Bubobubobubobubo/Dough-Amiga', title: 'amiga', desc: 'Samples de tracker Amiga (STA3): acordes, bajos, cuerdas y hits vintage — retro/chip/synthwave.', tags: ['retro', 'chip', 'synthwave', 'instrumentos'] },
  { ref: 'github:Bubobubobubobubo/Dough-Juj', title: 'juj vox', desc: 'Fonemas/sílabas vocales para chops y texturas de voz — ganchos y ambientes.', tags: ['vox', 'chops', 'textura'] },
  // --- más gratis (verificados HTTP 200) ---
  { ref: 'github:felixroos/estuary-samples', title: 'estuary', desc: 'Colección amplia y variada: acordeón, bajos, cuerdas frotadas, plucks y percusión de mundo.', tags: ['instrumentos', 'mundo', 'perc'] },
  { ref: 'github:eddyflux/wax', title: 'wax', desc: 'Atmósferas, loops de sinte vintage (perrey/teentonic) y voces largas — lo-fi, textura, ambient.', tags: ['lo-fi', 'atmos', 'vox', 'textura'] },
  { ref: 'github:switchangel/beginningtrance', title: 'trance kit', desc: 'Vocales y elementos listos para trance/progressive (ctvox y más).', tags: ['trance', 'vox', 'elementos'] },
];
