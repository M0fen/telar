import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { StateField, type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import { registerTiles, unregisterTiles } from './tilesEngine';
import { registerScope, unregisterScope } from './scopeEngine';

// Visualizadores inline (estética algorave): cuando el código de un Source contiene
// `._scope()` o `._pianoroll()`, dibujamos un canvas fino y monocromo JUSTO debajo
// de esa línea, dentro del editor (no en un panel aparte). Son marcadores: el
// compilador los quita del código emitido (y `._scope()` inyecta el tap de audio).
//
// Los block widgets DEBEN proveerse vía StateField (no ViewPlugin): un ViewPlugin
// no puede alterar la estructura vertical (altura) del editor. (regla de CM6)

type Kind = 'scope' | 'roll';

class VizWidget extends WidgetType {
  constructor(
    readonly kind: Kind,
    readonly nodeId: string
  ) {
    super();
  }
  // Un solo widget por (tipo,nodo): así CM conserva el DOM y el rAF entre tecleos.
  eq(o: VizWidget) {
    return o.kind === this.kind && o.nodeId === this.nodeId;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = `cm-iviz cm-iviz-${this.kind}`;
    const canvas = document.createElement('canvas');
    canvas.className = 'cm-iviz-canvas';
    wrap.appendChild(canvas);
    if (this.kind === 'roll') registerTiles(this.nodeId, canvas);
    else registerScope(this.nodeId, canvas);
    return wrap;
  }
  destroy() {
    if (this.kind === 'roll') unregisterTiles(this.nodeId);
    else unregisterScope(this.nodeId);
  }
  ignoreEvent() {
    return true;
  }
}

const SCOPE_RE = /\._scope\(\)/g;
const ROLL_RE = /\._pianoroll\(\)/g;

function build(state: EditorState, nodeId: string): DecorationSet {
  // Defensivo: si algo fallara aquí, NO debe abortar la transacción del editor
  // (rompería typing/sliders). Ante un error devolvemos un set vacío.
  try {
    const text = state.doc.toString();
    // recolecta posiciones (fin de la línea que contiene el marcador), ordenadas.
    const hits: { at: number; kind: Kind }[] = [];
    for (const [re, kind] of [
      [SCOPE_RE, 'scope'],
      [ROLL_RE, 'roll'],
    ] as const) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) hits.push({ at: state.doc.lineAt(m.index).to, kind });
    }
    hits.sort((a, b) => a.at - b.at);
    const b = new RangeSetBuilder<Decoration>();
    for (const h of hits) {
      b.add(h.at, h.at, Decoration.widget({ widget: new VizWidget(h.kind, nodeId), block: true, side: 1 }));
    }
    return b.finish();
  } catch {
    return Decoration.none;
  }
}

export function inlineVizExtension(nodeId: string): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, nodeId),
    update: (value, tr) => (tr.docChanged ? build(tr.state, nodeId) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}
