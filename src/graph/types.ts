// Tipos de nodo del grafo. Todo cable transporta un Pattern (cables tipados,
// master-prompt §3). Los parámetros de un efecto se teclean en el nodo en v1.

export type NodeKind = 'source' | 'transform' | 'fx' | 'out';

// EQ paramétrico POR CANAL (3 bandas con ganancia en dB, boost y cut). No se emite
// en el código (superdough no tiene shelf/peak con ganancia): lo aplica el motor
// como filtros BiquadFilter reales sobre el bus (orbit) propio del canal, igual que
// el EQ del máster. low = low-shelf, mid = peaking (con frecuencia ajustable), high
// = high-shelf. `on` desactiva sin perder los valores.
export interface ChannelEq {
  on?: boolean;
  low?: number; // −15..+15 dB (shelf graves ~120 Hz)
  mid?: number; // −15..+15 dB (campana medios)
  high?: number; // −15..+15 dB (shelf agudos ~4.5 kHz)
  midFreq?: number; // 300..6000 Hz (centro de la campana de medios, def 1000)
}
export const DEFAULT_CHANNEL_EQ: ChannelEq = { on: false, low: 0, mid: 0, high: 0, midFreq: 1000 };
export function channelEqActive(eq: ChannelEq | undefined): boolean {
  if (!eq || eq.on === false) return false;
  return Math.abs(eq.low ?? 0) > 0.1 || Math.abs(eq.mid ?? 0) > 0.1 || Math.abs(eq.high ?? 0) > 0.1;
}

// Catálogo de operaciones para Transform y Filter/FX. Cada def describe cómo
// llamar al método sobre el Pattern de entrada y qué params teclea el usuario.
export interface OpParam {
  key: string;
  label: string;
  default: number | string;
  kind: 'number' | 'text';
  // rango para la perilla (solo params numéricos). scale 'exp' para frecuencias.
  min?: number;
  max?: number;
  step?: number;
  scale?: 'lin' | 'exp';
}

export interface OpDef {
  id: string;
  label: string;
  method: string; // método de Pattern a invocar (ej. 'lpf', 'fast', 'room')
  kind: 'transform' | 'fx';
  params: OpParam[];
  // Algunas ops toman un patrón/función como arg en vez de números (ej. jux(rev)).
  // Para esas usamos `code` que se inyecta crudo como argumento.
  rawArg?: string;
}

// Synth "tocable" (Fase 4 + expansión): oscilador + FM + ADSR + filtro con
// envolvente + vibrato + carácter (ruido/distorsión/coarse). Todo nativo del motor
// (superdough). Se aplica como sufijos al patrón del Source en el compilador.
// Capa de oscilador extra (multi-oscilador estilo Serum: OSC B, Sub…). Se SUMAN a OSC A
// (la onda principal `wave`) DENTRO de la misma voz, compartiendo filtro y envolvente.
export interface OscLayer {
  wave: string;    // onda de la capa (sawtooth|square|triangle|sine|supersaw|telar_*)
  level: number;   // nivel de mezcla 0..1
  octave?: number; // desplazamiento en octavas -2..+2 (sub = -1/-2)
  detune?: number; // desafinado fino en semitonos (engrosa/beating), p.ej. 0.1
}

