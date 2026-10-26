// Capa de audio: arranca Strudel (@strudel/web), mantiene el repl/scheduler y
// expone hot-swap del patrón maestro SIN reiniciar el reloj. (master-prompt §3, §7)
//
// La API de bajo nivel de Strudel está poco documentada; lo que sigue se
// verificó leyendo node_modules/@strudel/web/dist/index.mjs (v1.3.0):
//   - initStrudel(opts) -> Promise<repl>; repl.scheduler, repl.evaluate(code, autostart),
//     repl.stop(), repl.scheduler.setCps(...).
//   - evaluate(code) transpila + re-evalúa y reemplaza el patrón en el scheduler
//     en marcha → es el camino nativo de hot-swap (el reloj no se reinicia).
//   - getAnalyserById(id) devuelve un AnalyserNode de Web Audio; se crea cuando
//     un patrón aplica .analyze(id) y suena por primera vez.
import { ensureCompModule, compModuleReady, createCompNode, setCompParams, getOrbitGr, type CompRoute } from './chanComp';
import { initStrudel, getAudioContext, getAnalyserById, getSuperdoughAudioController, samples, initAudio, registerWaveTable } from '@strudel/web';
import { SRC_ANALYSER_PREFIX } from '../graph/compile';
import { ensureMasterLimiter, getMasterLimiterNode, limiterLatencyFrames, createLimiterFor } from './masterLimiter';

export const MASTER_ANALYSER_ID = 'telar-master';

// El transpiler de Strudel reescribe `slider(v,min,max)` → `sliderWithID(id,v,…)`,
// pero esa función SOLO existe en @strudel/codemirror (que no usamos). Sin un
// runtime, evaluar un slider lanza ReferenceError. Definimos el shim: devuelve un
// Pattern constante con el valor (reify) para permitir encadenar .mul().pow() como
// hacen los artistas de algorave. El valor vive en el TEXTO del código; el widget
// del editor lo reescribe al arrastrar → recompila → suena en vivo. (Fase 1 slides)
function installSliderRuntime(): void {
  const g = globalThis as unknown as {
    sliderWithID?: (id: string, value: number) => unknown;
    reify?: (v: number) => unknown;
    pure?: (v: number) => unknown;
  };
  if (g.sliderWithID) return;
  g.sliderWithID = (_id: string, value: number) => {
    // Pattern constante para permitir encadenar .mul()/.pow(); si por alguna razón
    // no hay helper global, devolvemos el número (funciona en .lpf(x) sin cadena).
    if (typeof g.reify === 'function') return g.reify(value);
    if (typeof g.pure === 'function') return g.pure(value);
    return value;
  };
}

// --- MIDI out (WebMIDI nativo) ---------------------------------------------
// No usamos @strudel/midi: trae su PROPIA copia de @strudel/core, y @strudel/web
// inlinea OTRA, así que `.midi()` se registraría en un Pattern distinto al que
// evalúa el repl. En su lugar parcheamos `.midi()` sobre el Pattern REAL de web
// vía `onTrigger` y enviamos con la WebMIDI API nativa. (Tier 2)
type MidiOutPort = { name?: string; send: (d: number[], t?: number) => void };
type MidiInPort = { name?: string; onmidimessage: ((e: { data: Uint8Array }) => void) | null };
let midiAccess:
  | { outputs: Map<string, MidiOutPort>; inputs?: Map<string, MidiInPort>; onstatechange?: (() => void) | null }
  | null = null;

export async function enableMidi(): Promise<string[]> {
  try {
    const nav = navigator as unknown as { requestMIDIAccess?: (o?: object) => Promise<typeof midiAccess> };
    if (!nav.requestMIDIAccess) throw new Error('WebMIDI no soportado en este navegador');
    midiAccess = await nav.requestMIDIAccess({ sysex: false });
    return getMidiOutputs();
  } catch (e) {
    reportError(e);
    return [];
  }
}
export function isMidiEnabled(): boolean {
  return !!midiAccess;
}
export function getMidiOutputs(): string[] {
  if (!midiAccess) return [];
  return Array.from(midiAccess.outputs.values()).map((o) => o.name ?? 'midi');
}
function getMidiOutput(name?: string) {
  if (!midiAccess) return undefined;
  const outs = Array.from(midiAccess.outputs.values());
  if (!name) return outs[0];
  return outs.find((o) => o.name === name) ?? outs[0];
}

// --- MIDI IN (WebMIDI nativo) ----------------------------------------------
// Entrada de controlador para el modo EN VIVO (pads/perillas → control, no audio).
// Reusa el MISMO `midiAccess` que la salida; enlaza `onmidimessage` en cada input
// y lo re-enlaza en `onstatechange` (conectar/desconectar en caliente, p. ej. el
// M-Wave por USB). El parseo y el ruteo viven en `src/audio/midiIn.ts`.
let midiInHandler: ((data: Uint8Array) => void) | null = null;
function bindMidiInputs(): void {
  if (!midiAccess || !midiAccess.inputs) return;
  midiAccess.inputs.forEach((i) => {
    i.onmidimessage = (e) => {
      try {
        if (midiInHandler) midiInHandler(e.data);
      } catch {
        /* un handler que lance no debe tumbar el MIDI */
      }
    };
  });
}
export function getMidiInputs(): string[] {
  if (!midiAccess || !midiAccess.inputs) return [];
  return Array.from(midiAccess.inputs.values()).map((i) => i.name ?? 'midi');
}
// Devuelve los nombres de las entradas, o null si NO se pudo abrir el MIDI (permiso negado,
// navegador sin WebMIDI) — antes devolvía [] y el panel se mostraba «conectado» sin estarlo.
// onChange avisa al enchufar/desenchufar un controlador después de conectar.
export async function startMidiInput(onMsg: (data: Uint8Array) => void, onChange?: (inputs: string[]) => void): Promise<string[] | null> {
  midiInHandler = onMsg;
  try {
    const nav = navigator as unknown as { requestMIDIAccess?: (o?: object) => Promise<typeof midiAccess> };
    if (!nav.requestMIDIAccess) throw new Error('WebMIDI no soportado en este navegador');
    if (!midiAccess) midiAccess = await nav.requestMIDIAccess({ sysex: false });
    bindMidiInputs();
    if (midiAccess) midiAccess.onstatechange = () => { bindMidiInputs(); try { onChange?.(getMidiInputs()); } catch { /* UI */ } };
    return getMidiInputs();
  } catch (e) {
    reportError(e);
    return null;
  }
}

