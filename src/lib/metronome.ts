// METRÓNOMO Y CUENTA PREVIA (Fase 8.3) — lógica PURA (testeable en Node).
//
// El clic es un patrón más del planificador (así cae exacto en cada pulso, con la misma latencia
// que la música) que el motor APILA por fuera del máster: no lo tocan el swing, el ½ tiempo ni los
// efectos del máster. Su sonido (audio/metronomeSound.ts) sale directo a los altavoces: no pasa por
// el bus, no lo graba el grabador ni entra en lo que exportas.
//
// CUENTA PREVIA: al grabar el jam o los pads con el transporte parado, el reloj arranca N compases
// antes de la música: el código entero se corre N ciclos (`applyTimeline` con countIn) y en esos
// ciclos solo suena el clic. Los compases de la cuenta se cuentan en negativo (−2, −1) y lo que
// tocas ahí no entra en la toma.

export const COUNT_IN_OPTIONS = [0, 1, 2] as const;

// patrón del clic: un golpe por pulso, el primero de cada compás acentuado (n = 1). Sin metrónomo
// pero con cuenta previa, solo los compases de la cuenta.
export function metronomeCode(beats: number, countIn: number, on: boolean): string {
  const b = Math.max(1, Math.min(16, Math.round(Number(beats)) || 4));
  const ci = Math.max(0, Math.floor(Number(countIn) || 0));
  if (!on && ci <= 0) return '';
  const acc = ['1', ...Array(b - 1).fill('0')].join(' ');
  const code = `s("telar_click*${b}").n("${acc}")`;
  return on ? code : `${code}.filterHaps((h)=>!h.whole||h.whole.begin<${ci})`;
}

// el código final que se evalúa: la música (con su máster) y el clic al lado
export function withMetronome(code: string, o: { on: boolean; beats: number; countIn: number }): string {
  const m = metronomeCode(o.beats, o.countIn, o.on);
  return m ? `stack((${code}\n), ${m})` : code;
}