export interface SynthParams {
  wave?: string; // sawtooth | square | triangle | sine | supersaw | telar_* (wavetable de morph)
  // oscilador / unísono (supersaw + wavetable) / carácter
  // --- MULTI-OSCILADOR: capas extra sumadas a OSC A (misma voz; filtro/envolvente comunes) ---
  levelA?: number;        // nivel de OSC A cuando hay capas (0..1); sin capas se ignora
  oscLayers?: OscLayer[]; // capas extra (OSC B, Sub…); vacío/undefined = un solo oscilador
  spread?: number; // ancho estéreo del unísono 0..1 (supersaw y wavetable de morph)
  unison?: number; // nº de voces 1..9 (grosor) (supersaw y wavetable de morph)
  detune?: number; // desafinado entre voces 0..0.5 (supersaw y wavetable de morph)
  // --- WAVETABLE de MORPH (wave = telar_*): posición del barrido entre cuadros ---
  wtpos?: number; // posición/morph estática 0..1 (cuál cuadro suena)
  wtpat?: string; // posición PATRONEABLE (p.ej. "0 .5 <.25 1>"); si está, pisa a wtpos → .wt("…")
  // --- ONDA PROPIA (editor de nodos): puntos {x∈[0,1], y∈[-1,1]} que dibujan una forma de
  // onda; se registra como wavetable de 1 cuadro `telar_user_<nodeId>`. Persistente. ---
  userWave?: { x: number; y: number }[];
  noise?: number; // mezcla de ruido en el oscilador 0..1
  pw?: number; // ancho de pulso (onda cuadrada/pulso) 0.01..0.99 (0.5 = simétrico)
  // afinación (desplaza la nota base del oscilador)
  octave?: number; // -3..+3 octavas
  semi?: number; // -12..+12 semitonos
  fine?: number; // -50..+50 cents (afinado fino)
  // FM (operador completo: índice + ratio + forma de onda del modulador + envolvente)
  fm?: number; // índice de modulación 0..8 (0 = sin FM)
  fmh?: number; // ratio armónico del modulador 0.5..8
  fmwave?: string; // forma de onda del modulador FM (sine|triangle|square|sawtooth)
  fmattack?: number; // envolvente del índice FM: ataque
  fmdecay?: number; // envolvente del índice FM: decay
  fmsustain?: number; // envolvente del índice FM: sostén (1 = FM constante)
  // envolvente de amplitud
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  // filtro paso-bajo + envolvente de filtro
  cutoff?: number; // 0 = sin filtro
  lpq?: number; // resonancia (0 = ninguna)
  ftype?: number; // tipo/pendiente del filtro: 0 = 12db, 1 = ladder (Moog), 2 = 24db
  lpenv?: number; // cantidad de envolvente de filtro en octavas (0 = ninguna)
  lpa?: number; // ataque de la envolvente de filtro
  lpd?: number; // decay de la envolvente de filtro
  // filtro paso-alto (carva graves — clave en pads/leads)
  hcutoff?: number; // 0 = off
  hpq?: number; // resonancia del paso-alto
  // envolvente de pitch (plucks, risers, kicks tonales)
  penv?: number; // semitonos de barrido (+/-)
  pdecay?: number; // decay de la envolvente de pitch
  // modulación
  vib?: number; // vibrato (Hz) 0..12
  vibmod?: number; // profundidad de vibrato (semitonos)
  phaser?: number; // phaser: rate en Hz (0 = off) — movimiento estéreo
  phaserdepth?: number; // profundidad del phaser 0..1
  // espacio (envíos) — imprescindible para pads
  room?: number; // reverb send 0..1
  roomsize?: number; // tamaño de la sala 0..10
  delay?: number; // eco send 0..1
  delayfb?: number; // realimentación del eco 0..0.9
  // tiempo del eco en FRACCIÓN DE CICLO (superdough delaysync: sincronizado al tempo).
  // 3/16 = corchea con puntillo (el dub delay clásico, default del motor).
  delaysync?: number;
  // salida
  pan?: number; // paneo 0..1 (0.5 = centro)
  // carácter
  drive?: number; // distorsión / saturación 0..1
  coarse?: number; // reducción de muestreo (1 = off, >1 lo-fi)
  // --- SAMPLE (cuando la fuente es s("kick") en vez de un oscilador): reproducción
  // de la muestra. El compilador los aplica SOLO si la fuente es un sample (no wave).
  speed?: number; // velocidad/pitch de reproducción (1 = natural; 0.25..4)
  reverse?: boolean; // reproduce el sample al revés (superdough: speed negativo)
  chop?: number; // trocea el sample en N partes (0 = off)
  loop?: number; // repite cada N ciclos (0 = off)
  // modo del loop: 'natural' = .slow (a su tempo real, manda el BPM del sample, sin
  // varispeed) · 'beat' = .loopAt (encaja al tempo del proyecto, varispeed → cambia pitch).
  loopMode?: 'natural' | 'beat';
  // --- MACRO de un mando (UI, no se emite): un solo knob morfea varios parámetros del
  // preset entre su valor base (0) y un objetivo (1). macroPreset = preset activo cuyo
  // macro se está usando (para saber base/target al interpolar).
  macro?: number; // posición del mando 0..1
  macroPreset?: string; // nombre del preset cuyo macro está activo
}