const MIDI_NOTE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function nameToMidi(s: string): number {
  const m = /^([a-gA-G])([#sb]?)(-?\d+)?$/.exec(s.trim());
  if (!m) return 60;
  let n = MIDI_NOTE[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === 's') n++;
  else if (m[2] === 'b') n--;
  return n + ((m[3] != null ? parseInt(m[3], 10) : 3) + 1) * 12;
}

// Parchea `.midi(device?, channel?)` sobre el Pattern de web. El callback de
// onTrigger recibe (hap, currentTime, cps, deadline) — verificado leyendo el repl
// de @strudel/web. deadline está en tiempo del AudioContext; lo convertimos al reloj
// de WebMIDI (performance.now). dominantTrigger=true → MIDI puro (sin audio local).
function installMidiRuntime(): void {
  const g = globalThis as unknown as { reify?: (v: number) => { constructor: { prototype: Record<string, unknown> } } };
  const proto = typeof g.reify === 'function' ? g.reify(0)?.constructor?.prototype : undefined;
  if (!proto || proto.midi) return;
  proto.midi = function (this: { onTrigger: (fn: unknown, dom: boolean) => unknown }, device?: string, channel = 1) {
    return this.onTrigger(
      (hap: { value?: Record<string, unknown>; whole?: { begin: number; end: number }; part?: { begin: number; end: number } }, _t: number, cps: number, deadline: number) => {
        const out = getMidiOutput(device);
        if (!out) return;
        const v = hap.value ?? {};
        let note = 60;
        if (typeof v.note === 'number') note = Math.round(v.note);
        else if (typeof v.note === 'string') note = nameToMidi(v.note);
        else if (typeof v.n === 'number') note = 60 + Math.round(v.n);
        const ch = Math.max(1, Math.min(16, Math.round((v.midichan as number) ?? channel))) - 1;
        // el fader de canal llega como velocity (multiplica al gain del evento)
        const vel = Math.max(1, Math.min(127, Math.round(((v.gain as number) ?? 0.9) * ((v.velocity as number) ?? 1) * 127)));
        const span = hap.whole ?? hap.part;
        const durMs = Math.max(20, ((span ? span.end - span.begin : 0.25) / cps) * 1000);
        const tOn = performance.now() + Math.max(0, deadline - getAudioContext().currentTime) * 1000;
        try {
          out.send([0x90 + ch, note, vel], tOn);
          out.send([0x80 + ch, note, 0], tOn + durMs);
        } catch {
          /* dispositivo desconectado */
        }
      },
      true
    );
  };
}

// Forma mínima de un hap consultado del patrón (para el resaltado).
export interface Hap {
  hasOnset: () => boolean;
  whole?: { begin: number; end: number };
  context?: { locations?: { start: number; end: number }[] };
}
export interface Scheduler {
  setCps: (cps: number) => void;
  started: boolean;
  now: () => number;
  cps: number;
  pattern?: { queryArc: (b: number, e: number, opts?: object) => Hap[] };
}

type Repl = {
  scheduler: Scheduler;
  evaluate: (code: string, autostart?: boolean) => Promise<unknown>;
  stop: () => void;
  start?: () => void | Promise<void>;
};

let replPromise: Promise<Repl> | null = null;
let repl: Repl | null = null;
let started = false;

// Strudel atrapa los errores de evaluación/scheduler internamente (sólo
// console.error) y nunca los relanza. Los enrutamos aquí para mostrarlos en la
// UI; sin esto, un patrón roto falla en silencio.
type ErrorListener = (msg: string | null) => void;
let errorListener: ErrorListener | null = null;
export function onEngineError(cb: ErrorListener): void {
  errorListener = cb;
}
function reportError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  errorListener?.(msg);
}
function clearError(): void {
  errorListener?.(null);
}

// initStrudel hace initAudioOnFirstClick(): el AudioContext sólo se reanuda tras
// un gesto del usuario (autoplay policy). Llamamos esto en el primer Play.
export async function ensureEngine(): Promise<Repl> {
  if (!replPromise) {
    replPromise = (async () => {
      const r = (await initStrudel({
        // Callbacks de error del repl (PM → DX): onEvalError se dispara cuando un
        // patrón no compila; onSchedulerError cuando falla en marcha.
        onEvalError: (e: unknown) => reportError(e),
        onSchedulerError: (e: unknown) => reportError(e),
        // MISMO prebake que strudel.cc: carga el bundle felixroos/dough-samples.
        // Crítico para fidelidad: `s("bd:4")`, `s("metal:2")`, `s("amen")`, etc.
        // indexan en ESTOS mapas; cargar otro repo (p.ej. tidalcycles/dirt-samples)
        // cambia qué muestra suena para el mismo índice. Los sintes (sawtooth,
        // triangle, square…) ya los registra mM() dentro de initStrudel.
        prebake: async () => {
          const ds = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/';
          // Base fiel a strudel.cc (dough-samples) + packs ADITIVOS de nombres
          // propios (no colisionan con los índices existentes) para sonidos más
          // realistas: crate (kit lo-fi/house), pads y breaks de _switch_angel
          // (inspiración de Telar) y clean-breaks de yaxu (breakbeats clásicos:
          // funkydrummer/apache/think…). allSettled: un pack que falle no tumba al
          // resto. Solo baja los JSON (metadatos); el audio se carga al reproducir.
          await Promise.allSettled([
            samples(`${ds}tidal-drum-machines.json`),
            samples(`${ds}piano.json`),
            samples(`${ds}Dirt-Samples.json`),
            samples(`${ds}EmuSP12.json`),
            samples(`${ds}vcsl.json`),
            samples(`${ds}mridangam.json`),
            samples('github:eddyflux/crate'),
            samples('github:switchangel/pad'),
            samples('github:switchangel/breaks'),
            samples('github:yaxu/clean-breaks'),
          ]);
        },
      })) as unknown as Repl;
      repl = r;
      installSliderRuntime();
      installMidiRuntime(); // parchea .midi() sobre el Pattern de web
      return r;
    })();
  }
  return replPromise;
}

// Init COMPLETA de superdough (initAudio = `ho` del dist): reanuda el AudioContext
// Y CARGA los AudioWorklets de DSP (efectos: crush/coarse/shape, delay con
// feedback, etc.). Crítico: initStrudel sólo agenda esto para el primer mousedown
// y NO lo espera, así que el primer patrón sonaba sin esos efectos —"ajeno a la
// realidad" (issue uzu/strudel #1721). Lo llamamos y lo ESPERAMOS dentro del
// gesto de Play, antes de evaluar, para que el sonido sea idéntico a strudel.cc.
let audioReady: Promise<void> | null = null;
export async function ensureAudioReady(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  if (!audioReady) audioReady = Promise.resolve(initAudio()).then(() => void 0);
  await audioReady;
  // compresor por canal (Fase 6.1): su procesador, listo antes de armar las tiras de canal
  if (await ensureCompModule(ctx)) applyChannelEqs();
}

export function getAudioState(): AudioContextState | 'uninitialized' {
  try {
    return getAudioContext().state;
  } catch {
    return 'uninitialized';
  }
}

// Hot-swap del patrón maestro. `code` es JS válido que compone Patterns; le
// añadimos el tap del visualizador. autostart=true arranca el scheduler la
// primera vez y lo deja correr en swaps posteriores.
//
// El cps se fija FUERA del código evaluado: inyectar `setcps(x)\n(patrón)` pegaba
// ambas líneas como `setcps(x)(patrón)` (ASI de JS, el patrón empieza con "(")
// → intentaba llamar el retorno de setcps → error silencioso. Lección del §3:
// verificar el comportamiento real de la API antes de asumir.
// cps base de strudel.cc. `.cpm()`/`.cps()` se definen RELATIVOS a este valor
// (cpm(n) = _fast(n/60/cps)). Para reproducir fielmente un patrón que ya fija su
// tempo con cpm, el cps base debe ser el mismo que en strudel.cc.
const STRUDEL_DEFAULT_CPS = 0.5;
const SETS_OWN_TEMPO = /\b(cpm|cps|setcps|setcpm)\s*\(/;

// ÉPOCA DEL TRANSPORTE: cada ■ la avanza. Un swap que estaba evaluando cuando llegó el ■ NO
// vuelve a arrancar el reloj: con autostart, el evaluate de Strudel lo reanudaba solo al
// terminar → el tema seguía sonando con el transporte en ■ (pasaba al parar el jam, que arma
// la canción y para en el mismo instante) y la siguiente exportación salía corrida.
let stopEpoch = 0;

export async function swapPattern(code: string, cps: number): Promise<void> {
  const epoch = stopEpoch;
  const r = await ensureEngine();
  if (epoch !== stopEpoch) return; // ■ mientras arrancaba el motor
  // Si el código ya fija su tempo (p.ej. .cpm(150/4)), respetamos el cps base de
  // strudel.cc para que suene igual; si no, mandamos el cps del transporte.
  r.scheduler.setCps(SETS_OWN_TEMPO.test(code) ? STRUDEL_DEFAULT_CPS : cps);
  // NO añadimos `.analyze(master)` al patrón: `analyze` es un único valor por
  // evento, y puesto en el patrón maestro PISA el `.analyze("telar-src-…")` de
  // cada Source → los osciloscopios por instrumento se quedaban mudos. En su
  // lugar el master se toma del nodo de salida real (getMasterAnalyser).
  clearError();
  const pat = await r.evaluate(code, false); // los errores llegan vía onEvalError, no por throw
  if (epoch !== stopEpoch) return; // ■ durante la evaluación: el reloj queda parado
  if (pat && !r.scheduler.started) {
    try {
      await r.start?.();
    } catch {
      /* sin patrón válido todavía: nada que tocar */
    }
  }
  started = true;
  applyMasterBus(); // reaserta el bus de máster (EQ+limiter) por si hubo reset del motor
  applyChannelEqs(); // reaserta el EQ por canal (orbits pueden haberse recreado)
}

export async function stopAudio(): Promise<void> {
  stopEpoch++;
  if (repl) repl.stop();
  started = false;
}

export function isStarted(): boolean {
  return started;
}

export function setCps(cps: number): void {
  repl?.scheduler.setCps(cps);
}

// Scheduler activo (now() en ciclos, pattern para consultar haps). Lo usa el
// resaltado de eventos para saber qué se está tocando en cada frame.
export function getScheduler(): Scheduler | undefined {
  return repl?.scheduler;
}

// El visualizador lee de este AnalyserNode. En vez del control `analyze` (que es
// único por evento y entraría en conflicto con los scopes por instrumento),
// tomamos la señal del nodo suma de la salida (`destinationGain`, que va a
// ctx.destination). El analyser es un sink pasivo: no altera el audio. Re-tapeamos
// si el contexto o el nodo de salida cambian (p.ej. tras un reset de superdough).
// Nodo suma de la salida de superdough (destinationGain) = PRE bus de máster. Lo usa el
// FREEZE (stem limpio). Para grabar / medir / visualizar lo que SUENA: getMasterPostNode.
// Conectarle un analyser/grabador no altera el audio que va a los altavoces.
export function getMasterOutputNode(): AudioNode | undefined {
  try {
    return getSuperdoughAudioController()?.output?.destinationGain as AudioNode | undefined;
  } catch {
    return undefined;
  }
}

let masterAnalyser: AnalyserNode | null = null;
let tappedOut: AudioNode | null = null;
export function getMasterAnalyser(): AnalyserNode | undefined {
  try {
    const ctx = getAudioContext();
    if (!masterAnalyser || masterAnalyser.context !== ctx) {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0.6;
      masterAnalyser = a;
      tappedOut = null;
    }
    const an = masterAnalyser!; // garantizado no-nulo tras el bloque anterior
    // POST-máster (lo que suena: el visual y el VU reaccionan al filtro/drive DJ); hasta que
    // exista el bus, el pre. Al cambiar de nodo se suelta el tap anterior (si no, sumaría
    // las dos señales y el medidor marcaría de más).
    const out = getMasterPostNode() ?? getMasterOutputNode();
    if (out && out !== tappedOut) {
      try {
        if (tappedOut) { try { tappedOut.disconnect(an); } catch { /* otro contexto */ } }
        out.connect(an);
        tappedOut = out;
      } catch {
        /* ya conectado o nodo en transición */
      }
    }
    return an;
  } catch {
    return masterAnalyser ?? undefined;
  }
}

// --- BUS DE MÁSTER (EQ 3 bandas + limiter) ----------------------------------
// superdough conecta destinationGain → ctx.destination directo (sin limitador →
// puede clippear al apilar sonidos). Insertamos un bus real en el motor:
//   destinationGain → EQ(low-shelf, mid-peak, high-shelf) → limiter → makeup → dest
// Todo con try/catch para no silenciar nunca la salida (peor caso: bypass directo).
export interface MasterBusSettings { limit: number; glue: number; sat: number; width: number; punch: number; low: number; mid: number; high: number; filter: number; drive: number; loud?: number /* dB extra hacia el limitador TP: solo al exportar con objetivo de loudness (4.4) */ }
let busSettings: MasterBusSettings = { limit: 0, glue: 0, sat: 0, width: 1, punch: 0, low: 0, mid: 0, high: 0, filter: 0, drive: 0 };
interface MasterChain {
  ctx: BaseAudioContext; entry: AudioNode; sideW: GainNode; sat: WaveShaperNode; lastSat: number; fastK: GainNode; slowK: GainNode;
  low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; glue: DynamicsCompressorNode; lim: DynamicsCompressorNode; makeup: GainNode; wired: boolean; dg: AudioNode | null;
  djHP: BiquadFilterNode; djLP: BiquadFilterNode; djDrive: WaveShaperNode; lastDrive: number; // filtro DJ + drive del máster (bus, no código)
  outSink: AudioNode | null;   // a qué está conectado makeup (bus activo): la etapa de FX en vivo (fxIn)
  bypassSink: AudioNode | null; bypassDg: AudioNode | null; // ídem para el bypass (dg → salida)
}
let masterChain: MasterChain | null = null;
// LIMITADOR TRUE-PEAK como ÚLTIMA etapa: `tp → destination` fijo; el bus EQ/glue enruta su
// salida a `tp` (o directo a destination si el worklet no cargó). tpToDest evita duplicar la
// conexión tp→destino; tpKickCtx dispara la carga una vez por contexto.
let tpToDest: AudioWorkletNode | null = null;
let tpKickCtx: BaseAudioContext | null = null;

// TAP POST-MÁSTER: nodo FIJO al final de la cadena (… → tp → post → destino; sin el worklet
// TP: … → post → destino). Grabar, medir y visualizar desde aquí = EXACTAMENTE lo que suena
// (filtro/drive DJ, EQ, glue y limitadores incluidos). El pre-bus (destinationGain) queda
// para el FREEZE, que necesita el stem limpio (si no, el bus se aplicaría dos veces).
let postTap: GainNode | null = null;
// A/B con la PISTA DE REFERENCIA (Fase 6.3): la mezcla se calla en la salida (después del tap:
// medir, grabar y visualizar siguen viendo la mezcla) mientras suena la referencia.
let mixAb: GainNode | null = null;
let mixAudible = true;
function ensurePostTap(ctx: BaseAudioContext): GainNode {
  if (!postTap || postTap.context !== ctx) {
    postTap = new GainNode(ctx, { gain: 1 });
    mixAb = new GainNode(ctx, { gain: mixAudible ? 1 : 0 });
    postTap.connect(mixAb);
    mixAb.connect(ctx.destination);
  }
  return postTap;
}
export function setMixAudible(on: boolean): void {
  mixAudible = on;
  try {
    if (!mixAb) return;
    const t = mixAb.context.currentTime;
    mixAb.gain.cancelScheduledValues(t);
    mixAb.gain.setValueAtTime(mixAb.gain.value, t);
    mixAb.gain.linearRampToValueAtTime(on ? 1 : 0, t + 0.015); // sin clic
  } catch { /* nunca romper el audio */ }
}
export function getMasterPostNode(): AudioNode | undefined {
  try {
    const ctx = getAudioContext();
    return postTap && postTap.context === ctx ? postTap : undefined;
  } catch {
    return undefined;
  }
}

// --- FX EN VIVO (pads momentáneos del panel MIDI) -------------------------------------
// Etapa FIJA al final de la mezcla, SIEMPRE en el camino (con el bus activo o en bypass):
//   (bus | dg) → fxIn → kill graves → kill medios → kill agudos → fxOut → salida (tp | post)
//                                                   ├→ envío ECO  (delay a tempo, realimentado) → salida
//                                                   └→ envío WASH (reverb por convolución)    → salida
// En reposo es transparente (shelves/peaking a 0 dB = respuesta plana; envíos a 0). Los envíos
// van en PARALELO: al soltar el pad se cierra la ENTRADA y la cola sigue sonando (throw de DJ).
// Antes de los retornos está el limitador TP → un throw fuerte no clipea. Todo con rampas
// cortas de AudioParam: instantáneo, sin recompilar el patrón. Eco y wash se crean al primer
// uso (el convolver no gasta CPU si nunca se toca).
export type LiveFxKey = 'echo' | 'wash' | 'killLow' | 'killMid' | 'killHigh';
interface LiveFxStage {
  ctx: BaseAudioContext;
  fxIn: GainNode; kLow: BiquadFilterNode; kMid: BiquadFilterNode; kHigh: BiquadFilterNode; fxOut: GainNode;
  sink: AudioNode | null; // salida actual de fxOut y de los retornos (tp o post)
  echo: { send: GainNode; delay: DelayNode; ret: GainNode } | null;
  wash: { send: GainNode; ret: GainNode } | null;
}
let liveFx: LiveFxStage | null = null;

function ensureLiveFx(ctx: BaseAudioContext): LiveFxStage {
  if (liveFx && liveFx.ctx === ctx) return liveFx;
  const fxIn = new GainNode(ctx, { gain: 1 });
  const kLow = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 250, gain: 0 });
  const kMid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1200, Q: 0.35, gain: 0 });
  const kHigh = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 3500, gain: 0 });
  const fxOut = new GainNode(ctx, { gain: 1 });
  fxIn.connect(kLow); kLow.connect(kMid); kMid.connect(kHigh); kHigh.connect(fxOut);
  liveFx = { ctx, fxIn, kLow, kMid, kHigh, fxOut, sink: null, echo: null, wash: null };
  return liveFx;
}

