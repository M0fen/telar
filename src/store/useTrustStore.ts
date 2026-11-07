// Proyectos AJENOS (enlace compartido, .json, Nod-IA): su código no se evalúa sin pasar por
// el verificador — ni para sonar, ni para exportar, ni para dibujar las miniaturas. El
// código de un proyecto ajeno podría leer o borrar lo que guardas en Telar.
//
// La marca de ajeno viaja con el proyecto (`foreign` en el snapshot: autoguardado, galería,
// copias automáticas), así que recargar la página no la quita. Se verifica CADA código que
// se va a evaluar, no solo el del momento de abrir: una escena, un nodo suelto que se
// conecta después o el lanzador arman textos nuevos con piezas del proyecto.
// Se quita cuando el usuario dice que confía, o al empezar un proyecto propio.
import { create } from 'zustand';
import { verifyCode, strudelGlobalCheck, type Verdict } from '../lib/safeCode';
import { savedProject } from '../lib/projectStore';

// El alcance de Strudel lo registra el motor (engine.ts) al cargar: así este módulo no
// importa @strudel/web.
let scopeOf: () => Record<string, unknown> = () => ({});
export function setStrudelScope(get: () => Record<string, unknown>): void { scopeOf = get; }
export function strudelReady(): boolean { return Object.keys(scopeOf()).length > 0; }

export function cleanForeign(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null;
}

interface TrustStore {
  origin: string | null; // de dónde vino el proyecto ajeno; null = proyecto propio
  problems: string[] | null; // con valor = aviso abierto
  phase: 'open' | 'run'; // 'open': recién abierto (se puede volver atrás); 'run': código armado después
  dismissed: string | null; // motivo que el usuario ya dijo que no se ejecute (no volver a preguntar)
  mark: (origin: string) => void;
  trust: () => void;
  block: (problems: string[], phase: 'open' | 'run') => void;
  dismiss: () => void;
}

export const useTrustStore = create<TrustStore>((set, get) => ({
  origin: cleanForeign(savedProject()?.foreign),
  problems: null,
  phase: 'open',
  dismissed: null,
  mark: (origin) => set({ origin, problems: null, dismissed: null }),
  trust: () => set({ origin: null, problems: null, dismissed: null }),
  block: (problems, phase) => set({ problems: problems.length ? problems : ['código sin verificar'], phase }),
  dismiss: () => set({ problems: null, dismissed: get().problems?.[0] ?? null }),
}));

// Verifica sin ejecutar contra lo que Strudel registró de verdad en su alcance.
export function vetCode(code: string): Verdict {
  return verifyCode(code, strudelGlobalCheck(scopeOf()));
}

// Compuerta: ¿se puede evaluar este código ahora? Proyecto propio → sí. Ajeno → solo si se
// verifica; si no, se frena y se abre el aviso (salvo que ya dijo «no ejecutarlo» a eso).
export function mayRun(code: string): boolean {
  const st = useTrustStore.getState();
  if (st.origin === null) return true;
  const v = vetCode(code);
  if (v.ok) return true;
  const why = `lo que iba a sonar: ${v.why}`;
  if (!st.problems && st.dismissed !== why) st.block([why], 'run');
  return false;
}
