// Resaltado de eventos activos en el código, como en strudel.cc.
//
// Cómo: en cada frame consultamos el patrón maestro vivo sobre la ventana de
// ciclos transcurrida desde el frame anterior; cada hap con onset trae
// `context.locations` = offsets {start,end} en el código evaluado. El compilador
// nos dio, por cada Source, el rango que ocupa su código en ese string
// (SourceSpan), así que mapeamos cada location a (nodeId, offset local) y
// "flasheamos" ese trozo en su editor CodeMirror durante ~150 ms.
//
// El bucle escribe decoraciones directamente en cada EditorView (vía StateEffect)
// sin pasar por React: nada de re-render por frame.
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import type { SourceSpan } from '../graph/compile';
import { getScheduler } from '../audio/engine';
import { tokens } from '../theme/tokens';

const FLASH_MS = 150;

// --- Extensión CodeMirror: campo de decoraciones de flash ---
const setFlash = StateEffect.define<{ from: number; to: number }[]>();
const flashMark = Decoration.mark({ class: 'cm-flash' });

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setFlash)) {
        const len = tr.state.doc.length;
        const ranges = e.value
          .map((r) => ({ from: Math.max(0, Math.min(r.from, len)), to: Math.max(0, Math.min(r.to, len)) }))
          .filter((r) => r.to > r.from)
          .sort((a, b) => a.from - b.from || a.to - b.to);
        return Decoration.set(ranges.map((r) => flashMark.range(r.from, r.to)), true);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const flashTheme = EditorView.baseTheme({
  '.cm-flash': {
    backgroundColor: 'rgba(61,240,208,0.30)',
    color: '#eafffb',
    borderRadius: '1px',
    boxShadow: `0 0 8px ${tokens.accent}`,
    transition: 'background-color 90ms linear',
  },
});

export function highlightExtension(): Extension {
  return [flashField, flashTheme];
}

// --- Registro de editores por nodo ---
const editors = new Map<string, EditorView>();
export function registerEditor(nodeId: string, view: EditorView): void {
  editors.set(nodeId, view);
}
export function unregisterEditor(nodeId: string): void {
  editors.delete(nodeId);
}
export function getEditor(nodeId: string): EditorView | undefined {
  return editors.get(nodeId);
}

// --- Spans del compilado actual (rango del código de cada Source) ---
let spans: SourceSpan[] = [];
export function setSpans(s: SourceSpan[]): void {
  spans = s;
}

function spanFor(start: number, end: number): SourceSpan | undefined {
  return spans.find((sp) => sp.start <= start && end <= sp.end);
}

// Nodo Source al que pertenece una location del código evaluado (lo usan los
// piano tiles para agrupar los haps por instrumento). [[algorave-visuals-roadmap]]
export function nodeIdForLoc(start: number, end: number): string | undefined {
  return spanFor(start, end)?.nodeId;
}

// --- Bucle de resaltado ---
type Flash = { from: number; to: number; until: number };
const active = new Map<string, Flash[]>();
let lastCycle: number | null = null;
let raf = 0;
let running = false;

function tick() {
  raf = requestAnimationFrame(tick);
  const sched = getScheduler();
  const nowMs = performance.now();

  if (sched?.started && sched.pattern) {
    const cyc = sched.now();
    if (lastCycle == null || cyc < lastCycle || cyc - lastCycle > 2) {
      lastCycle = cyc; // arranque o salto: no consultamos esta ventana
    } else if (cyc > lastCycle) {
      try {
        const haps = sched.pattern.queryArc(lastCycle, cyc);
        for (const h of haps) {
          if (!h.hasOnset?.()) continue;
          for (const loc of h.context?.locations ?? []) {
            const sp = spanFor(loc.start, loc.end);
            if (!sp) continue;
            const arr = active.get(sp.nodeId) ?? [];
            arr.push({ from: loc.start - sp.start, to: loc.end - sp.start, until: nowMs + FLASH_MS });
            active.set(sp.nodeId, arr);
          }
        }
      } catch {
        /* el patrón puede fallar al consultar durante un swap; ignoramos */
      }
      lastCycle = cyc;
    }
  } else {
    lastCycle = null;
  }

  // Purga expirados y despacha a cada editor (incluye vaciar los que quedaron sin flashes).
  for (const [nodeId, view] of editors) {
    const arr = (active.get(nodeId) ?? []).filter((f) => f.until > nowMs);
    if (arr.length) active.set(nodeId, arr);
    else active.delete(nodeId);
    view.dispatch({ effects: setFlash.of(arr.map((f) => ({ from: f.from, to: f.to }))) });
  }
}

export function startHighlightLoop(): void {
  if (running) return;
  running = true;
  raf = requestAnimationFrame(tick);
}

export function stopHighlightLoop(): void {
  running = false;
  cancelAnimationFrame(raf);
}
