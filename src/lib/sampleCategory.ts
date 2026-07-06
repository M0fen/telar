// Categorización de samples por INSTRUMENTO/rol (heurística por nombre). Lógica PURA
// (sin React ni @strudel/web) → testeable en Node. La usa la galería de sonidos
// (SampleBrowser) para agrupar los cientos de samples cargados en secciones.
//
// Los diccionarios son FRÁGILES a colisiones de substring: el orden de comprobación y
// qué lista contiene cada palabra importan. Los tests (tests/sampleCategory.test.ts)
// fijan el comportamiento para que ampliarlos no regrese sonidos a la sección equivocada.

export type SampleCat = 'kick' | 'snare' | 'hat' | 'cymbal' | 'perc' | 'bass' | 'inst' | 'synth' | 'vocal' | 'loop' | 'fx' | 'other';

// abreviaturas de baterías (dough-samples / cajas de ritmo): token EXACTO → familia.
export const ABBR: Record<string, SampleCat> = {
  bd: 'kick', kick: 'kick', kik: 'kick', bassdrum: 'kick', bassdrums: 'kick', kd: 'kick',
  sd: 'snare', sn: 'snare', snare: 'snare', snr: 'snare', rim: 'snare', rs: 'snare', rimshot: 'snare', cp: 'snare', clap: 'snare', clp: 'snare', claps: 'snare', snap: 'snare', snaps: 'snare', sidestick: 'snare', stick: 'snare',
  hh: 'hat', oh: 'hat', ch: 'hat', hat: 'hat', hats: 'hat', hihat: 'hat', hihats: 'hat', openhat: 'hat', closedhat: 'hat',
  cr: 'cymbal', rd: 'cymbal', cy: 'cymbal', crash: 'cymbal', ride: 'cymbal', cym: 'cymbal', splash: 'cymbal', china: 'cymbal',
  lt: 'perc', mt: 'perc', ht: 'perc', tom: 'perc', toms: 'perc', floortom: 'perc', rototom: 'perc', perc: 'perc', misc: 'perc', cb: 'perc', cowbell: 'perc',
  // percusión latina/mundo — abreviaturas y nombres exactos
  sh: 'perc', shaker: 'perc', shakers: 'perc', conga: 'perc', congas: 'perc', bongo: 'perc', bongos: 'perc', clave: 'perc', claves: 'perc', tabla: 'perc',
  timbale: 'perc', timbales: 'perc', timbal: 'perc', guiro: 'perc', cabasa: 'perc', agogo: 'perc', cuica: 'perc', surdo: 'perc', djembe: 'perc', darbuka: 'perc',
  maraca: 'perc', maracas: 'perc', tambourine: 'perc', tamb: 'perc', cajon: 'perc', woodblock: 'perc', castanet: 'perc', castanets: 'perc',
  click: 'perc', tick: 'perc', block: 'perc', tumba: 'perc', bata: 'perc', shekere: 'perc', pandeiro: 'perc', tamborim: 'perc',
};
// percusión latina/mundo como SUBSTRING (nombres compuestos: lat_conga, perc_guiro…).
// Se comprueba ANTES que instrumentos para que no se los coma 'bell'/'string'.
export const PERC_WORDS = ['conga', 'bongo', 'timbale', 'timbal', 'guiro', 'cabasa', 'agogo', 'cowbell', 'clave', 'tumba', 'djembe', 'darbuka', 'tabla', 'surdo', 'cuica', 'maraca', 'tambourine', 'woodblock', 'castanet', 'cajon', 'shaker', 'shekere', 'caxixi', 'ganza', 'pandeiro', 'tamborim', 'bata_', 'timbau'];
// TAGS de cultura / transiciones: air horn, sirena, pull-up, scratch, risers con nombre.
// Antes que instrumentos para que 'airhorn' no caiga en 'horn'.
export const TAG_WORDS = ['airhorn', 'air_horn', 'siren', 'rewind', 'pullup', 'pull_up', 'scratch', 'braam', 'downlifter', 'uplifter', 'whoosh', 'tapestop', 'tape_stop', 'shout', 'sub_drop', 'subdrop', 'gunshot'];
export const INST_WORDS = ['piano', 'guitar', 'guitarra', 'violin', 'viola', 'cello', 'contrabass', 'flute', 'flauta', 'sax', 'clarinet', 'oboe', 'bassoon', 'organ', 'marimba', 'kalimba', 'vibraphone', 'xylophone', 'glockenspiel', 'harp', 'arpa', 'strings', 'string', 'brass', 'trumpet', 'trompeta', 'horn', 'trombone', 'tuba', 'epiano', 'rhodes', 'wurli', 'wurlitzer', 'celesta', 'accordion', 'accordeon', 'acordeon', 'banjo', 'mandolin', 'koto', 'sitar', 'erhu', 'oud', 'harmonium', 'recorder', 'mallet', 'ukulele', 'steelpan', 'handpan', 'ocarina', 'melodica', 'bell', 'keys', 'cuerda', 'clav', 'clavinet'];
export const SYNTH_WORDS = ['synth', 'lead', 'stab', 'chord', 'pad', 'arp', 'saw', 'square', 'pluck', 'pluk', 'hoover', 'blip', 'bleep', 'chip', 'seq', 'poly', 'moog', 'juno', 'perrey', 'teentonic', 'pwm', 'fmlead', 'wavetable'];
export const BASS_WORDS = ['bass', 'bajo', 'sub', 'jvbass', '808bass', 'wobble', '808', 'reese', 'donk', 'acid', '303', 'fmbass', 'subbass', 'bassline', 'moogbass'];
export const VOX_WORDS = ['vox', 'voice', 'vocal', 'speak', 'voz', 'sing', 'choir', 'acapella', 'longvocal', 'ctvox', 'in_', 'adlib', 'phrase', 'word', 'chant', 'hey', 'yeah'];
export const LOOP_WORDS = ['amen', 'break', 'funkydrummer', 'apache', 'think', 'loop', 'drumloop', 'groove', 'beat', 'top', 'tumbao'];
export const FX_WORDS = ['fx', 'noise', 'wind', 'vinyl', 'riser', 'sweep', 'impact', 'atmos', 'atmosphere', 'space', 'metal', 'glitch', 'zap', 'laser', 'crackle', 'birds', 'insect', 'foley', 'ambient', 'drone', 'texture', 'reverse', 'coffee', 'water', 'rain', 'downlift', 'uplift', 'whoosh', 'boom', 'hit', 'siren', 'horn', 'scratch', 'drop', 'braam', 'buildup', 'build_up', 'stutter', 'swell', 'sfx'];

