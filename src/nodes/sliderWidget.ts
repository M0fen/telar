import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { Transaction } from '@codemirror/state';

// Sliders embebidos al estilo algorave (strudel/_switch_angel): el usuario escribe
// `slider(valor, min, max)` en el código y el editor pinta una barra arrastrable
// sobre ese valor. Arrastrar reescribe el literal en el texto → recompila → suena
// en vivo. El runtime `sliderWithID` (audio/engine) hace que evalúe. (Fase 1)

interface SliderSpec {
  widgetPos: number; // dónde se inserta la barra (tras el "(")
  from: number; // inicio del literal del valor (estable durante el arrastre)
  to: number;
  value: number;
  min: number;
  max: number;
  step?: number;
}

const NUM_RE = /^-?\d*\.?\d+(?:[eE][-+]?\d+)?/;

// Rango automático sensato según la magnitud del valor → permite la forma mínima
// `slider(800)` sin escribir min/max, y lo usa también el botón "envolver".
export function autoRange(n: number): [number, number] {
  const a = Math.abs(n);
  if (a <= 1) return n < 0 ? [-1, 1] : [0, 1];
  if (a <= 16) return [0, Math.ceil(n * 4)];
  const mag = Math.pow(10, Math.floor(Math.log10(a)));
  return [0, Math.ceil((n * 2) / mag) * mag];
}

// Divide los argumentos por comas de nivel superior, guardando el offset de cada uno.
function splitTopLevel(s: string): { str: string; start: number }[] {
  const parts: { str: string; start: number }[] = [];
  let depth = 0;
  let cur = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      parts.push({ str: cur, start });
      cur = '';
      start = i + 1;
    } else cur += c;
  }
  parts.push({ str: cur, start });
  return parts;
}

function parseSliders(text: string): SliderSpec[] {
  const out: SliderSpec[] = [];
  const re = /(?<![\w.])slider\s*\(/g; // no enganchar `.slider(`
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1; // índice del "("
    let depth = 0;
    let end = -1;
    for (let k = open; k < text.length; k++) {
      if (text[k] === '(') depth++;
      else if (text[k] === ')') {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    if (end < 0) continue;
    const inner = text.slice(open + 1, end);
    const parts = splitTopLevel(inner);
    if (!parts.length) continue;
    const vPart = parts[0];
    const vTrim = vPart.str.trim();
    if (!NUM_RE.test(vTrim) || NUM_RE.exec(vTrim)![0] !== vTrim) continue; // el valor debe ser un literal numérico
    const leading = vPart.str.length - vPart.str.trimStart().length;
    const from = open + 1 + vPart.start + leading;
    const to = from + vTrim.length;
    const value = parseFloat(vTrim);
    // forma mínima `slider(v)`: si no hay min/max, se infieren de la magnitud.
    const [aMin, aMax] = autoRange(value);
    const min = parts[1] ? parseFloat(parts[1].str) : aMin;
    const max = parts[2] ? parseFloat(parts[2].str) : aMax;
    const step = parts[3] ? parseFloat(parts[3].str) : undefined;
    out.push({
      widgetPos: open + 1,
      from,
      to,
      value,
      min: isFinite(min) ? min : 0,
      max: isFinite(max) ? max : 1,
      step: step !== undefined && isFinite(step) ? step : undefined,
    });
  }
  return out;
}

function fmt(v: number, min: number, max: number, step?: number): string {
  let val = v;
  if (step && step > 0) val = Math.round(val / step) * step;
  val = Math.max(min, Math.min(max, val));
  const range = Math.abs(max - min) || 1;
  let s = range >= 100 ? String(Math.round(val)) : range >= 10 ? val.toFixed(1) : val.toFixed(3);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

class SliderBar extends WidgetType {
  constructor(readonly spec: SliderSpec) {
    super();
  }
  eq(o: SliderBar) {
    const a = this.spec;
    const b = o.spec;
    return a.from === b.from && a.value === b.value && a.min === b.min && a.max === b.max && a.step === b.step;
  }
  ignoreEvent() {
    return true; // que CM no trate los eventos de la barra como del editor
  }
  toDOM(view: EditorView) {
    const spec = this.spec;
    const wrap = document.createElement('span');
    wrap.className = 'cm-slider';
    const fill = document.createElement('span');
    fill.className = 'cm-slider-fill';
    const knob = document.createElement('span');
    knob.className = 'cm-slider-knob';
    wrap.appendChild(fill);
    wrap.appendChild(knob);
    const paint = (val: number) => {
      const c = Math.max(0, Math.min(1, (val - spec.min) / (spec.max - spec.min || 1)));
      fill.style.width = `${c * 100}%`;
      knob.style.left = `${c * 100}%`;
    };
    paint(spec.value);

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = wrap.getBoundingClientRect();
      const from = spec.from; // estable: el texto anterior no cambia durante el arrastre
      const apply = (clientX: number) => {
        const c = Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
        const raw = spec.min + c * (spec.max - spec.min);
        const str = fmt(raw, spec.min, spec.max, spec.step);
        const doc = view.state.doc.toString();
        const mm = NUM_RE.exec(doc.slice(from));
        const cur = mm ? mm[0] : '';
        const endNow = from + cur.length;
        if (mm && cur !== str) {
          // fuera del historial: evita inundar el undo con micro-pasos del arrastre
          view.dispatch({ changes: { from, to: endNow, insert: str }, annotations: Transaction.addToHistory.of(false) });
        }
        paint(raw);
      };
      apply(e.clientX);
      const move = (ev: PointerEvent) => apply(ev.clientX);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('mousedown', (e) => e.stopPropagation());
    return wrap;
  }
}

function build(view: EditorView): DecorationSet {
  const specs = parseSliders(view.state.doc.toString());
  const decos = specs
    .map((spec) => Decoration.widget({ widget: new SliderBar(spec), side: -1 }).range(spec.widgetPos))
    .sort((a, b) => a.from - b.from);
  return Decoration.set(decos);
}

// Botón "convertir en slider": envuelve el número donde está el cursor (o la
// selección) en `slider(n)` — la forma mínima, sin teclear. Si no hay número
// bajo el cursor, no hace nada. Devuelve true si envolvió algo.
export function wrapNumberAtCursor(view: EditorView | null | undefined): boolean {
  if (!view) return false;
  const doc = view.state.doc.toString();
  const sel = view.state.selection.main;
  let from = sel.from;
  let to = sel.to;
  if (from === to) {
    const isN = (c: string) => /[0-9.]/.test(c);
    while (from > 0 && isN(doc[from - 1])) from--;
    while (to < doc.length && isN(doc[to])) to++;
    if (from > 0 && doc[from - 1] === '-') from--; // signo
  }
  const token = doc.slice(from, to).trim();
  if (!token || !/^-?\d*\.?\d+$/.test(token) || !isFinite(parseFloat(token))) return false;
  if (/slider\(\s*$/.test(doc.slice(0, from))) return false; // ya está dentro de un slider
  const insert = `slider(${token})`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
  view.focus();
  return true;
}

export function sliderExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations }
  );
}