export const SYNTH_WAVES = ['sawtooth', 'square', 'triangle', 'sine', 'supersaw'] as const;
export const DEFAULT_SYNTH: SynthParams = {
  wave: 'sawtooth',
  spread: 0.4,
  unison: 5,
  detune: 0.18,
  wtpos: 0,
  levelA: 1,
  noise: 0,
  pw: 0.5,
  octave: 0,
  semi: 0,
  fine: 0,
  fm: 0,
  fmh: 1,
  fmwave: 'sine',
  fmattack: 0,
  fmdecay: 0,
  fmsustain: 1,
  ftype: 0,
  attack: 0.01,
  decay: 0.12,
  sustain: 0.6,
  release: 0.2,
  cutoff: 0,
  lpq: 0,
  lpenv: 0,
  lpa: 0.01,
  lpd: 0.12,
  hcutoff: 0,
  hpq: 0,
  penv: 0,
  pdecay: 0.1,
  vib: 0,
  vibmod: 0,
  phaser: 0,
  phaserdepth: 0.6,
  room: 0,
  roomsize: 2,
  delay: 0,
  delayfb: 0.4,
  delaysync: 3 / 16,
  pan: 0.5,
  drive: 0,
  coarse: 1,
  speed: 1,
  reverse: false,
  chop: 0,
  loop: 0,
  loopMode: 'natural',
  macro: 0,
};

// Editor de voz granular (sample): controles "tocables" sobre una grabación. Se
// aplican como sufijos al patrón del Source en el compilador (applyVoice).
export interface VoiceParams {
  position?: number; // begin 0..1 — scrub (dónde empieza a leer la muestra)
  grain?: number; // nº de granos (chop) — más granos = grano más pequeño
  speed?: number; // 0.25..4 — velocidad/pitch
  shape?: number; // 0..1 — saturación (waveshaping)
  spread?: number; // 0..1 — movimiento de paneo estéreo
  gain?: number; // 0..1.5
  vowel?: string; // '' | a e i o u — filtro de formante (vocal)
  loop?: number; // ciclos que abarca la voz (slow en natural / loopAt en granular)
  granular?: boolean; // false = natural (pitch real); true = granular (loopAt+chop)
  // "AL TEMPO" (fit al grid): encaja la voz en N ciclos cambiando la velocidad
  // (loopAt = varispeed, lee el cps EN VIVO → sigue los cambios de BPM). El tono
  // acompaña al tempo, como un sampler clásico (vocal chops). Prevalece sobre natural.
  tempo?: boolean;
  tempoCycles?: number; // ciclos que debe ocupar al encajar (def = loop)
  // AFINAR: pitch-shift espectral (phase-vocoder, control `stretch`) en SEMITONOS,
  // independiente de la velocidad. Sube/baja el tono sin recortar la duración.
  pitchShift?: number; // -12..+12 semitonos (0 = off)
  // melodía / autotune: re-afina la voz. Con `scale` los números de `melody` son
  // grados de la escala (snap = autotune); sin `scale`, `melody` son notas literales.
  melody?: string; // p.ej. "c4 eb4 g4" (notas) o "0 2 4 3" (grados, con scale)
  scale?: string; // '' | "C:minor" | "C:major" … — escala para el autotune
  room?: number; // 0..0.8 — reverb (espacio vocal)
  delay?: number; // 0..1 — eco / throw vocal
  // tiempo del eco vocal en FRACCIÓN DE CICLO (delaysync, sincronizado al tempo).
  // 3/16 = corchea con puntillo — el dub delay del dancehall (default del motor).
  delaysync?: number;
  polish?: boolean; // "pulir": paso-alto (quita retumbe) + compresor (nivela dinámica)
  harmony?: number; // doblaje/armonía en semitonos sobre la melodía (0 = off; 7=5ª, 12=8ª, -12=8ª↓)
  // GLIDE/portamento entre notas de la melodía (autotune "suave", tipo T-Pain →
  // Frank Ocean): desliza el pitch de una nota a la siguiente. 0 = snap duro
  // (robótico), >0 = deslizamiento. OJO: hoy se emite `.slide()`, que superdough
  // solo aplica en el synth zzfx → INERTE para la voz (sample). Portamento real
  // pendiente (pitch-env penv/pdecay como MelodicSeq, o legato entre notas).
  glide?: number; // 0..1 cantidad de portamento (0 = off; hoy INERTE, ver compile.ts)
  vibrato?: number; // 0..8 Hz de vibrato vocal (0 = off) — vida en notas sostenidas
  vibratoDepth?: number; // profundidad del vibrato en semitonos (def 0.3)
}
export const VOICE_VOWELS = ['a', 'e', 'i', 'o', 'u'] as const;
// Escalas para el autotune de voz (raíz C; el "tono" global desplaza la tonalidad).
export const VOICE_SCALES = [
  'C:major', 'C:minor', 'C:minor pentatonic', 'C:major pentatonic',
  'C:dorian', 'C:phrygian', 'C:mixolydian', 'C:harmonic minor',
] as const;
export const DEFAULT_VOICE: VoiceParams = {
  position: 0,
  grain: 8,
  speed: 1,
  shape: 0,
  spread: 0,
  gain: 1,
  vowel: '',
  loop: 1,
  granular: false,
  tempo: false,
  tempoCycles: 1,
  pitchShift: 0,
  melody: '',
  scale: '',
  room: 0,
  delay: 0,
};

