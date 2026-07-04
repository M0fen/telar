// Catálogo de contenido de Telar: la lista única y verídica de qué hay disponible
// para hacer música (samples, osciladores, señales, mini-notación, recetas). Lo
// consume la Guía en el sitio (ui/Guide.tsx) y se refleja en CONTENIDO.md (la
// referencia que lee la IA al componer). Verificado contra los packs que carga el
// prebake de engine.ts (felixroos/dough-samples). Mantener AMBOS en sync.

// --- Bancos de baterías (tidal-drum-machines) — se usan con .bank("Nombre") ---
// Hay 71 en total; aquí los más útiles. Cualquiera se invoca: s("bd sd hh").bank("…").
export const DRUM_MACHINES: string[] = [
  'RolandTR808', 'RolandTR909', 'RolandTR707', 'RolandTR727', 'RolandTR606', 'RolandTR505',
  'RolandCompurhythm1000', 'RolandCompurhythm78', 'LinnDrum', 'LinnLM1', 'LinnLM2', 'Linn9000',
  'AkaiMPC60', 'AkaiLinn', 'AkaiXR10', 'OberheimDMX', 'EmuDrumulator', 'EmuSP12', 'CasioRZ1',
  'CasioVL1', 'KorgKR55', 'KorgM1', 'KorgMinipops', 'BossDR55', 'BossDR110', 'AlesisHR16',
  'AlesisSR16', 'SimmonsSDS5', 'YamahaRX5', 'SequentialCircuitsDrumtracks',
];
export const DRUM_MACHINES_TOTAL = 71;

// Sonidos (abreviaturas) presentes en la mayoría de bancos. Sin .bank() suenan los
// del banco por defecto (EmuSP12): bd sd hh oh cp cb cr rim lt mt ht rd perc.
export const DRUM_SOUNDS: { abbr: string; name: string }[] = [
  { abbr: 'bd', name: 'bombo / kick' },
  { abbr: 'sd', name: 'caja / snare' },
  { abbr: 'hh', name: 'hi-hat cerrado' },
  { abbr: 'oh', name: 'hi-hat abierto' },
  { abbr: 'cp', name: 'palmada / clap' },
  { abbr: 'cr', name: 'crash' },
  { abbr: 'rd', name: 'ride' },
  { abbr: 'rim', name: 'rimshot / aro' },
  { abbr: 'cb', name: 'cencerro / cowbell (firma del phonk)' },
  { abbr: 'lt / mt / ht', name: 'toms (bajo / medio / alto)' },
  { abbr: 'sh', name: 'shaker' },
  { abbr: 'perc', name: 'percusión varia' },
];

// Otros packs de samples cargados (no-batería).
export const OTHER_SAMPLES: { pack: string; desc: string; sounds: string }[] = [
  { pack: 'piano', desc: 'piano acústico afinable con note()', sounds: 'piano' },
  { pack: 'vcsl (orquestal / mundo)', desc: 'instrumentos reales, afinables con note()', sounds: 'sax, organ/pipeorgan, harp, folkharp, harmonica, conga, bongo, darbuka, framedrum, timpani, ocarina, recorder, didgeridoo, siren, trainwhistle…' },
  { pack: 'mridangam', desc: 'percusión india (konnakol)', sounds: 'ta ka ki dhin na thom dhi tha dhum…' },
  { pack: 'Dirt-Samples (extras)', desc: 'texturas y FX', sounds: 'casio, metal, jazz, space, east, wind, insect, crow, numbers' },
  // packs realistas añadidos (nombres propios, no colisionan):
  { pack: 'crate (lo-fi / house)', desc: 'kit realista de eddyflux', sounds: 'crate_bd crate_sd crate_hh crate_cr crate_rim crate_sh crate_bell crate_clave crate_conga crate_bongo crate_djembe crate_stick crate_block' },
  { pack: 'clean-breaks (yaxu)', desc: 'breakbeats clásicos — usa .fit() / .chop() / .slice()', sounds: 'funkydrummer, apache, think, amen, sesame, kool, sport, neworleans, king, around, riffin…' },
  { pack: 'switchangel (_switch_angel)', desc: 'pad y breaks realistas de la inspiración de Telar', sounds: 'swpad (pad), breaks' },
];