// (re)conecta fxOut y los retornos a la salida (cambia cuando el worklet TP llega tarde).
function liveFxSink(st: LiveFxStage, sink: AudioNode): void {
  if (st.sink === sink) return;
  const outs: AudioNode[] = [st.fxOut];
  if (st.echo) outs.push(st.echo.ret);
  if (st.wash) outs.push(st.wash.ret);
  for (const n of outs) {
    try { n.disconnect(); } catch { /* */ }
    try { n.connect(sink); } catch { /* */ }
  }
  st.sink = sink;
}

function buildEcho(st: LiveFxStage): NonNullable<LiveFxStage['echo']> {
  const { ctx } = st;
  const send = new GainNode(ctx, { gain: 0 });
  const delay = new DelayNode(ctx, { maxDelayTime: 2, delayTime: 0.33 });
  // tono DUB en el lazo: cada repetición más oscura y sin graves (no embarra el bombo)
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 260, Q: 0.5 });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3600, Q: 0.5 });
  const fb = new GainNode(ctx, { gain: 0.55 }); // −5 dB por repetición → cola de ~3 s
  const ret = new GainNode(ctx, { gain: 0.8 });
  st.kHigh.connect(send); send.connect(delay); delay.connect(hp); hp.connect(lp);
  lp.connect(fb); fb.connect(delay); lp.connect(ret);
  if (st.sink) ret.connect(st.sink);
  st.echo = { send, delay, ret };
  return st.echo;
}

