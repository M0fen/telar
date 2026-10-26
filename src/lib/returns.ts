// ENVÍOS Y RETORNOS (Fase 6.4) — lógica PURA (testeable en Node): los parámetros de los dos
// retornos compartidos (REVERB y ECO a tempo, cada uno con su EQ y su nivel) y los envíos de cada
// pista. Los parámetros de los retornos viven en el máster del proyecto (las escenas los capturan:
// un break puede abrir la reverb); el motor los aplica sin recompilar.

export interface Sends {
  rev?: number; // 0..1 lo que la pista manda al retorno de reverb
  del?: number; // 0..1 lo que manda al retorno de eco
}

const c01 = (x: unknown) => {
  const v = Number(x);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
};
export function cleanSends(s: Sends | undefined): { rev: number; del: number } {
  return { rev: c01(s?.rev), del: c01(s?.del) };
}
// ¿la pista manda algo? (entonces necesita su propio bus: el envío sale de su tira de canal)
export function sendsActive(s: Sends | undefined): boolean {
  const c = cleanSends(s);
  return c.rev > 0.005 || c.del > 0.005;
}

// divisiones del eco, en PULSOS (negras): 1/2, 1/4, 1/8 con puntillo (el dub), 1/8, tresillo, 1/16
export const DELAY_NOTES: { beats: number; label: string; title: string }[] = [
  { beats: 2, label: '1/2', title: 'blanca (2 pulsos)' },
  { beats: 1, label: '1/4', title: 'negra (1 pulso)' },
  { beats: 0.75, label: '1/8·', title: 'corchea con puntillo (3/4 de pulso): el eco del dub y del techno' },
  { beats: 0.5, label: '1/8', title: 'corchea (medio pulso)' },
  { beats: 1 / 3, label: '1/8T', title: 'tresillo de corchea (un tercio de pulso)' },
  { beats: 0.25, label: '1/16', title: 'semicorchea (un cuarto de pulso)' },
];

export interface ReturnParams {
  rvSpace: string; // espacio (IR): ir_room / ir_plate / ir_hall / … o uno del usuario
  rvLevel: number; // dB del retorno
  rvPre: number; // pre-delay en ms (separa el golpe de su cola)
  rvLow: number; // Hz: corte de graves de la cola (que no embarre el bombo)
  rvHigh: number; // Hz: corte de agudos de la cola
  dlNote: number; // pulsos (ver DELAY_NOTES)
  dlFb: number; // 0..0.9 realimentación (cuántas repeticiones)
  dlLow: number; // Hz: corte de graves de las repeticiones (cada vuelta más fina)
  dlHigh: number; // Hz: corte de agudos de las repeticiones (cada vuelta más oscura)
  dlLevel: number; // dB del retorno
}

export const DEFAULT_RETURNS: ReturnParams = {
  rvSpace: 'ir_hall',
  rvLevel: 0,
  rvPre: 20,
  rvLow: 250,
  rvHigh: 9000,
  dlNote: 0.75,
  dlFb: 0.35,
  dlLow: 300,
  dlHigh: 5000,
  dlLevel: 0,
};

// rango válido de cada número (UI, importados y escenas pasan por aquí)
export const RETURN_RANGES: Record<Exclude<keyof ReturnParams, 'rvSpace'>, [number, number]> = {
  rvLevel: [-30, 6],
  rvPre: [0, 150],
  rvLow: [20, 1000],
  rvHigh: [1500, 20000],
  dlNote: [0.25, 2],
  dlFb: [0, 0.9],
  dlLow: [20, 2000],
  dlHigh: [1000, 20000],
  dlLevel: [-30, 6],
};
export const RETURN_KEYS = ['rvSpace', ...Object.keys(RETURN_RANGES)] as (keyof ReturnParams)[];

// los parámetros de los retornos a partir del máster (lo que falte o no valga → por defecto)
export function returnsFromMaster(m: Partial<Record<keyof ReturnParams, unknown>> | undefined): ReturnParams {
  const out: ReturnParams = { ...DEFAULT_RETURNS };
  if (!m) return out;
  if (typeof m.rvSpace === 'string' && /^ir_[a-z0-9_]{1,60}$/.test(m.rvSpace)) out.rvSpace = m.rvSpace;
  for (const k of Object.keys(RETURN_RANGES) as (keyof typeof RETURN_RANGES)[]) {
    const v = Number(m[k]);
    if (m[k] == null || !Number.isFinite(v)) continue;
    const [a, b] = RETURN_RANGES[k];
    out[k] = Math.max(a, Math.min(b, v));
  }
  // el eco va a una división de la lista (la más cercana)
  out.dlNote = DELAY_NOTES.reduce((best, n) => (Math.abs(n.beats - out.dlNote) < Math.abs(best - out.dlNote) ? n.beats : best), DELAY_NOTES[0].beats);
  return out;
}

// tiempo del eco en segundos: pulsos × duración de un pulso (60 / BPM)
export function delaySeconds(beats: number, secPerBeat: number): number {
  const s = beats * (Number.isFinite(secPerBeat) && secPerBeat > 0 ? secPerBeat : 0.5);
  return Math.max(0.01, Math.min(4, s));
}

export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));
