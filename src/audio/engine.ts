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
import { initStrudel, getAudioContext, getAnalyserById, getSuperdoughAudioController, samples, initAudio } from '@strudel/web';
import { SRC_ANALYSER_PREFIX } from '../graph/compile';

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
let midiAccess: { outputs: Map<string, { name?: string; send: (d: number[], t?: number) => void }> } | null = null;

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
        const vel = Math.max(1, Math.min(127, Math.round(((v.gain as number) ?? 0.9) * 127)));
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
  start?: () => void;
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

export async function swapPattern(code: string, cps: number): Promise<void> {
  const r = await ensureEngine();
  // Si el código ya fija su tempo (p.ej. .cpm(150/4)), respetamos el cps base de
  // strudel.cc para que suene igual; si no, mandamos el cps del transporte.
  r.scheduler.setCps(SETS_OWN_TEMPO.test(code) ? STRUDEL_DEFAULT_CPS : cps);
  // NO añadimos `.analyze(master)` al patrón: `analyze` es un único valor por
  // evento, y puesto en el patrón maestro PISA el `.analyze("telar-src-…")` de
  // cada Source → los osciloscopios por instrumento se quedaban mudos. En su
  // lugar el master se toma del nodo de salida real (getMasterAnalyser).
  clearError();
  await r.evaluate(code, true); // los errores llegan vía onEvalError, no por throw
  started = true;
  applyMasterBus(); // reaserta el bus de máster (EQ+limiter) por si hubo reset del motor
  applyChannelEqs(); // reaserta el EQ por canal (orbits pueden haberse recreado)
}