// Respuesta al impulso sintética: ruido estéreo decorrelado con caída exponencial (−60 dB
// al final) y un paso-bajo que se va cerrando → la cola se oscurece como en una sala real.
function washIr(ctx: BaseAudioContext, secs = 3.4): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.max(1, Math.floor(secs * rate));
  const pre = Math.floor(0.012 * rate); // pre-delay 12 ms: el golpe seco queda delante
  const buf = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / rate;
      const k = 0.9 - 0.75 * Math.min(1, t / secs);
      y += k * (Math.random() * 2 - 1 - y);
      d[i] = y * Math.exp((-6.9 * t) / secs);
    }
  }
  return buf;
}

function buildWash(st: LiveFxStage): NonNullable<LiveFxStage['wash']> {
  const { ctx } = st;
  const send = new GainNode(ctx, { gain: 0 });
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 200, Q: 0.5 }); // sin barro
  const conv = new ConvolverNode(ctx, { buffer: washIr(ctx) }); // normaliza la IR por defecto
  const ret = new GainNode(ctx, { gain: 1.6 }); // medido: el wet queda ≈ al nivel del seco (lavado evidente)
  st.kHigh.connect(send); send.connect(hp); hp.connect(conv); conv.connect(ret);
  if (st.sink) ret.connect(st.sink);
  st.wash = { send, ret };
  return st.wash;
}

const liveFxOn: Record<LiveFxKey, boolean> = { echo: false, wash: false, killLow: false, killMid: false, killHigh: false };

// Engancha / suelta un FX en vivo. cps = tempo del proyecto (el eco va a 3/16 de compás, el
// «dotted eighth» clásico). Sin audio iniciado no hace nada (no hay etapa todavía).
export function setLiveFx(key: LiveFxKey, on: boolean, cps?: number): void {
  try {
    const st = liveFx;
    if (!st) return;
    liveFxOn[key] = on;
    const t = st.ctx.currentTime;
    if (key === 'killLow') st.kLow.gain.setTargetAtTime(on ? -40 : 0, t, 0.008);
    else if (key === 'killMid') st.kMid.gain.setTargetAtTime(on ? -26 : 0, t, 0.008);
    else if (key === 'killHigh') st.kHigh.gain.setTargetAtTime(on ? -40 : 0, t, 0.008);
    else if (key === 'echo') {
      const e = st.echo ?? buildEcho(st);
      if (on) {
        const c = cps && cps > 0 ? cps : Number(repl?.scheduler?.cps) || 0.5;
        const dt = Math.min(1.9, 3 / 16 / c);
        // solo si cambió el tempo: mover delayTime con la cola sonando la desafina
        if (Math.abs(e.delay.delayTime.value - dt) > 0.002) e.delay.delayTime.setValueAtTime(dt, t);
      }
      e.send.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.005 : 0.02);
    } else if (key === 'wash') {
      const w = st.wash ?? buildWash(st);
      w.send.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 0.02 : 0.04);
    }
  } catch {
    /* nunca romper el audio */
  }
}

// Pánico: suelta todos los FX en vivo (las colas de eco/wash terminan solas).
export function releaseAllLiveFx(): void {
  for (const k of Object.keys(liveFxOn) as LiveFxKey[]) if (liveFxOn[k]) setLiveFx(k, false);
}

export function busActive(s: MasterBusSettings): boolean {
  return s.limit > 0.01 || s.glue > 0.01 || s.sat > 0.01 || Math.abs(s.width - 1) > 0.01 || Math.abs(s.punch) > 0.01 || Math.abs(s.low) > 0.1 || Math.abs(s.mid) > 0.1 || Math.abs(s.high) > 0.1 || Math.abs(s.filter) > 0.01 || s.drive > 0.01 || Math.abs(s.loud ?? 0) > 0.05;
}

// Curva |x| para el detector de envolvente (rectificado de onda completa).
function absCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = x < 0 ? -x : x; }
  return c;
}

