// Abrir un proyecto que viene de fuera (enlace, .json, Nod-IA) sin ejecutar su código:
// 1) se carga con la marca de ajeno (`foreign`): desde ese instante la compuerta verifica
//    todo lo que se vaya a evaluar (compilar solo escribe texto; las miniaturas esperan),
// 2) se revisa ya el código de cada nodo y el compilado, para avisar de una vez y poder
//    volver atrás. Si todo pasa no se pregunta nada; la marca sigue y la compuerta sigue
//    verificando lo que se arme después (escenas, nodos sueltos, lanzador, exportar).
import type { ProjectSnapshot } from './projectStore';
import { useGraphStore, saveProjectSoon, projectSnapshotNow } from '../store/useGraphStore';
import { useTrustStore, vetCode, strudelReady } from '../store/useTrustStore';
import { ensureEngine } from '../audio/engine';

// El verificador solo necesita el ALCANCE de Strudel (sus nombres), que queda listo en
// milisegundos; ensureEngine además baja los mapas de samples, que pueden tardar. Se espera
// lo primero (con tope); si el motor no arrancó, el alcance queda vacío y todo se frena.
export async function waitForScope(maxMs = 10000): Promise<void> {
  let settled = false;
  void ensureEngine().then(() => { settled = true; }, () => { settled = true; });
  const t0 = Date.now();
  while (!strudelReady() && !settled && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 25));
}

function label(n: { id: string; data?: { label?: unknown; name?: unknown } }): string {
  const d = n.data ?? {};
  const name = typeof d.label === 'string' && d.label ? d.label : typeof d.name === 'string' && d.name ? d.name : n.id;
  return String(name).slice(0, 40);
}

// El código de cada nodo (también los sueltos, que se pueden conectar después) y el compilado.
export function vetLoadedProject(): string[] {
  const out: string[] = [];
  const g = useGraphStore.getState();
  for (const n of g.nodes) {
    const code = (n.data as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) {
      const v = vetCode(code);
      if (!v.ok) out.push(`${label(n as never)}: ${v.why}`);
    }
  }
  if (g.lastCode) {
    const v = vetCode(g.lastCode);
    if (!v.ok) out.push(`el código compilado: ${v.why}`);
  }
  return out.slice(0, 12);
}

let before: ProjectSnapshot | null = null; // el proyecto que se fue, entero (para «volver»)

export async function openExternalProject(snap: Partial<ProjectSnapshot>, origin: string): Promise<void> {
  await waitForScope();
  before = projectSnapshotNow();
  useGraphStore.getState().loadSnapshot({ ...snap, foreign: origin }, origin);
  const problems = vetLoadedProject();
  if (problems.length) useTrustStore.getState().block(problems, 'open');
}

// «Volver a mi proyecto»: vuelve a cargar el proyecto de antes TAL CUAL (tempo, máster,
// título, canción y escenas; deshacer solo devolvería el grafo) con su propia marca.
export function rejectExternalProject(): void {
  useTrustStore.setState({ problems: null });
  if (before) useGraphStore.getState().loadSnapshot(before, 'volver a mi proyecto', { quiet: true });
  else useGraphStore.getState().undo();
  before = null;
}

// «Confío»: el proyecto pasa a ser propio y se vuelve a compilar con su código.
export function acceptExternalProject(): void {
  useTrustStore.getState().trust();
  useGraphStore.getState().recompile();
  saveProjectSoon(); // que el autoguardado ya no lo traiga marcado al recargar
}

// «No ejecutarlo» (código armado después de abrir): sigue sonando lo de antes.
export function dismissForeignCode(): void {
  useTrustStore.getState().dismiss();
}