export async function stopAudio(): Promise<void> {
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
// Nodo suma de la salida (destinationGain → ctx.destination). Punto de tap para el
// master analyser y para grabar (MediaStreamDestination). Es un sink-friendly node:
// conectarle un analyser/grabador no altera el audio que va a los altavoces.
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
    const out = getMasterOutputNode();
    if (out && out !== tappedOut) {
      try {
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
interface MasterBusSettings { limit: number; glue: number; sat: number; width: number; punch: number; low: number; mid: number; high: number }
let busSettings: MasterBusSettings = { limit: 0, glue: 0, sat: 0, width: 1, punch: 0, low: 0, mid: 0, high: 0 };
interface MasterChain {
  ctx: BaseAudioContext; entry: AudioNode; sideW: GainNode; sat: WaveShaperNode; lastSat: number; fastK: GainNode; slowK: GainNode;
  low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; glue: DynamicsCompressorNode; lim: DynamicsCompressorNode; makeup: GainNode; wired: boolean; dg: AudioNode | null;
}
let masterChain: MasterChain | null = null;

function busActive(s: MasterBusSettings): boolean {
  return s.limit > 0.01 || s.glue > 0.01 || s.sat > 0.01 || Math.abs(s.width - 1) > 0.01 || Math.abs(s.punch) > 0.01 || Math.abs(s.low) > 0.1 || Math.abs(s.mid) > 0.1 || Math.abs(s.high) > 0.1;
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
export function applyMasterBus(): void {
  try {
    const ctx = getAudioContext();
    const dg = getMasterOutputNode();
    if (!dg) return;
    if (!masterChain || masterChain.ctx !== ctx) {
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
      const sideW = new GainNode(ctx, { gain: 1 }); sideSum.connect(sideW);
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
      // cadena: entry(M/S) → merger → punch → EQ → sat → glue → lim → makeup
      merger.connect(punchGain); merger.connect(absShaper); // main + sidechain del transient
      punchGain.connect(low); low.connect(mid); mid.connect(high); high.connect(sat); sat.connect(glue); glue.connect(lim); lim.connect(makeup);
      masterChain = { ctx, entry, sideW, sat, lastSat: 0, fastK, slowK, low, mid, high, glue, lim, makeup, wired: false, dg: null };
    }
    const mc = masterChain;
    const s = busSettings;
    mc.low.gain.value = s.low;   // dB
    mc.mid.gain.value = s.mid;
    mc.high.gain.value = s.high;
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
    mc.makeup.gain.value = 1 + s.limit * 0.6 + gl * 0.35 - s.sat * 0.15; // compensa nivel (limiter + glue − saturación)
    const active = busActive(s);
    if (active && (!mc.wired || mc.dg !== dg)) {
      // (re)cablea: dg → cadena → destino, quitando el enlace directo dg → destino
      if (mc.wired && mc.dg && mc.dg !== dg) { try { mc.dg.disconnect(mc.entry); } catch { /* */ } }
      try { dg.disconnect(ctx.destination); } catch { /* puede no estar conectado directo */ }
      try { dg.connect(mc.entry); } catch { /* ya conectado */ }
      try { mc.makeup.disconnect(); } catch { /* */ }
      mc.makeup.connect(ctx.destination);
      mc.wired = true;
      mc.dg = dg;
    } else if (!active && mc.wired) {
      // bypass: restaura el enlace directo dg → destino
      try { mc.makeup.disconnect(); } catch { /* */ }
      try { (mc.dg ?? dg).disconnect(mc.entry); } catch { /* */ }
      try { dg.connect(ctx.destination); } catch { /* */ }
      mc.wired = false;
      mc.dg = null;
    }
  } catch {
    /* nunca romper el audio */
  }
}

export function setMasterBus(patch: Partial<MasterBusSettings>): void {
  busSettings = { ...busSettings, ...patch };
  applyMasterBus();
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
interface ChannelEqRouteRT { orbit: number; low: number; mid: number; high: number; midFreq: number }
interface SdOrbit { output?: AudioNode }
interface SdController { nodes?: Record<number, SdOrbit>; output?: { connectToDestination?: (node: AudioNode, chans?: number[]) => void } }
interface ChanEqChain { orbit: number; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; out: GainNode; src: AudioNode; ctx: BaseAudioContext }

let channelEqRoutes: ChannelEqRouteRT[] = [];
const chanEqChains = new Map<number, ChanEqChain>();

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
  try { ctrl.output?.connectToDestination?.(st.src, [0, 1]); } catch { /* */ }
}

function buildChanEq(ctx: BaseAudioContext, ctrl: SdController, src: AudioNode, orbit: number): ChanEqChain | undefined {
  try {
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 120 });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 1.0 });
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4500 });
    const out = new GainNode(ctx, { gain: 1 });
    low.connect(mid); mid.connect(high); high.connect(out);
    // el bus estaba conectado src → (panner interno de connectToDestination). Lo
    // desviamos: src → EQ → nueva salida. disconnect() quita SOLO su enlace previo.
    src.disconnect();
    src.connect(low);
    ctrl.output?.connectToDestination?.(out, [0, 1]);
    return { orbit, low, mid, high, out, src, ctx };
  } catch {
    return undefined;
  }
}

// Reasigna el EQ de todos los canales (idempotente). Se llama tras cada swap y con
// reintentos (el orbit puede no existir hasta que ese canal suene por primera vez).
export function applyChannelEqs(): void {
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
      const orbitNode = ctrl.nodes[r.orbit];
      const src = orbitNode?.output;
      if (!src) continue; // orbit aún no creado → se reintenta en el próximo swap
      let st = chanEqChains.get(r.orbit);
      if (st && st.src !== src) {
        // el bus se recreó (reset del motor) → reconstruir sobre el nuevo nodo.
        teardownChanEq(ctrl, st);
        chanEqChains.delete(r.orbit);
        st = undefined;
      }
      if (!st) {
        st = buildChanEq(ctx, ctrl, src, r.orbit);
        if (!st) continue;
        chanEqChains.set(r.orbit, st);
      }
      st.low.gain.value = r.low;                 // dB
      st.mid.gain.value = r.mid;
      st.mid.frequency.value = r.midFreq;
      st.high.gain.value = r.high;
    }
  } catch {
    /* nunca romper el audio */
  }
}

export function setChannelEqs(routes: ChannelEqRouteRT[]): void {
  channelEqRoutes = routes;
  applyChannelEqs();
  // reintentos: los orbits se crean perezosamente al primer evento de cada canal.
  window.setTimeout(applyChannelEqs, 220);
  window.setTimeout(applyChannelEqs, 700);
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
  const { wavetableSamples } = await import('./wavetables');
  await samples(wavetableSamples());
  wavetablesDone = true;
}
