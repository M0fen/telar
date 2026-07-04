// REGISTRO DE ESPACIOS IR (puro, sin @strudel/web) — fuente única de verdad de los
// nombres y DURACIONES de cada respuesta al impulso. Lo consumen el compilador
// (para emitir el `roomsize` correcto) y la UI (selectores). Al ser puro se puede
// testear en Node sin cargar el motor de audio.
//
// Por qué importa la duración: superdough reconstruye el buffer del convolver con
// `adjustLength(roomsize, ir)` — escribe `roomsize * sampleRate` muestras y BUCLEA
// el IR si roomsize > duración, o lo TRUNCA si roomsize < duración (ver
// node_modules/superdough/reverb.mjs:5-24). Para que un IR real (p.ej. un Bricasti
// M7 de ~3.5 s) suene con su cola íntegra y sin repetición, hay que emitir
// `roomsize` = su duración exacta. De ahí este registro.

export interface IrDef {
  name: string; // id de la muestra (lo que va en `.ir("…")`)
  label: string; // etiqueta en la UI
  duration: number; // segundos — define el roomsize exacto
  user?: boolean; // true si lo cargó el usuario (IR real importado)
}

// Espacios de arranque (sintéticos, generados en irReverb.ts). Son el respaldo
// gratis; el usuario carga IRs REALES encima (Bricasti, OpenAIR, etc.).
export const BUILTIN_IRS: IrDef[] = [
  { name: 'ir_room', label: 'room', duration: 0.5 },
  { name: 'ir_plate', label: 'plate', duration: 1.1 },
  { name: 'ir_chamber', label: 'chamber', duration: 1.6 },
  { name: 'ir_hall', label: 'hall', duration: 2.2 },
  { name: 'ir_cathedral', label: 'cathedral', duration: 4.0 },
  { name: 'ir_spring', label: 'spring', duration: 1.3 },
];

// IRs reales cargados por el usuario en esta sesión (objectURLs, no persisten al
// recargar). Map runtime que el compilador consulta para el roomsize/known.
const userIrs = new Map<string, IrDef>();

export function registerUserIr(def: IrDef): void {
  userIrs.set(def.name, { ...def, user: true });
}

export function userIrDefs(): IrDef[] {
  return [...userIrs.values()];
}

export function allIrDefs(): IrDef[] {
  return [...BUILTIN_IRS, ...userIrs.values()];
}

// ¿Es un IR que podemos emitir con seguridad? (built-in siempre; de usuario solo si
// se cargó en esta sesión). Si no, el compilador cae a reverb algorítmico en vez de
// emitir `.ir("…")` sobre una muestra inexistente (que rompería el evento).
export function knownIr(name: string): boolean {
  return BUILTIN_IRS.some((b) => b.name === name) || userIrs.has(name);
}

// roomsize exacto = duración del IR (redondeada a 0.1 s), acotado a 0.2..12 s.
export function irRoomsize(name: string): number {
  const d = userIrs.get(name)?.duration ?? BUILTIN_IRS.find((b) => b.name === name)?.duration;
  if (!d || !isFinite(d)) return 5;
  return Math.max(0.2, Math.min(12, Math.ceil(d * 10) / 10));
}