// --- Osciladores del synth nativo (s("…") o synth panel) ---
export const WAVES: { id: string; name: string }[] = [
  { id: 'sine', name: 'senoidal (sub limpio)' },
  { id: 'sawtooth', name: 'sierra (brillante, ácido)' },
  { id: 'square', name: 'cuadrada (hueca, stabs)' },
  { id: 'triangle', name: 'triangular (suave, plucks)' },
  { id: 'supersaw', name: 'supersaw (con spread → reese/hoover)' },
];
// Wavetables propias de Telar (registradas como wt_telar_*).
export const WAVETABLES: string[] = ['wt_telar_organ', 'wt_telar_buzz', 'wt_telar_hollow', 'wt_telar_vocal', 'wt_telar_metal'];

// --- Señales de modulación (automatización sin tocar) ---
// Se usan crudas dentro de cualquier parámetro: lpf(sine.range(300,2000).slow(8)).
export const SIGNALS: { id: string; desc: string }[] = [
  { id: 'sine / cosine', desc: 'LFO suave 0..1 (con .range(a,b))' },
  { id: 'saw / isaw', desc: 'rampa ascendente / descendente' },
  { id: 'tri', desc: 'triangular' },
  { id: 'square', desc: 'on/off (gate)' },
  { id: 'rand', desc: 'aleatorio por evento' },
  { id: 'perlin', desc: 'ruido suave (orgánico)' },
  { id: 'white / pink / brown', desc: 'fuentes de ruido como s("white")' },
];

// --- Mini-notación (dentro de "…") ---
export const MININOTATION: { token: string; desc: string }[] = [
  { token: 'bd sd', desc: 'secuencia (un ciclo dividido)' },
  { token: 'bd*4', desc: 'repetir 4 veces' },
  { token: '~', desc: 'silencio' },
  { token: '[bd sd]', desc: 'subdivisión (caben en un paso)' },
  { token: '[bd,hh]', desc: 'capas a la vez (acorde / polirritmo)' },
  { token: '<a b c>', desc: 'alterna uno por ciclo' },
  { token: 'bd(3,8)', desc: 'ritmo euclídeo (3 de 8)' },
  { token: 'bd!3', desc: 'replica 3 (sin acelerar)' },
  { token: 'bd?', desc: 'probable (a veces suena)' },
  { token: 'c3 eb3 g3', desc: 'notas (con note("…"))' },
];

// --- Recetas por género (qué combinar) ---
export interface Recipe {
  genre: string;
  bpm: string;
  recipe: string;
}
export const RECIPES: Recipe[] = [
  { genre: 'techno alemán / hardtechno', bpm: '130–150', recipe: 'bd*4 con .shape; rumble = bd.speed(0.5).room(); sub atonal note("c1"); hats industriales hpf; stab disonante (tritono). sidechain + crush.' },
  { genre: 'EBM / darkwave', bpm: '120–140', recipe: 'bajo saw con lpenv + sidechain (el motor Schwefelgelb); pads supersaw oscuros; FM lead frío; tono menor/atonal.' },
  { genre: 'dembow latino / reggaetón', bpm: '90–100', recipe: 'bombo en 1 y 3 + caja en el patrón dembow (4·7·12·15) + hats; bajo sine/triangle con sidechain; stab menor (square). Banco RolandTR808. Ver kit "dembow riddim".' },
  { genre: 'phonk (memphis)', bpm: '130–150 (medio tiempo)', recipe: 'cencerro 808 AFINADO con note() (la firma); 808 saw distorsionado (.shape.coarse); hats trap (hh*8 hh*16); caja en el 3; master con crush (cinta lo-fi). Tono menor.' },
  { genre: 'dancehall', bpm: '90–110', recipe: 'one-drop (bombo+caja juntos en el 3), skank de teclado offbeat, percusión viva; bajo redondo. Banco LinnDrum/RolandTR808.' },
];