// Curva del saturador (WaveShaper): mezcla identidad→tanh según `amount`. amount 0 =
// lineal (transparente); subiendo añade armónicos/calor y satura los picos. Con
// oversample 4x el WaveShaperNode no genera aliasing.
function satCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(new ArrayBuffer(n * 4)); // ArrayBuffer explícito → tipo que acepta WaveShaperNode.curve
  const k = 1 + amount * 4;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x * (1 - amount) + Math.tanh(x * k) * amount;
  }
  return curve;
}

// Aplica el bus (idempotente): construye la cadena si hace falta, ajusta los valores y
// (des)conecta destinationGain. Reasertar tras cada swap protege de un reset del motor.
// Nodos del BUS DE MÁSTER para un contexto (en vivo u offline): MISMA cadena y mismos valores
// en los dos caminos → la exportación offline suena igual que en vivo.
export interface MasterChainNodes {
  ctx: BaseAudioContext; entry: AudioNode; sideW: GainNode; sat: WaveShaperNode; lastSat: number; fastK: GainNode; slowK: GainNode;
  low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; glue: DynamicsCompressorNode; lim: DynamicsCompressorNode; makeup: GainNode;
  djHP: BiquadFilterNode; djLP: BiquadFilterNode; djDrive: WaveShaperNode; lastDrive: number;
}
function createMasterChainNodes(ctx: BaseAudioContext): MasterChainNodes {
  // ANCHO ESTÉREO Mid-Side: mid=(L+R)/2, side=(L−R)/2; escala side por `width` (1=normal,
  // 0=mono, >1 más ancho); decodifica L=mid+side, R=mid−side. Transparente en width=1.
  // entry fuerza 2 canales (up-mix mono→L=R con interpretación de altavoces) para que
  // el bloque M/S nunca mande una señal mono a un solo lado.
  const entry = new GainNode(ctx, { gain: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  entry.connect(splitter);
  const midSum = new GainNode(ctx, { gain: 1 });
  const gLm = new GainNode(ctx, { gain: 0.5 }); splitter.connect(gLm, 0); gLm.connect(midSum);
  const gRm = new GainNode(ctx, { gain: 0.5 }); splitter.connect(gRm, 1); gRm.connect(midSum);
  const sideSum = new GainNode(ctx, { gain: 1 });
  const gLs = new GainNode(ctx, { gain: 0.5 }); splitter.connect(gLs, 0); gLs.connect(sideSum);
  const gRs = new GainNode(ctx, { gain: -0.5 }); splitter.connect(gRs, 1); gRs.connect(sideSum);
  // MONO-BAJO (P1.1 auditoría dancehall): el canal side pasa por un highpass a
  // 120 Hz — por debajo, la señal es SOLO mid (mono por construcción). Es la regla
  // nº1 de la mezcla de sound-system: el sub pega idéntico en mono/club/teléfono y
  // no se cancela; el width ensancha pads/hats sin des-monoizar jamás el bajo.
  const sideHP = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 120, Q: 0.5 });
  const sideW = new GainNode(ctx, { gain: 1 }); sideSum.connect(sideHP); sideHP.connect(sideW);
  const Lout = new GainNode(ctx, { gain: 1 }); midSum.connect(Lout); sideW.connect(Lout);
  const Rout = new GainNode(ctx, { gain: 1 }); midSum.connect(Rout);
  const sideNeg = new GainNode(ctx, { gain: -1 }); sideW.connect(sideNeg); sideNeg.connect(Rout);
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  Lout.connect(merger, 0, 0); Rout.connect(merger, 0, 1);

  // TRANSIENT SHAPER (punch): envelope-follower. gain = 1 + k·(envRápido − envLento).
  // punch 0 = transparente (k=0); >0 realza el ATAQUE, <0 lo suaviza. La sidechain
  // (abs → LP rápido/lento → ±k) modula la ganancia del camino principal (punchGain).
  const punchGain = new GainNode(ctx, { gain: 1 });
  const absShaper = new WaveShaperNode(ctx, { curve: absCurve() });
  const fastLP = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 120, Q: 0.4 });
  const slowLP = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 12, Q: 0.4 });
  const fastK = new GainNode(ctx, { gain: 0 });
  const slowK = new GainNode(ctx, { gain: 0 });
  absShaper.connect(fastLP); fastLP.connect(fastK); fastK.connect(punchGain.gain);
  absShaper.connect(slowLP); slowLP.connect(slowK); slowK.connect(punchGain.gain);

  const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 220 });
  const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.8 });
  const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4500 });
  // SATURADOR (WaveShaper, oversample 4x → sin aliasing): calor analógico. Va tras el EQ.
  const sat = new WaveShaperNode(ctx, { oversample: '4x' });
  sat.curve = satCurve(0);
  // GLUE-COMP (compresor de bus SSL-style): gentil, PEGA la mezcla. Ataque lento
  // (deja pasar transientes) + release medio (bombeo suave). Va ANTES del limiter.
  const glue = new DynamicsCompressorNode(ctx, { threshold: 0, knee: 6, ratio: 2, attack: 0.02, release: 0.18 });
  // LIMITER (brickwall): rápido + ratio alto, atrapa picos y sube loudness. Va al final.
  const lim = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.12 });
  const makeup = new GainNode(ctx, { gain: 1 });
  // FILTRO DJ (lpf+hpf) y DRIVE del máster en el BUS (no como sufijo de código):
  // así afectan TODA la mezcla sin que los pise el FX propio de cada voz (CLAUDE.md
  // regla 2 — el FX por voz es de un solo uso). En reposo son transparentes.
  const djHP = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 20, Q: 0.7 });
  const djLP = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.7 });
  const djDrive = new WaveShaperNode(ctx, { oversample: '4x' });
  djDrive.curve = satCurve(0);
  // cadena: entry(M/S) → merger → punch → djHP → djLP → djDrive → EQ → sat → glue → lim → makeup
  merger.connect(punchGain); merger.connect(absShaper); // main + sidechain del transient
  punchGain.connect(djHP); djHP.connect(djLP); djLP.connect(djDrive); djDrive.connect(low);
  low.connect(mid); mid.connect(high); high.connect(sat); sat.connect(glue); glue.connect(lim); lim.connect(makeup);
  return { ctx, entry, sideW, sat, lastSat: 0, fastK, slowK, low, mid, high, glue, lim, makeup, djHP, djLP, djDrive, lastDrive: 0 };
}

