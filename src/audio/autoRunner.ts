// AUTOMATIZACIÓN EN EL MOTOR, EN VIVO (Fase 7.2): las curvas de las perillas que no viven en el
// código (envíos de cada pista, filtro DJ y drive del bus, nivel de los retornos) se mueven aquí,
// ~30 veces por segundo, con el valor del compás que SUENA (el reloj del planificador va 0,05 s
// por delante del audio). Mientras una perilla tiene curva, manda la curva; con ■ (o al quitar la
// curva) vuelve la perilla. Al exportar no se usa esto: el render agenda las curvas exactas.
import { curveAt, hasEngineAuto, type EngineAuto } from '../lib/automation';
import { setBusOverride, setSendOverride } from './engine';
import { setReturnLevelOverride } from './fxReturns';

let curves: EngineAuto = { bars: 0, sends: {}, master: {} };
let position: () => number | null = () => null; // compás de canción que suena (null = parado)
let timer = 0;
let engaged = false; // hay overrides puestos (para soltarlos una sola vez)
let ownedSends = new Set<string>(); // `${id}:rev|del` que la curva está llevando

export function setAutoPositionSource(fn: () => number | null): void {
  position = fn;
}

// curvas nuevas (tras cada compilación); suelta las que ya no existen
export function setEngineAutomation(e: EngineAuto): void {
  curves = e;
  if (!hasEngineAuto(e)) {
    release();
    stopLoop();
    return;
  }
  // envíos que ya no tienen curva → vuelve la perilla
  for (const k of [...ownedSends]) {
    const [id, w] = k.split(':') as [string, 'rev' | 'del'];
    if (!curves.sends[id]?.[w]) {
      setSendOverride(id, w, null);
      ownedSends.delete(k);
    }
  }
  if (engaged) {
    if (!e.master.mfilt && !e.master.mdrive) setBusOverride(null);
    if (!e.master.rv && !e.master.dl) setReturnLevelOverride(null);
  }
  startLoop();
}

function startLoop(): void {
  if (timer) return;
  timer = window.setInterval(tick, 33);
}
function stopLoop(): void {
  if (timer) window.clearInterval(timer);
  timer = 0;
}

function release(): void {
  if (!engaged) return;
  engaged = false;
  setBusOverride(null);
  setReturnLevelOverride(null);
  for (const k of ownedSends) {
    const [id, w] = k.split(':') as [string, 'rev' | 'del'];
    setSendOverride(id, w, null);
  }
  ownedSends = new Set();
}

function tick(): void {
  let bar: number | null = null;
  try {
    bar = position();
  } catch {
    bar = null;
  }
  if (bar == null || !Number.isFinite(bar)) {
    release();
    return;
  }
  const L = curves.bars;
  const m = curves.master;
  const bus: { filter?: number; drive?: number } = {};
  if (m.mfilt) bus.filter = curveAt(m.mfilt, bar, L);
  if (m.mdrive) bus.drive = curveAt(m.mdrive, bar, L);
  setBusOverride(Object.keys(bus).length ? bus : null);
  const lv: { rv?: number; dl?: number } = {};
  if (m.rv) lv.rv = curveAt(m.rv, bar, L);
  if (m.dl) lv.dl = curveAt(m.dl, bar, L);
  if (lv.rv != null || lv.dl != null) setReturnLevelOverride(lv);
  for (const [id, s] of Object.entries(curves.sends)) {
    for (const w of ['rev', 'del'] as const) {
      const pts = s[w];
      if (!pts) continue;
      setSendOverride(id, w, curveAt(pts, bar, L));
      ownedSends.add(`${id}:${w}`);
    }
  }
  engaged = true;
}