// último segmento del nombre (tras _:.-espacio), sin dígitos finales → token de familia.
export function instrToken(name: string): string {
  const p = name.toLowerCase().split(/[_:.\-\s]/);
  return (p.length > 1 ? p[p.length - 1] : name.toLowerCase()).replace(/\d+$/, '');
}

// Categoriza por INSTRUMENTO/rol. Orden de prioridad pensado para minimizar "otros":
// percusión exacta (abreviatura) → tags de cultura → bajo → percusión latina → instrumento
// real → sinte → voz → loop → fx. Los tags y la percusión van ANTES que 'inst' para que
// 'airhorn' no caiga en 'horn' ni 'cowbell' en 'bell'.
export function categorize(name: string): SampleCat {
  const low = name.toLowerCase();
  const t = instrToken(name);
  if (ABBR[t]) return ABBR[t];
  const has = (arr: string[]) => arr.some((w) => low.includes(w));
  if (has(TAG_WORDS)) return 'fx';
  if (has(BASS_WORDS)) return 'bass';
  if (has(PERC_WORDS)) return 'perc';
  if (has(INST_WORDS)) return 'inst';
  if (has(SYNTH_WORDS)) return 'synth';
  if (has(VOX_WORDS)) return 'vocal';
  if (has(LOOP_WORDS)) return 'loop';
  if (has(FX_WORDS)) return 'fx';
  return 'other';
}