// Ajusta la cadena a unos valores del bus (idempotente). `ctx.currentTime` = ahora.
function setMasterChainParams(mc: MasterChainNodes, s: MasterBusSettings, ctx: BaseAudioContext): void {
  mc.low.gain.value = s.low;   // dB
  mc.mid.gain.value = s.mid;
  mc.high.gain.value = s.high;
  // FILTRO DJ del máster: filter<0 cierra el lpf (barre a grave), >0 sube el hpf
  // (barre a agudo), 0 = abierto (transparente). Exponencial para que sea musical.
  // CLAMP defensivo a [-1,1]: un filter fuera de rango daría un lpf sub-audible (mudo).
  const f = Math.max(-1, Math.min(1, s.filter));
  // rampa corta (~35 ms al 95 %): un barrido con la perilla MIDI llega en escalones de 1/127;
  // fijar .value de golpe hace «zipper» (chasquidos) en la frecuencia del filtro.
  const tNow = ctx.currentTime;
  mc.djLP.frequency.setTargetAtTime(f < -0.01 ? Math.round(18000 * Math.pow(100 / 18000, -f)) : 20000, tNow, 0.012);
  mc.djHP.frequency.setTargetAtTime(f > 0.01 ? Math.round(20 * Math.pow(6000 / 20, f)) : 20, tNow, 0.012);
  const dr = Math.max(0, Math.min(1, s.drive));
  if (Math.abs(dr - mc.lastDrive) > 0.001) { mc.djDrive.curve = satCurve(dr * 0.9); mc.lastDrive = dr; } // DRIVE del máster
  mc.sideW.gain.value = s.width; // 1 = normal · 0 = mono · >1 = más ancho
  const kp = s.punch * 2; // profundidad del transient shaper (−2..2); 0 = transparente
  mc.fastK.gain.value = kp;
  mc.slowK.gain.value = -kp;
  if (Math.abs(s.sat - mc.lastSat) > 0.001) { mc.sat.curve = satCurve(s.sat); mc.lastSat = s.sat; } // recalcula la curva solo si cambió
  // glue-comp: 0 = transparente (ratio 1). Sube → baja el umbral (más pegamento, −6..−22 dB)
  // y ratio 2→4. Ataque/release fijos, gentiles (glue, no limiting).
  const gl = s.glue;
  mc.glue.threshold.value = gl > 0.01 ? -(6 + gl * 16) : 0;
  mc.glue.ratio.value = gl > 0.01 ? 2 + gl * 2 : 1;
  mc.lim.threshold.value = -3 - s.limit * 9;      // más limit → umbral más bajo (-3..-12)
  // compensa nivel (limiter + glue − saturación) y, al exportar con objetivo, empuja el limitador TP
  mc.makeup.gain.value = (1 + s.limit * 0.6 + gl * 0.35 - s.sat * 0.15) * Math.pow(10, (s.loud ?? 0) / 20);
}

export function applyMasterBus(): void {
  if (offlineDepth) return; // render offline en curso: se reaplica al terminar (endOfflineRender)
  try {
    const ctx = getAudioContext();
    const dg = getMasterOutputNode();
    if (!dg) return;
    if (!masterChain || masterChain.ctx !== ctx) {
      masterChain = { ...createMasterChainNodes(ctx), wired: false, dg: null, outSink: null, bypassSink: null, bypassDg: null };
    }
    const mc = masterChain;
    const s = busSettings;
    setMasterChainParams(mc, s, ctx);
    // LIMITADOR TRUE-PEAK: carga el worklet una vez por contexto; al estar listo, re-aplica el
    // bus para enrutar la salida por él. Es la ÚLTIMA etapa (tp → destino, fijo). Fallback: si
    // el worklet no cargó, sink = ctx.destination → salida directa (nunca muda).
    if (tpKickCtx !== ctx) { tpKickCtx = ctx; void ensureMasterLimiter(ctx, () => applyMasterBus()); }
    const tp = getMasterLimiterNode(ctx);
    const post = ensurePostTap(ctx);
    const sink: AudioNode = tp ?? post;
    if (tp && tpToDest !== tp) { try { tp.connect(post); } catch { /* ya */ } tpToDest = tp; }
    // FX EN VIVO: etapa fija antes de la salida. El bus (activo) o dg (bypass) entran en fxIn;
    // fxOut y los retornos de eco/wash van al sink (reconciliado si el worklet TP llega tarde).
    const fx = ensureLiveFx(ctx);
    liveFxSink(fx, sink);
    const target: AudioNode = fx.fxIn;

    const active = busActive(s);
    if (active) {
      // entrada del bus: dg → entry (rompe cualquier enlace directo dg → salida)
      if (!mc.wired || mc.dg !== dg) {
        if (mc.wired && mc.dg && mc.dg !== dg) { try { mc.dg.disconnect(mc.entry); } catch { /* */ } }
        try { dg.disconnect(ctx.destination); } catch { /* */ }
        if (tp) { try { dg.disconnect(tp); } catch { /* */ } }
        try { dg.disconnect(post); } catch { /* */ }
        try { dg.disconnect(target); } catch { /* */ }
        try { dg.connect(mc.entry); } catch { /* */ }
        mc.wired = true; mc.dg = dg; mc.bypassSink = null; mc.bypassDg = null;
      }
      // salida: makeup → etapa de FX en vivo (fija por contexto)
      if (mc.outSink !== target) {
        try { mc.makeup.disconnect(); } catch { /* */ }
        try { mc.makeup.connect(target); } catch { /* */ }
        mc.outSink = target;
      }
    } else {
      // bypass del EQ/glue pero MANTIENE FX en vivo y limitador: dg → fxIn → … → sink
      if (mc.wired) {
        try { mc.makeup.disconnect(); } catch { /* */ }
        try { (mc.dg ?? dg).disconnect(mc.entry); } catch { /* */ }
        mc.wired = false; mc.dg = null; mc.outSink = null;
      }
      if (mc.bypassSink !== target || mc.bypassDg !== dg) {
        try { dg.disconnect(ctx.destination); } catch { /* */ }
        if (tp) { try { dg.disconnect(tp); } catch { /* */ } }
        try { dg.disconnect(post); } catch { /* */ }
        try { dg.connect(target); } catch { /* */ }
        mc.bypassSink = target; mc.bypassDg = dg;
      }
    }
  } catch {
    /* nunca romper el audio */
  }
}

export function setMasterBus(patch: Partial<MasterBusSettings>): void {
  busSettings = { ...busSettings, ...patch };
  applyMasterBus();
}

// --- RENDER OFFLINE (Fase 4.2) -------------------------------------------------------------
// Mientras se renderiza offline, superdough apunta por ratos a OTRO contexto: el motor en vivo
// no toca su bus ni su EQ por canal (leerían el contexto equivocado) y no se puede dar ▶.
// Al terminar se reaplica todo lo que haya cambiado entretanto.
let offlineDepth = 0;
export function isOfflineRendering(): boolean {
  return offlineDepth > 0;
}
export function beginOfflineRender(): void {
  offlineDepth++;
}
export function endOfflineRender(): void {
  offlineDepth = Math.max(0, offlineDepth - 1);
  if (!offlineDepth) {
    applyMasterBus();
    applyChannelEqs();
  }
}

// Valores del bus a partir del máster del proyecto (lo mismo que hace setMaster en vivo).
export function busFromMaster(m: { limit?: number; glue?: number; sat?: number; width?: number; punch?: number; eqLow?: number; eqMid?: number; eqHigh?: number; filter?: number; drive?: number }): MasterBusSettings {
  return { limit: m.limit ?? 0, glue: m.glue ?? 0, sat: m.sat ?? 0, width: m.width ?? 1, punch: m.punch ?? 0, low: m.eqLow ?? 0, mid: m.eqMid ?? 0, high: m.eqHigh ?? 0, filter: m.filter ?? 0, drive: m.drive ?? 0 };
}

// BUS DE MÁSTER para un contexto offline: la MISMA cadena (createMasterChainNodes) y el mismo
// mapeo de valores (setMasterChainParams) que en vivo, con su propio limitador TP al final.
// `apply` cambia los valores en el instante actual del contexto (con el render suspendido en la
// frontera de la sección, igual que una escena en vivo) y re-cablea si el bus se (des)activa.
export interface OfflineBus {
  apply: (s: MasterBusSettings) => void;
  latencyFrames: number; // retardo de la salida respecto de la entrada (para alinear con los stems)
}
export async function createOfflineMasterBus(ctx: BaseAudioContext, dg: AudioNode, initial: MasterBusSettings): Promise<OfflineBus> {
  const mc = createMasterChainNodes(ctx);
  const tp = await createLimiterFor(ctx);
  const sink: AudioNode = tp ?? ctx.destination;
  if (tp) tp.connect(ctx.destination);
  try { dg.disconnect(); } catch { /* */ }
  let wired: boolean | null = null;
  const apply = (s: MasterBusSettings) => {
    setMasterChainParams(mc, s, ctx);
    const active = busActive(s);
    if (active === wired) return;
    try { dg.disconnect(); } catch { /* */ }
    try { mc.makeup.disconnect(); } catch { /* */ }
    if (active) { dg.connect(mc.entry); mc.makeup.connect(sink); } else dg.connect(sink);
    wired = active;
  };
  apply(initial);
  const sr = ctx.sampleRate;
  const latencyFrames = (tp ? limiterLatencyFrames(sr) : 0) + (busActive(initial) ? await measureBusChainFrames(sr) : 0);
  return { apply, latencyFrames };
}