export interface NodeData {
  kind: NodeKind;
  // source
  code?: string; // mini-notación, ej. s("bd*4")
  // transform / fx
  opId?: string;
  params?: Record<string, number | string>;
  // presentación: nombre a gusto del usuario + estado plegado (ahorra espacio).
  name?: string;
  collapsed?: boolean;
  showMix?: boolean; // muestra el mini-mezclador (gain + filtro) en el Source
  showTrim?: boolean; // muestra el recortador de forma de onda en el Source
  showTiles?: boolean; // muestra los "piano tiles" del instrumento
  showScope?: boolean; // muestra la onda (osciloscopio) del instrumento
  showSynth?: boolean; // muestra el panel de synth (solo UI, no cambia el sonido)
  synthOn?: boolean; // synth ACTIVO: el compilador aplica el timbre (switch / elegir onda)
  synth?: SynthParams; // parámetros del synth (forma de onda, ADSR, filtro)
  synthNote?: string; // nota/tonalidad base que toca el synth si el código no trae nota (def "c3")
  showVoice?: boolean; // muestra el editor de voz granular (sample)
  voice?: VoiceParams; // parámetros granulares de la voz (position, grain, …)
  begin?: number; // recorte: inicio de la región del sample (0..1)
  end?: number; // recorte: fin de la región del sample (0..1)
  // canal de mezcla (modo DJ): nivel, mute, solo y filtro DJ por source.
  gain?: number; // 0..1.5
  mute?: boolean;
  solo?: boolean; // aislado: si algún source tiene solo, los demás se silencian
  // AUDICIÓN DE SECCIÓN (transitorio, no debe sobrevivir a una carga): mientras el
  // source está en solo (preview del secuenciador), el compilador toca ESTE patrón
  // (el brazo del arrange que se edita, en loop) en vez del código completo — se
  // escucha la sección al instante, sin esperar a que el arreglo llegue a ella.
  seqPreviewCode?: string;
  chFilter?: number; // -1..1 : <0 lpf baja, >0 hpf sube
  chPan?: number; // paneo de canal 0..1 (0.5 = centro) — mezcla (colocación estéreo)
  chRoom?: number; // reverb send del canal 0..0.8 (halo de la superficie de mezcla, V3) — .room()
  eq?: ChannelEq; // EQ paramétrico 3 bandas del canal (aplicado por el motor sobre su orbit)
  // --- DJ mode (mixer de performance) ---
  xfa?: 'a' | 'b'; // asignación al crossfader (A/B); undefined = siempre suena (fuera del fader)
  // FX de performance MOMENTÁNEOS por deck (se sostienen mientras pulsas el botón),
  // aplicados por el compilador sobre la expresión de este source:
  perf?: {
    roll?: number; // .ply(n) — loop roll / beat-repeat (0 = off) · PATRÓN (frontera de ciclo)
    gate?: number; // gate rítmico (cortes por ciclo, 0 = off) · AUDIO (ganancia, al instante)
    echo?: number; // .delay(x) — echo throw (0 = off) · AUDIO (send, al instante)
    rev?: boolean; // .rev() — reverse throw · PATRÓN (frontera de ciclo)
    wash?: number; // .room(x) — reverb wash (0 = off) · AUDIO (send, al instante)
  };
  [key: string]: unknown;
}
