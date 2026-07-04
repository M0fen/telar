import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { tokens } from '../theme/tokens';
import { highlightExtension, registerEditor, unregisterEditor } from './highlight';
import { sliderExtension } from './sliderWidget';
import { inlineVizExtension } from './inlineViz';

// Editor de mini-notación dentro de cada nodo Source. Cursor de bloque, tema
// terminal, alto contraste. (master-prompt §8)
const highlight = HighlightStyle.define([
  { tag: [t.string, t.special(t.string)], color: tokens.accent },
  { tag: [t.number], color: '#e0c060' },
  { tag: [t.propertyName, t.function(t.variableName)], color: tokens.text },
  { tag: [t.operator, t.punctuation], color: tokens.textDim },
  { tag: [t.comment], color: tokens.textFaint, fontStyle: 'italic' },
]);

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: tokens.text, fontSize: '13px' },
    '.cm-content': { fontFamily: tokens.fontMono, caretColor: tokens.accent, padding: '6px 4px' },
    '.cm-cursor, .cm-dropCursor': { borderLeft: `8px solid ${tokens.accent}`, marginLeft: '-1px' },
    '.cm-line': { padding: '0 4px' },
    '.cm-gutters': { backgroundColor: 'transparent', color: tokens.textFaint, border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(61,240,208,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(61,240,208,0.18) !important' },
  },
  { dark: true }
);

export function MiniEditor({
  nodeId,
  value,
  onChange,
  wrap = true,
}: {
  nodeId: string;
  value: string;
  onChange: (v: string) => void;
  // wrap=false → sin lineWrapping (scroll horizontal). En cajas MUY estrechas (deck DJ)
  // el wrapping colapsa a 1 carácter por línea y estira la caja: ahí conviene false.
  wrap?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!ref.current) return;
    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          javascript(),
          syntaxHighlighting(highlight),
          highlightExtension(),
          sliderExtension(),
          inlineVizExtension(nodeId),
          theme,
          ...(wrap ? [EditorView.lineWrapping] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    registerEditor(nodeId, view);
    // Evita que el drag de React Flow secuestre el teclado/ratón del editor.
    const stop = (e: Event) => e.stopPropagation();
    ref.current.addEventListener('mousedown', stop);
    ref.current.addEventListener('keydown', stop);
    return () => {
      unregisterEditor(nodeId);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza cambios externos (ej. reset) sin romper el cursor en cada tecla.
  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={ref} className="mini-editor nodrag nowheel" />;
}