// LATENCIA POST-MÁSTER (la compensación de retardo de un DAW): lo que sale por el tap post
// suena más tarde que el pre-bus — el limitador TP lleva 1,5 ms de lookahead y, con el bus
// activo, el drive y el saturador (oversample 4x = filtros FIR) y los dos compresores
// (lookahead fijo de 6 ms) suman más. El tramo del bus se MIDE una vez por sample-rate con un
// impulso en un OfflineAudioContext, porque la cifra depende del navegador (Chromium: 912
// muestras a 44,1 kHz). Exportar la usa para que la mezcla quede alineada a la muestra con
// los stems. Nunca lanza: ante duda, 0.
const busChainFrames = new Map<number, Promise<number>>();
function measureBusChainFrames(sr: number): Promise<number> {
  let p = busChainFrames.get(sr);
  if (!p) {
    p = (async () => {
      try {
        const n = 8192, at = 2048;
        const oc = new OfflineAudioContext(1, n, sr);
        const buf = oc.createBuffer(1, n, sr);
        buf.getChannelData(0)[at] = 0.25;
        const src = new AudioBufferSourceNode(oc, { buffer: buf });
        const shaper = () => { const w = new WaveShaperNode(oc, { oversample: '4x' }); w.curve = satCurve(0); return w; };
        // mismos nodos con latencia que el bus, en serie: djDrive, sat, glue, lim
        const chain: AudioNode[] = [shaper(), shaper(), new DynamicsCompressorNode(oc, { threshold: 0, knee: 6, ratio: 1 }), new DynamicsCompressorNode(oc, { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.12 })];
        let prev: AudioNode = src;
        for (const node of chain) { prev.connect(node); prev = node; }
        prev.connect(oc.destination);
        src.start(0);
        const out = (await oc.startRendering()).getChannelData(0);
        let mi = at, mv = 0;
        for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > mv) { mv = a; mi = i; } }
        return Math.max(0, mi - at);
      } catch {
        return 0;
      }
    })();
    busChainFrames.set(sr, p);
  }
  return p;
}

export async function getMasterPostLatency(): Promise<number> {
  try {
    const ctx = getAudioContext();
    const sr = ctx.sampleRate;
    let frames = 0;
    const tp = getMasterLimiterNode(ctx);
    if (tp && liveFx && liveFx.ctx === ctx && liveFx.sink === tp) frames += limiterLatencyFrames(sr);
    if (masterChain && masterChain.ctx === ctx && masterChain.wired) frames += await measureBusChainFrames(sr);
    return frames / sr;
  } catch {
    return 0;
  }
}

// --- EQ POR CANAL (M1) ------------------------------------------------------
// Cada canal con EQ activo se enruta (en el compilador) a un orbit propio con
// `.orbit(K)`. superdough crea un bus (SS) por orbit: su `.output` (GainNode) se
// conecta a la salida vía `controller.output.connectToDestination(output, chans)`.
// Aquí INTERCEPTAMOS ese bus insertando 3 filtros Biquad reales (low-shelf,
// peaking, high-shelf) con ganancia en dB — un EQ paramétrico de verdad, con boost
// y cut, que superdough no ofrece en el patrón. Mismo patrón defensivo que el
// máster: todo en try/catch, y si el orbit aún no existe (se crea al primer evento)
// se reintenta tras el siguiente swap.
interface ChannelEqRouteRT { orbit: number; source?: string; low: number; mid: number; high: number; midFreq: number; comp?: CompRoute | null }
export interface SdOrbit { output?: AudioNode }
export interface SdController { nodes?: Record<number, SdOrbit>; output?: { connectToDestination?: (node: AudioNode, chans?: number[]) => void }; getOrbit?: (orbit: number, chans: number[]) => SdOrbit }
// tira de canal: EQ de 3 bandas → compresor (si su procesador está cargado en ese contexto) → salida
export interface ChanEqChain { orbit: number; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; comp: AudioWorkletNode | null; out: GainNode; src: AudioNode; ctx: BaseAudioContext }

let channelEqRoutes: ChannelEqRouteRT[] = [];
const chanEqChains = new Map<number, ChanEqChain>();
const sourceOrbit = new Map<string, number>(); // Source → orbit de su tira (medidor de compresión)
const sourceStrip = new Map<string, number>(); // Source → orbit de su tira (EQ o compresor)

// salida de la tira de canal de un Source (post EQ/compresor/makeup, con su reverb/eco de orbit):
// lo que esa pista aporta a la suma. undefined si la pista no tiene tira (va directo al bus).
export function getSourceStripOut(sourceId: string): AudioNode | undefined {
  const o = sourceStrip.get(sourceId);
  if (o == null) return undefined;
  const st = chanEqChains.get(o);
  try {
    return st && st.ctx === getAudioContext() ? st.out : undefined;
  } catch {
    return undefined;
  }
}

// reducción de ganancia del compresor de un Source ahora (dB ≤ 0; 0 = sin compresor o sin señal)
export function getSourceCompGr(sourceId: string): number {
  const o = sourceOrbit.get(sourceId);
  return o == null ? 0 : getOrbitGr(o);
}

// valores de una tira de canal (EQ + compresor); los usan el audio en vivo y el render offline
export function setChanStrip(st: ChanEqChain, r: ChannelEqRouteRT): void {
  st.low.gain.value = r.low; // dB
  st.mid.gain.value = r.mid;
  st.mid.frequency.value = r.midFreq;
  st.high.gain.value = r.high;
  if (st.comp) setCompParams(st.comp, r.comp ?? null);
}

function getSdController(): SdController | undefined {
  try {
    return getSuperdoughAudioController() as unknown as SdController;
  } catch {
    return undefined;
  }
}

// Deshace un EQ de canal y restaura la conexión directa bus→salida.
function teardownChanEq(ctrl: SdController, st: ChanEqChain): void {
  try { st.src.disconnect(); } catch { /* */ }
  try { st.out.disconnect(); } catch { /* */ }
  try { st.low.disconnect(); st.mid.disconnect(); st.high.disconnect(); } catch { /* */ }
  try { st.comp?.disconnect(); } catch { /* */ }
  try { ctrl.output?.connectToDestination?.(st.src, [0, 1]); } catch { /* */ }
}

export function buildChanEq(ctx: BaseAudioContext, ctrl: SdController, src: AudioNode, orbit: number): ChanEqChain | undefined {
  try {
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 120 });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 1.0 });
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4500 });
    const out = new GainNode(ctx, { gain: 1 });
    // compresor del canal (6.1) detrás del EQ; sin su procesador cargado, la tira queda solo con EQ
    const comp = createCompNode(ctx, orbit, ctx === liveCtxOrNull());
    low.connect(mid); mid.connect(high);
    if (comp) { high.connect(comp); comp.connect(out); } else high.connect(out);
    if (comp) setCompParams(comp, null); // en bypass hasta que la ruta diga otra cosa
    // el bus estaba conectado src → (panner interno de connectToDestination). Lo
    // desviamos: src → EQ → nueva salida. disconnect() quita SOLO su enlace previo.
    src.disconnect();
    src.connect(low);
    ctrl.output?.connectToDestination?.(out, [0, 1]);
    return { orbit, low, mid, high, comp, out, src, ctx };
  } catch {
    return undefined;
  }
}

