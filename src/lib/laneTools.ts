// HERRAMIENTAS DE PATRÓN para una fila de la rejilla (Fase 9.2) — lógica PURA (testeable en Node).
// Trabajan sobre los arreglos por paso de una pista (golpe/fuerza, nota, roll, probabilidad,
// timing) y devuelven una pista nueva; la rejilla la vuelve a escribir como código.
//   · llenar cada N: un golpe cada N pasos desde `offset` (borra los demás) — el «fill each» de FL;
//   · rotar: corre todo un paso a la izquierda o a la derecha (lo que sale entra por el otro lado);
//   · euclidiano: k golpes repartidos lo más parejo posible en los pasos (Bjorklund), con rotación;
//   · invertir: golpes ↔ silencios; borrar.
import { NORMAL, type Lane } from '../nodes/stepseqCode';

const fit = <T,>(arr: T[] | undefined, n: number, fill: T): T[] => {
  const out = (arr ?? []).slice(0, n);
  while (out.length < n) out.push(fill);
  return out;
};

function withHits(lane: Lane, steps: number, on: (i: number) => boolean): Lane {
  const cur = fit(lane.steps, steps, 0);
  return {
    ...lane,
    steps: cur.map((v, i) => (on(i) ? (v > 0 ? v : NORMAL) : 0)),
    notes: fit(lane.notes, steps, null as string | null).map((n, i) => (on(i) ? n : null)),
    ratchet: fit(lane.ratchet, steps, 1).map((r, i) => (on(i) ? r : 1)),
    prob: fit(lane.prob, steps, 1).map((p, i) => (on(i) ? p : 1)),
    nudge: lane.nudge ? fit(lane.nudge, steps, 0).map((x, i) => (on(i) ? x : 0)) : undefined,
  };
}

export function fillEvery(lane: Lane, steps: number, n: number, offset = 0): Lane {
  const k = Math.max(1, Math.floor(n));
  return withHits(lane, steps, (i) => (((i - offset) % k) + k) % k === 0);
}

export function clearLane(lane: Lane, steps: number): Lane {
  return withHits(lane, steps, () => false);
}

export function invertLane(lane: Lane, steps: number): Lane {
  const cur = fit(lane.steps, steps, 0);
  return withHits({ ...lane, steps: cur.map(() => 0) }, steps, (i) => !(cur[i] > 0));
}

const rot = <T,>(a: T[], d: number): T[] => {
  const n = a.length;
  if (!n) return a;
  const s = ((d % n) + n) % n;
  return a.map((_, i) => a[(i - s + n) % n]);
};
// dir +1 = a la derecha (más tarde), −1 = a la izquierda
export function rotateLane(lane: Lane, steps: number, dir: number): Lane {
  return {
    ...lane,
    steps: rot(fit(lane.steps, steps, 0), dir),
    notes: rot(fit(lane.notes, steps, null as string | null), dir),
    ratchet: rot(fit(lane.ratchet, steps, 1), dir),
    prob: rot(fit(lane.prob, steps, 1), dir),
    nudge: lane.nudge ? rot(fit(lane.nudge, steps, 0), dir) : undefined,
  };
}

// patrón euclidiano: k golpes en n pasos, lo más parejo posible (Bjorklund), empezando en un golpe
export function euclid(k: number, n: number): boolean[] {
  const N = Math.max(1, Math.floor(n));
  const K = Math.max(0, Math.min(N, Math.floor(k)));
  // (i·k mod n) < k: los mismos ritmos que Bjorklund (E(3,8) = x..x..x., el tresillo), empezando en golpe
  return Array.from({ length: N }, (_, i) => (i * K) % N < K);
}
export function euclidLane(lane: Lane, steps: number, k: number, rotation = 0): Lane {
  const e = euclid(k, steps);
  return withHits(lane, steps, (i) => e[(((i - rotation) % steps) + steps) % steps]);
}
