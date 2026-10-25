// ACCIONES DEL DAW (Fase 2): puente entre la vista y el motor puro de `arrangeEdit`. Lee el
// estado actual (secciones de la canción + código de cada pista), aplica la operación y la
// deja en UN paso deshacible (`applyArrangement`). Avisa de las pistas que no pudo alinear.
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { useScenesStore } from '../store/useScenesStore';
import { toast } from '../store/useNotifyStore';
import { useUiFocusStore } from '../store/useUiFocusStore';
import * as E from './arrangeEdit';
import { blockPattern } from './dawModel';

export function arrangeState(): E.ArrangeState {
  const codes: Record<string, string> = {};
  for (const n of useGraphStore.getState().nodes) if (n.data.kind === 'source') codes[n.id] = n.data.code ?? '';
  return { steps: useSongStore.getState().steps.map((s) => ({ ...s })), codes };
}

function trackName(id: string): string {
  const n = useGraphStore.getState().nodes.find((x) => x.id === id);
  return (n?.data.name ?? '').trim() || id;
}

// Aplica el resultado (o avisa si no se pudo). Devuelve true si cambió algo.
export function commitArrangement(r: E.EditResult | null, failMsg = 'no se pudo hacer ese cambio en la estructura'): boolean {
  if (!r) { toast.warn(failMsg); return false; }
  useGraphStore.getState().applyArrangement(r.codes, r.steps);
  if (r.skipped.length) {
    const list = r.skipped.slice(0, 3).map(trackName).join(', ');
    toast.warn(`${list}${r.skipped.length > 3 ? '…' : ''} tiene${r.skipped.length > 1 ? 'n' : ''} más secciones que la canción: no se tocó. Quita secciones en su nodo o borra su arrange.`);
  }
  return true;
}

export const dawSection = {
  duplicate: (i: number) => commitArrangement(E.duplicateSection(arrangeState(), i)),
  insertEmpty: (i: number, bars = 8) => commitArrangement(E.insertEmptySection(arrangeState(), i, bars)),
  remove: (i: number) => commitArrangement(E.deleteSection(arrangeState(), i), 'la canción necesita al menos una sección'),
  resize: (i: number, bars: number) => commitArrangement(E.resizeSection(arrangeState(), i, bars)),
  move: (i: number, j: number) => commitArrangement(E.moveSection(arrangeState(), i, j)),
  rename: (i: number, name: string) => commitArrangement(E.renameSection(arrangeState(), i, name)),
  scene: (i: number, scene: number) => commitArrangement(E.setSectionScene(arrangeState(), i, scene)),
  alignAll: () => commitArrangement(E.alignAll(arrangeState())),
};

// «Una por escena»: una sección de 8 compases por cada escena capturada, en orden.
export function sceneSections(): E.SectionSpec[] {
  const sc = useScenesStore.getState().scenes;
  return Object.keys(sc)
    .map(Number)
    .filter((k) => sc[k])
    .sort((a, b) => a - b)
    .map((k) => ({ bars: 8, scene: k, name: sc[k].name }));
}

// CREAR LA ESTRUCTURA de un tema que hoy es un jam: secciones + pistas alineadas (suenan igual).
export function createStructure(sections: E.SectionSpec[]): boolean {
  const st = arrangeState();
  return commitArrangement(E.createStructure(st.codes, sections), 'elige una plantilla con al menos una sección');
}

// Escenas para una plantilla: ranuras VACÍAS en orden (no dispara mezclas que ya tenías
// capturadas en otras ranuras; luego capturas la mezcla de cada sección en su ranura).
// Si no alcanzan, las últimas repiten la última vacía (o la 1 si no hay ninguna).
export function freeSceneSlots(n: number): number[] {
  const sc = useScenesStore.getState().scenes;
  const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => !sc[k]);
  const last = free.length ? free[free.length - 1] : 1;
  return Array.from({ length: n }, (_, i) => free[i] ?? last);
}

export function createFromTemplate(sections: { bars: number; name: string }[]): boolean {
  const slots = freeSceneSlots(sections.length);
  return createStructure(sections.map((x, i) => ({ bars: x.bars, scene: slots[i], name: x.name })));
}

// --- BLOQUES (Fase 2.3): copiar · pegar · vaciar · duplicar en la siguiente · editar -------
// Editan UNA pista (updateNodeData → Ctrl+Z). El portapapeles vive aquí (sobrevive a cambiar
// de vista) y guarda el patrón del bloque sin su `.mask(0)`: pegado, suena.
let clip: { expr: string; from: string } | null = null;
export const dawClipboard = { get: () => clip };

const codeOf = (id: string) => useGraphStore.getState().nodes.find((n) => n.id === id)?.data.code ?? '';
const setCode = (id: string, next: string | null, failMsg: string): boolean => {
  if (next === null) { toast.warn(failMsg); return false; }
  if (next !== codeOf(id)) useGraphStore.getState().updateNodeData(id, { code: next });
  return true;
};

export const dawBlock = {
  copy(id: string, arm: number): boolean {
    const expr = blockPattern(codeOf(id), arm);
    if (!expr) return false;
    clip = { expr, from: `${trackName(id)}${arm >= 0 ? ` · sección ${arm + 1}` : ''}` };
    toast.info(`copiado: ${clip.from}`);
    return true;
  },
  paste(id: string, arm: number): boolean {
    if (!clip) { toast.info('primero copia un bloque (Ctrl+C o clic derecho › copiar)'); return false; }
    return setCode(id, E.setArmExpr(codeOf(id), arm, clip.expr), 'esta pista no tiene secciones: usa «⇋ alinear pistas» o «crear estructura»');
  },
  clear(id: string, arm: number): boolean {
    return setCode(id, E.setArmExpr(codeOf(id), arm, 'silence'), 'esta pista no tiene secciones');
  },
  toNext(id: string, arm: number): boolean {
    const code = codeOf(id);
    const expr = blockPattern(code, arm);
    return setCode(id, expr ? E.setArmExpr(code, arm + 1, expr) : null, 'no hay una sección siguiente en esta pista');
  },
  edit(id: string, arm: number): void {
    useUiFocusStore.getState().request(id, arm);
    useGraphStore.getState().setMode('standard');
  },
};