// el contexto en vivo (sin crearlo); el de un render offline es otro
function liveCtxOrNull(): BaseAudioContext | null {
  try {
    return repl && !offlineDepth ? getAudioContext() : null;
  } catch {
    return null;
  }
}

// Reasigna el EQ de todos los canales (idempotente). Se llama tras cada swap y con
// reintentos (el orbit puede no existir hasta que ese canal suene por primera vez).
export function applyChannelEqs(): void {
  if (offlineDepth) return; // render offline en curso: se reaplica al terminar
  try {
    const ctx = getAudioContext();
    const ctrl = getSdController();
    if (!ctrl || !ctrl.nodes) return;
    const wanted = new Set(channelEqRoutes.map((r) => r.orbit));
    // retira cadenas que ya no se piden o cuyo contexto cambió.
    for (const [orbit, st] of Array.from(chanEqChains.entries())) {
      if (!wanted.has(orbit) || st.ctx !== ctx) {
        teardownChanEq(ctrl, st);
        chanEqChains.delete(orbit);
      }
    }
    for (const r of channelEqRoutes) {
      // el orbit se crea YA (superdough lo crearía con la primera nota de la pista): una pista que
      // entra en una sección posterior quedaba sin su tira (EQ/compresor) hasta el siguiente cambio
      let orbitNode = ctrl.nodes[r.orbit];
      if (!orbitNode?.output && ctrl.getOrbit) {
        try { orbitNode = ctrl.getOrbit(r.orbit, [0, 1]); } catch { /* sin crear: la primera nota lo hará */ }
      }
      const src = orbitNode?.output;
      if (!src) continue; // orbit aún no creado → se reintenta en el próximo swap
      let st = chanEqChains.get(r.orbit);
      // el bus se recreó (reset del motor), o la tira se armó sin compresor y ahora hay uno
      // pedido y su procesador ya cargó → reconstruir
      if (st && (st.src !== src || (r.comp && !st.comp && compModuleReady(ctx)))) {
        teardownChanEq(ctrl, st);
        chanEqChains.delete(r.orbit);
        st = undefined;
      }
      if (!st) {
        st = buildChanEq(ctx, ctrl, src, r.orbit);
        if (!st) continue;
        chanEqChains.set(r.orbit, st);
      }
      setChanStrip(st, r);
    }
  } catch {
    /* nunca romper el audio */
  }
}

export function setChannelEqs(routes: ChannelEqRouteRT[]): void {
  channelEqRoutes = routes;
  sourceOrbit.clear();
  sourceStrip.clear();
  for (const r of routes) {
    if (r.source && r.comp) sourceOrbit.set(r.source, r.orbit);
    if (r.source) sourceStrip.set(r.source, r.orbit);
  }
  applyChannelEqs();
  // reintentos: los orbits se crean perezosamente al primer evento de cada canal.
  window.setTimeout(applyChannelEqs, 220);
  window.setTimeout(applyChannelEqs, 700);
}

// Frecuencia de muestreo del audio en vivo (0 si el motor aún no arrancó: no crea contexto).
export function liveSampleRate(): number {
  try {
    return repl ? getAudioContext().sampleRate : 0;
  } catch {
    return 0;
  }
}

// AudioContext de Strudel (lo usa butterchurn/MilkDrop para su análisis).
export function getAudioCtx(): AudioContext {
  return getAudioContext() as AudioContext;
}

// Analyser de un Source concreto (onda por instrumento, Fase 3). Existe solo si
// su scope está activo (el compilador añadió `.analyze("telar-src-<id>")`).
export function getSourceAnalyser(nodeId: string): AnalyserNode | undefined {
  try {
    return getAnalyserById(SRC_ANALYSER_PREFIX + nodeId) as AnalyserNode | undefined;
  } catch {
    return undefined;
  }
}

// Registra un audio descargado (ej. de YouTube) como sample de Strudel para que
// `s("yt_xxx")` lo reproduzca. Usamos URL ABSOLUTA (sin baseUrl ambiguo) y forma
// de string (un único archivo → índice 0). Requiere el engine inicializado.
export async function registerSample(name: string, url: string): Promise<void> {
  await ensureEngine();
  const abs = new URL(url, location.href).href;
  await samples({ [name]: abs });
}

// Carga un PACK de samples de Strudel bajo demanda: acepta `github:user/repo`, una
// URL a un strudel.json, o `user/repo` (se le antepone github:). Los nombres del pack
// quedan disponibles como `s("nombre")`. Devuelve true si cargó. (descargar sonidos)
export async function loadSamplePack(ref: string): Promise<boolean> {
  await ensureEngine();
  const r = ref.trim();
  if (!r) return false;
  // `github:` o una URL van tal cual; `user/repo` → github:. Un JSON suelto → URL.
  const arg = /^https?:\/\//.test(r) || r.includes(':') ? r : `github:${r}`;
  try {
    await samples(arg);
    return true;
  } catch {
    return false;
  }
}

// Registra un archivo de audio LOCAL (drag-drop) como sample de Strudel vía
// objectURL en memoria. No persiste tras recargar (es para tocar en el momento).
export async function registerLocalSample(name: string, file: Blob): Promise<void> {
  await ensureEngine();
  const url = URL.createObjectURL(file);
  await samples({ [name]: url });
}

// Registra las wavetables propias de Telar (wt_telar_*). El motor las reproduce
// como wavetables por el prefijo wt_. Idempotente (solo una vez).
let wavetablesDone = false;
export async function registerWavetables(): Promise<void> {
  if (wavetablesDone) return;
  await ensureEngine();
  const { wavetableSamples, morphWavetables } = await import('./wavetables');
  await samples(wavetableSamples());
  // Tablas de MORPH multi-cuadro por el motor wavetable integrado de superdough:
  // registerWaveTable(nombre, [url], {frameLen}) parte el WAV en cuadros de 2048; en el
  // patrón, note("..").s("telar_sweep").wt("0 .33 .66 1") barre los cuadros (patroneable).
  // Defensivo (regla 4): si el registro de una tabla falla, no tumbar el resto del init.
  try {
    for (const t of morphWavetables()) registerWaveTable(t.name, [t.url], { frameLen: 2048 });
  } catch (err) {
    console.warn('[wavetable] registro de tablas de morph falló', err);
  }
  wavetablesDone = true;
}

// Registra la ONDA PROPIA del usuario (dibujada con nodos en el editor) como wavetable de 1
// cuadro `telar_user_<id>`. Se re-registra en cada cambio (blob fresco → el loader recarga).
// Defensivo (regla 4): si algo falla, no tumba el audio.
export async function registerUserWave(name: string, uw: unknown): Promise<void> {
  try {
    await ensureEngine();
    const { userWaveSeries, wavBuffer } = await import('./wavetables');
    // userWaveSeries concatena TODOS los cuadros dibujados (N × 2048) → wavetable de morph propia.
    const url = URL.createObjectURL(new Blob([wavBuffer(userWaveSeries(uw))], { type: 'audio/wav' }));
    registerWaveTable(name, [url], { frameLen: 2048 });
  } catch (err) {
    console.warn('[wavetable] registro de onda propia falló', err);
  }
}
