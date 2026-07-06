import { useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeData } from '../graph/types';
import { registerScope, unregisterScope } from './scopeEngine';
import { registerActivity, unregisterActivity } from './meterEngine';
import { registerTiles, unregisterTiles } from './tilesEngine';
import { DEFAULT_SYNTH, DEFAULT_VOICE, DEFAULT_CHANNEL_EQ, type ChannelEq } from '../graph/types';
import { OPS, OPS_BY_ID } from '../graph/ops';
import { isPlainNumber } from '../graph/compile';
import { Knob } from '../ui/Knob';
import { useGraphStore } from '../store/useGraphStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { MiniEditor } from './MiniEditor';
import { SampleTrim } from './SampleTrim';
import { ArrangeStrip } from './ArrangeStrip';
import { GateStrip } from './GateStrip';
import { PlyStrip } from './PlyStrip';
import { StepSeq } from './StepSeq';
import { HoldFx } from '../ui/HoldFx';
import { ErrorBoundary } from '../ui/ErrorBoundary';

// ¿source melódico (note/n) editable en el piano roll inline? Una rejilla de batería
// `stack(...)` NO es melódica aunque tenga pistas AFINADAS (note-form) → se queda en la
// rejilla (StepSeq), no salta al piano roll (arregla quedar atrapado al afinar por paso).
function isMelodicSeq(code: string): boolean {
  if (/^\s*stack\s*\(/.test(code)) return false;
  return /\bnote\(\s*["'`]|\bn\(\s*["'`]/.test(code) && !/\.loopAt\(/.test(code) && !code.includes('arrange');
}
// ¿el source es editable en el secuenciador de rejilla? Melódico (note/n), percusivo
// (varios pasos o *N) o ARREGLADO por secciones (arrange → el secuenciador muestra
// pestañas y edita cada brazo; P0.3). Excluye solo loops de sample sueltos.
function isSeqable(code: string): boolean {
  if (/\barrange\s*\(/.test(code)) return true; // secciones: StepSeq edita cada brazo
  if (/\.loopAt\(/.test(code)) return false;
  if (/^\s*stack\s*\(/.test(code)) return true; // rejilla con acentos o pistas afinadas
  if (isMelodicSeq(code)) return true;
  const m = /\b(?:s|sound)\(\s*["'`]([^"'`]*)/.exec(code);
  if (!m || /\bnote\(|\bn\(/.test(code)) return false;
  return /\s/.test(m[1]) || /\*/.test(m[1]);
}
import { wrapNumberAtCursor } from './sliderWidget';
import { getEditor } from './highlight';
import { registerFlowNode, unregisterFlowNode } from './signalFlow';
import { Vu } from './Vu';

// V1a — "el grafo como señal viva": registra el DOM de este nodo para que signalFlow le
// escriba la variable CSS `--pulse` (0..1) según lo que dispara/propaga el grafo; el CSS
// la convierte en un halo. Imperativo, sin re-render por frame.
function useFlowGlow(id: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerFlowNode(id, el);
    return () => unregisterFlowNode(id);
  }, [id]);
  return ref;
}

// Marcadores de viz inline que el botón inserta/quita en el código del Source.
// El editor los dibuja entre las líneas; el compilador los retira al emitir.
const SCOPE_MARK = '._scope()';
const ROLL_MARK = '._pianoroll()';
function toggleMarker(code: string, mark: string): string {
  return code.includes(mark) ? code.split(mark).join('').trimEnd() : code.trimEnd() + mark;
}

const handleStyle = { width: 9, height: 9 } as const;

// Ojo abierto/cerrado en SVG (sin emojis, acorde a la estética terminal). §8
function Eye({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {open ? (
        <>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      ) : (
        <>
          <path d="M2 12s4-7 11-7c2 0 3.7.6 5.2 1.4M22 12s-4 7-11 7c-2 0-3.7-.6-5.2-1.4" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </>
      )}
    </svg>
  );
}

// "Hilo activo": punto que se ENCIENDE con el nivel real del source (concepto telar —
// un hilo del telar iluminándose al tejerse). Sustituye al viejo punto de "vista" (que
// sobraba): ahora indica de un vistazo qué instrumentos están sonando. Su brillo lo
// mueve el meterEngine vía la variable CSS --lvl.
function ActivityDot({ id }: { id: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerActivity(id, el);
    return () => unregisterActivity(id);
  }, [id]);
  return <span ref={ref} className="tn-live" title="hilo activo — este source está sonando" />;
}

// Cabecera común: badge de tipo, hilo activo (source), nombre editable, ojo, borrar.
function NodeHeader({
  id,
  data,
  badge,
  live,
  children,
}: {
  id: string;
  data: NodeData;
  badge: React.ReactNode;
  live?: boolean;
  children?: React.ReactNode;
}) {
  const update = useGraphStore((s) => s.updateNodeData);
  const remove = useGraphStore((s) => s.removeNode);
  const collapsed = !!data.collapsed;
  return (
    <header>
      <span className="tn-kind">{badge}</span>
      {live && <ActivityDot id={id} />}
      {children}
      <input
        className="tn-name nodrag"
        value={data.name ?? ''}
        placeholder="nombrar…"
        onChange={(e) => update(id, { name: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <button
        className="tn-eye nodrag"
        onClick={() => update(id, { collapsed: !collapsed })}
        title={collapsed ? 'mostrar código' : 'plegar'}
      >
        <Eye open={!collapsed} />
      </button>
      <button className="tn-x nodrag" onClick={() => remove(id)} title="borrar">×</button>
    </header>
  );
}

// Botón de la barra de herramientas (icono compacto, estado activo opcional).
function ToolBtn({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className={`tn-tool nodrag${active ? ' on' : ''}`}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// Barra de herramientas del Source: agrupa los toggles de vista + utilidades en
// una fila compacta de iconos, para no saturar la cabecera.
function SourceToolbar({ id, data }: { id: string; data: NodeData }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const savePattern = useLibraryStore((s) => s.save);
  const setVoiceEdit = useGraphStore((s) => s.setVoiceEdit);
  const setClipEdit = useGraphStore((s) => s.setClipEdit);
  const setSynthEdit = useGraphStore((s) => s.setSynthEdit);
  const playing = useGraphStore((s) => s.playing);
  const [open, setOpen] = useState(false);
  const [freezing, setFreezing] = useState(false);
  // Congelar (bounce): rinde esta rama a un sample y crea un Source congelado.
  const doFreeze = async () => {
    if (freezing || !playing) return;
    setFreezing(true);
    try {
      const { freezeSource } = await import('../audio/freeze');
      const res = await freezeSource(id, 2);
      if (res) useGraphStore.getState().commitFreeze(id, res.name, res.cycles);
    } finally {
      setFreezing(false);
    }
  };
  // Restablecer el CANAL a valores por defecto: mezcla (gain/filtro), mute/solo,
  // recorte, voz y synth vuelven a cero; se quitan los visualizadores del código.
  // NO borra el código del instrumento (el sonido base se conserva).
  const resetChannel = () => {
    update(id, {
      gain: 1, chFilter: 0, mute: false, solo: false,
      voice: undefined, synth: undefined, synthOn: false,
      begin: undefined, end: undefined,
      showMix: false, showTrim: false, showSynth: false, showVoice: false,
      code: (data.code ?? '').replace(/\._(?:scope|pianoroll)\(\)/g, '').trimEnd(),
    });
  };
  return (
    <div className="tn-toolbar nodrag">
      <button
        className={`tn-tool tn-tool-vista nodrag${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        onMouseDown={(e) => e.stopPropagation()}
        title="vista: paneles y visualizadores del canal"
      >
        vista {open ? '▴' : '▾'}
      </button>
      <button
        className={`tn-tool tn-tool-code nodrag${data.showCode ? ' on' : ''}`}
        onClick={() => update(id, { showCode: !data.showCode })}
        onMouseDown={(e) => e.stopPropagation()}
        title={data.showCode ? 'ocultar el código (ver el instrumento)' : 'mostrar el código del patrón'}
      >
        &lt;/&gt;
      </button>
      {open && (
      <>
      <ToolBtn onClick={resetChannel} title="restablecer el canal a valores por defecto (mezcla, recorte, voz y synth)">
        {/* flecha circular = restablecer */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
          <polyline points="3 3.5 3 8 7.5 8" />
        </svg>
      </ToolBtn>
      <ToolBtn
        active={!!data.synthOn}
        onClick={() => { update(id, { synth: data.synth ?? DEFAULT_SYNTH }); setSynthEdit(id); }}
        title={data.synthOn ? 'synth ACTIVO · abrir estudio' : 'abrir el estudio de synth (onda, envolvente por nodos, filtro, FM…)'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <line x1="9" y1="5" x2="9" y2="14" />
          <line x1="15" y1="5" x2="15" y2="14" />
        </svg>
      </ToolBtn>
      <ToolBtn
        active={!!data.voice}
        onClick={() => { update(id, { voice: data.voice ?? DEFAULT_VOICE }); setVoiceEdit(id); }}
        title="abrir estudio de voz (área dedicada): recorte · melodía/autotune · formante · espacio"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <rect x="9" y="2.5" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1="12" y1="18" x2="12" y2="21.5" />
        </svg>
      </ToolBtn>
      <ToolBtn
        active={(data.code ?? '').includes(SCOPE_MARK)}
        onClick={() => update(id, { code: toggleMarker(data.code ?? '', SCOPE_MARK) })}
        title="onda del instrumento (inserta ._scope() en el código)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h3l2-6 4 12 3-9 2 3h6" />
        </svg>
      </ToolBtn>
      <ToolBtn
        active={(data.code ?? '').includes(ROLL_MARK)}
        onClick={() => update(id, { code: toggleMarker(data.code ?? '', ROLL_MARK) })}
        title="piano roll inline (dibuja ._pianoroll() entre las líneas del código)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="3" y="14" width="5" height="4" rx="1" />
          <rect x="10" y="8" width="4" height="4" rx="1" />
          <rect x="16" y="11" width="5" height="4" rx="1" />
        </svg>
      </ToolBtn>
      <ToolBtn
        onClick={() => setClipEdit(id)}
        title="editor de clip: piano roll para dibujar el patrón de notas de este instrumento"
      >
        {/* teclas de piano = editor de clip */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <line x1="8" y1="4" x2="8" y2="20" />
          <line x1="13" y1="4" x2="13" y2="20" />
          <line x1="18" y1="4" x2="18" y2="20" />
        </svg>
      </ToolBtn>
      <ToolBtn active={!!data.showTrim} onClick={() => update(id, { showTrim: !data.showTrim })} title="recortar el sample">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="8.1" y1="8.1" x2="20" y2="20" />
          <line x1="8.1" y1="15.9" x2="20" y2="4" />
        </svg>
      </ToolBtn>
      <ToolBtn active={!!data.showMix} onClick={() => update(id, { showMix: !data.showMix })} title="mezcla: gain + filtro">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="8" y1="3" x2="8" y2="21" />
          <line x1="16" y1="3" x2="16" y2="21" />
          <rect x="5.5" y="7" width="5" height="3.4" rx="1" fill="currentColor" stroke="none" />
          <rect x="13.5" y="13" width="5" height="3.4" rx="1" fill="currentColor" stroke="none" />
        </svg>
      </ToolBtn>
      {(data.code ?? '').includes('arrange') && (
        <ToolBtn active={!!data.showArrange} onClick={() => update(id, { showArrange: !data.showArrange })} title="entradas: cuándo entra el sonido y cuántos ciclos dura cada sección">
          {/* bloques de secciones = editor de entradas/arreglo */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="2.5" y="8" width="5" height="8" rx="1" />
            <rect x="9.5" y="8" width="4" height="8" rx="1" fill="currentColor" stroke="none" />
            <rect x="15.5" y="8" width="6" height="8" rx="1" />
          </svg>
        </ToolBtn>
      )}
      {isSeqable(data.code ?? '') && (
        <ToolBtn active={!!data.showSeq} onClick={() => update(id, { showSeq: !data.showSeq })} title="secuenciador: rejilla multi-sonido — añade golpes y otros sonidos (tu/pa), previsualiza (sin código)">
          {/* rejilla 2×4 = secuenciador */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
            <rect x="10" y="4" width="4" height="4" rx="1" />
            <rect x="17" y="4" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
            <rect x="3" y="13" width="4" height="4" rx="1" />
            <rect x="10" y="13" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
            <rect x="17" y="13" width="4" height="4" rx="1" />
          </svg>
        </ToolBtn>
      )}
      <ToolBtn active={!!data.showGate} onClick={() => update(id, { showGate: !data.showGate })} title="rejilla de silencios: apaga pasos para meter espacios/silencios exactos en el patrón (sin código)">
        {/* rejilla con huecos = gate/silencios */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="2" y="9" width="4" height="6" rx="1" fill="currentColor" stroke="none" />
          <rect x="8" y="9" width="4" height="6" rx="1" />
          <rect x="14" y="9" width="4" height="6" rx="1" fill="currentColor" stroke="none" />
          <rect x="20" y="9" width="2" height="6" rx="1" />
        </svg>
      </ToolBtn>
      <ToolBtn active={!!data.showPly} onClick={() => update(id, { showPly: !data.showPly })} title="rejilla de rolls: repite pasos (×2/×3/×4) para redobles y fills (sin código)">
        {/* barras crecientes = rolls/repeticiones */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="13" width="3" height="5" rx="1" fill="currentColor" stroke="none" />
          <rect x="8" y="10" width="3" height="8" rx="1" fill="currentColor" stroke="none" />
          <rect x="13" y="7" width="3" height="11" rx="1" fill="currentColor" stroke="none" />
          <rect x="18" y="4" width="3" height="14" rx="1" fill="currentColor" stroke="none" />
        </svg>
      </ToolBtn>
      <ToolBtn
        active={freezing}
        disabled={!playing || freezing}
        onClick={doFreeze}
        title={playing
          ? 'congelar: rinde esta rama (con sus FX) a un sample y crea un canal congelado — aligera CPU'
          : 'reproduce (▶) para poder congelar esta rama a un sample'}
      >
        {/* copo de nieve = congelar/bounce */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="12" y1="2" x2="12" y2="22" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
          <line x1="19.1" y1="4.9" x2="4.9" y2="19.1" />
        </svg>
      </ToolBtn>
      <span className="tn-tool-sep" />
      <ToolBtn onClick={() => wrapNumberAtCursor(getEditor(id))} title="hacer deslizador: pon el cursor sobre un número del código y pulsa aquí para convertirlo en un slider en vivo">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="3" y1="12" x2="21" y2="12" />
          <circle cx="9" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      </ToolBtn>
      </>
      )}
      <span className="tn-tool-sep" />
      <ToolBtn
        active={!!data.solo}
        onClick={() => update(id, { solo: !data.solo })}
        title="solo: aísla este canal (silencia los demás) · tecla S"
      >
        {/* auriculares */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
          <rect x="2.5" y="13" width="4" height="7" rx="1.4" fill="currentColor" stroke="none" />
          <rect x="17.5" y="13" width="4" height="7" rx="1.4" fill="currentColor" stroke="none" />
        </svg>
      </ToolBtn>
      <ToolBtn
        onClick={() => savePattern(data.name?.trim() || 'patrón', (data.code ?? '').trim())}
        title="guardar patrón en biblioteca"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      </ToolBtn>
    </div>
  );
}

// Chip compacto mostrado cuando el nodo está plegado.
function CollapsedChip({ label }: { label: string }) {
  return <div className="tn-collapsed nodrag">{label}</div>;
}

// Tira de visualización (onda/pianoroll) para mostrar dentro de un Source PLEGADO:
// registra su canvas en el motor compartido por nodeId (mutuamente excluyente con
// el widget inline del editor, que no está montado al estar plegado).
function VizStrip({ nodeId, kind }: { nodeId: string; kind: 'scope' | 'roll' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    if (kind === 'roll') registerTiles(nodeId, c);
    else registerScope(nodeId, c);
    return () => {
      if (kind === 'roll') unregisterTiles(nodeId);
      else unregisterScope(nodeId);
    };
  }, [nodeId, kind]);
  return (
    <div className={`tn-cstrip tn-cstrip-${kind} nodrag`}>
      <canvas ref={ref} className="tn-cstrip-canvas" />
    </div>
  );
}

// Visual del INSTRUMENTO: onda (scope) en vivo siempre + piano roll si el código lo
// pide. Se muestra cuando el editor de código NO está montado (plegado, o desplegado
// sin "mostrar código") → identificas y monitorizas cada instrumento de un vistazo,
// sin el código ocupando espacio. (mutuamente excluyente con los widgets inline del
// editor, que registran el mismo scope por nodeId).
function InstrumentViz({ nodeId, code }: { nodeId: string; code: string }) {
  return (
    <>
      <VizStrip nodeId={nodeId} kind="scope" />
      {code.includes('._pianoroll()') && <VizStrip nodeId={nodeId} kind="roll" />}
    </>
  );
}

// --- Source: editor CM6 con mini-notación ---
// Fila de performance POR SOURCE (reemplaza la vieja leyenda de texto): throws
// momentáneos análogos a los del máster, aplicados solo a ESTE instrumento. roll/rev son
// a nivel de PATRÓN → caen en la frontera de ciclo; gate/echo/wash a nivel de AUDIO →
// responden al instante. Mantener = sostiene; shift+clic = fijar (HoldFx). Compacta; se
// muestra solo con el nodo seleccionado para no saturar el grafo.
function SourcePerfRow({ id, perf }: { id: string; perf: NodeData['perf'] }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const p = perf ?? {};
  const set = (patch: Partial<NonNullable<NodeData['perf']>>) => update(id, { perf: { ...p, ...patch } });
  const prevWash = useRef(0);
  return (
    <div className="tn-perf nodrag" onMouseDown={(e) => e.stopPropagation()}>
      <div className="tn-perf-grp">
        <span className="tn-perf-tag">roll</span>
        {[2, 4, 8, 16].map((n) => (
          <HoldFx key={n} label={`${n}`} title={`loop roll ×${n} — patrón, cae en la frontera de ciclo (mantén)`} active={p.roll === n} onDown={() => set({ roll: n })} onUp={() => set({ roll: 0 })} />
        ))}
      </div>
      <div className="tn-perf-grp">
        <HoldFx label="gate" title="gate rítmico — audio, al instante (mantén)" active={!!p.gate} onDown={() => set({ gate: 8 })} onUp={() => set({ gate: 0 })} />
        <HoldFx label="rev" title="reverse — patrón, cae en la frontera de ciclo (mantén)" active={!!p.rev} onDown={() => set({ rev: true })} onUp={() => set({ rev: false })} />
        <HoldFx label="echo" title="echo throw (dub) — audio, al instante, al tempo 3/16 (mantén)" active={(p.echo ?? 0) > 0.02} onDown={() => set({ echo: 0.55 })} onUp={() => set({ echo: 0 })} />
        <HoldFx label="wash" title="reverb wash — audio, al instante (mantén)" active={(p.wash ?? 0) > 0.02} onDown={() => { prevWash.current = p.wash ?? 0; set({ wash: 0.7 }); }} onUp={() => set({ wash: prevWash.current })} />
      </div>
    </div>
  );
}

function SourceNode({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  const update = useGraphStore((s) => s.updateNodeData);
  // ¿hay algún solo activo en el grafo? (para atenuar los canales no aislados)
  const anySolo = useGraphStore((s) => s.nodes.some((n) => n.data.kind === 'source' && n.data.solo));
  const collapsed = !!d.collapsed;
  const showMix = !!d.showMix;
  const showTrim = !!d.showTrim;
  const dimmed = anySolo && !d.solo; // silenciado por el solo de otro canal
  // El CÓDIGO es opt-in: por defecto se ve el VISUAL del instrumento (menos ruido en
  // pantalla, herramientas más a mano). Se muestra el editor solo con "mostrar código"
  // (o si el source está vacío, para poder escribir el patrón).
  const emptyCode = !(d.code ?? '').trim();
  const codeVisible = !collapsed && (!!d.showCode || emptyCode);
  const glowRef = useFlowGlow(id);
  return (
    <div
      ref={glowRef}
      className={`tn tn-source${selected ? ' sel' : ''}${collapsed ? ' is-collapsed' : ''}${d.mute ? ' is-cut' : ''}${d.solo ? ' is-solo' : ''}${dimmed ? ' is-dim' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        update(id, { mute: !d.mute });
      }}
    >
      <NodeHeader id={id} data={d} badge="source" live />
      <Vu id={id} className="vu-src" />
      {collapsed ? (
        <>
          <CollapsedChip label={d.name?.trim() || d.code?.trim() || 'patrón'} />
          {/* plegado: se ve el VISUAL del instrumento (onda en vivo) para guiarse */}
          <InstrumentViz nodeId={id} code={d.code ?? ''} />
        </>
      ) : (
        <>
          <SourceToolbar id={id} data={d} />
          {selected && <SourcePerfRow id={id} perf={d.perf} />}
          {codeVisible
            ? <MiniEditor nodeId={id} value={d.code ?? ''} onChange={(code) => update(id, { code })} />
            : <InstrumentViz nodeId={id} code={d.code ?? ''} />}
          {d.showArrange && (d.code ?? '').includes('arrange') && <ArrangeStrip id={id} code={d.code ?? ''} />}
          {/* el secuenciador es UNIVERSAL: también las melodías van a StepSeq (rejilla
              de pasos con afinación por arrastre, la disposición preferida); dentro
              ofrece el toggle a piano roll como vista alternativa del mismo código. */}
          {d.showSeq && <StepSeq id={id} code={d.code ?? ''} />}
          {d.showGate && <GateStrip id={id} code={d.code ?? ''} />}
          {d.showPly && <PlyStrip id={id} code={d.code ?? ''} />}
          {showTrim && <SampleTrim nodeId={id} code={d.code ?? ''} begin={d.begin} end={d.end} />}
          {showMix && (
            // mini-mezclador del canal: gain y filtro DJ (bipolar) en vivo.
            <div className="tn-mix nodrag">
              <label>
                <span>gain</span>
                <Knob
                  value={d.gain ?? 1}
                  min={0}
                  max={1.5}
                  step={0.01}
                  size={18}
                  defaultValue={1}
                  label="gain"
                  onChange={(v) => update(id, { gain: v })}
                />
              </label>
              <label>
                <span>filtro</span>
                <Knob
                  value={d.chFilter ?? 0}
                  min={-1}
                  max={1}
                  step={0.01}
                  size={18}
                  defaultValue={0}
                  label="filtro (− lpf · + hpf)"
                  onChange={(v) => update(id, { chFilter: v })}
                />
              </label>
              {/* THROW de eco (dub): momentáneo — manda el canal al delay mientras se
                  mantiene pulsado (el gesto clásico del dancehall sobre skank/voz).
                  Reusa la emisión perf.echo del compilador (delay sync 3/16). */}
              <button
                className={`tn-throw${d.perf?.echo ? ' on' : ''}`}
                title="throw de eco (dub): MANTÉN PULSADO para mandar este canal al delay — suelta y limpia. El eco cae al tempo (3/16, puntillo)."
                onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); update(id, { perf: { ...(d.perf ?? {}), echo: 0.55 } }); }}
                onPointerUp={() => update(id, { perf: { ...(d.perf ?? {}), echo: 0 } })}
                onLostPointerCapture={() => { if (d.perf?.echo) update(id, { perf: { ...(d.perf ?? {}), echo: 0 } }); }}
              >
                eco
              </button>
              <ChannelEqStrip id={id} data={d} />
            </div>
          )}
        </>
      )}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

// EQ paramétrico de 3 bandas POR CANAL (M1). Los valores en dB; el motor inserta
// filtros Biquad reales (low-shelf / peaking / high-shelf) sobre el orbit del canal.
// Botón EQ para activar (sin activar no gasta un orbit ni toca el enrutado).
function ChannelEqStrip({ id, data }: { id: string; data: NodeData }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const eq: ChannelEq = { ...DEFAULT_CHANNEL_EQ, ...(data.eq ?? {}) };
  const on = !!eq.on;
  const setEq = (patch: Partial<ChannelEq>) => update(id, { eq: { ...eq, ...patch } });
  const flat = (eq.low ?? 0) === 0 && (eq.mid ?? 0) === 0 && (eq.high ?? 0) === 0;
  return (
    <div className={`tn-cheq${on ? ' on' : ''}`}>
      <button
        className="tn-cheq-toggle"
        onClick={() => setEq({ on: !on })}
        title="EQ paramétrico de 3 bandas (graves/medios/agudos) del canal"
      >
        EQ{on ? ' •' : ''}
      </button>
      {on && (
        <div className="tn-cheq-bands">
          <label><span>grave</span><Knob value={eq.low ?? 0} min={-15} max={15} step={0.5} size={22} defaultValue={0} label="graves dB" onChange={(v) => setEq({ low: v })} /></label>
          <label><span>medio</span><Knob value={eq.mid ?? 0} min={-15} max={15} step={0.5} size={22} defaultValue={0} label="medios dB" onChange={(v) => setEq({ mid: v })} /></label>
          <label><span>agudo</span><Knob value={eq.high ?? 0} min={-15} max={15} step={0.5} size={22} defaultValue={0} label="agudos dB" onChange={(v) => setEq({ high: v })} /></label>
          <label><span>frec</span><Knob value={eq.midFreq ?? 1000} min={300} max={6000} step={10} size={22} defaultValue={1000} label="frecuencia medios (Hz)" scale="exp" onChange={(v) => setEq({ midFreq: Math.round(v) })} /></label>
          {flat && <span className="tn-cheq-hint">plano · sube/baja una banda</span>}
        </div>
      )}
    </div>
  );
}

// Etiqueta legible de un Source para el selector de disparador del sidechain.
function srcLabel(n: { id: string; data: NodeData }): string {
  const nm = (n.data.name ?? '').trim();
  if (nm) return nm;
  const code = n.data.code ?? '';
  const m = /s\(\s*["'`]([^"'`]+)/.exec(code) || /note\(\s*["'`]([^"'`]+)/.exec(code);
  if (m) return m[1].slice(0, 14);
  return n.id.slice(0, 6);
}

// Controles del nodo SIDECHAIN: modo tremolo (LFO genérico) o "por kick" (ducking
// real disparado por una fuente elegida). En modo duck, un selector del bombo +
// depth/attack; el compilador enruta la rama a un orbit y duckea con ese kick.
function SidechainControls({ id, d }: { id: string; d: NodeData }) {
  const update = useGraphStore((s) => s.updateNodeData);
  // OJO zustand v5: un selector que devuelve un array NUEVO (.filter) provoca bucle
  // infinito ("Maximum update depth"). Seleccionamos la referencia estable `nodes` y
  // filtramos en el render.
  const nodes = useGraphStore((s) => s.nodes);
  const sources = nodes.filter((n) => (n.data as NodeData).kind === 'source');
  const isDuck = String(d.params?.mode ?? 'gen') === 'duck';
  const setP = (patch: Record<string, number | string>) => update(id, { params: { ...d.params, ...patch } });
  const depth = Number(d.params?.depth ?? 0.7);
  const rate = Number(d.params?.rate ?? 4);
  const attack = Number(d.params?.attack ?? 0.1);
  const trigger = String(d.params?.trigger ?? '');
  const trigOk = isDuck && !!trigger && sources.some((n) => n.id === trigger);
  return (
    <div className="tn-params tn-sidechain nodrag" onMouseDown={(e) => e.stopPropagation()}>
      <div className="tn-sc-mode">
        <button className={!isDuck ? 'on' : ''} onClick={() => setP({ mode: 'gen' })} title="pump con LFO (sin fuente): ideal para pads/acordes sostenidos">tremolo</button>
        <button className={isDuck ? 'on' : ''} onClick={() => setP({ mode: 'duck' })} title="ducking REAL disparado por el bombo que elijas (sidechain de mezcla)">por kick</button>
      </div>
      {isDuck ? (
        <>
          <label className="tn-sc-trig">
            <span>bombo</span>
            <select value={trigger} onChange={(e) => setP({ trigger: e.target.value })} title="fuente que dispara el ducking (el bombo). Debe estar conectada al Out y sonando.">
              <option value="">elige el kick…</option>
              {sources.filter((n) => n.id !== id).map((n) => <option key={n.id} value={n.id}>{srcLabel(n)}</option>)}
            </select>
          </label>
          <div className="tn-sc-knobs">
            <label><span>depth</span><Knob value={depth} min={0} max={1} step={0.05} size={18} defaultValue={0.7} label="depth" onChange={(v) => setP({ depth: v })} /></label>
            <label><span>attack</span><Knob value={attack} min={0.005} max={0.5} step={0.005} size={18} defaultValue={0.1} label="attack" onChange={(v) => setP({ attack: v })} /></label>
          </div>
          {!trigOk && <p className="tn-sc-warn">elige el bombo · sin disparador válido suena como tremolo</p>}
        </>
      ) : (
        <div className="tn-sc-knobs">
          <label><span>depth</span><Knob value={depth} min={0} max={0.95} step={0.05} size={18} defaultValue={0.7} label="depth" onChange={(v) => setP({ depth: v })} /></label>
          <label><span>beats</span><Knob value={rate} min={1} max={16} step={1} size={18} defaultValue={4} label="beats" onChange={(v) => setP({ rate: v })} /></label>
        </div>
      )}
    </div>
  );
}

// --- Transform / FX: op (reemplazable) + params ---
function OpNode({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  const op = d.opId ? OPS_BY_ID[d.opId] : undefined;
  const update = useGraphStore((s) => s.updateNodeData);
  const replaceOp = useGraphStore((s) => s.replaceOp);
  const isFx = d.kind === 'fx';
  const collapsed = !!d.collapsed;
  const choices = OPS.filter((o) => o.kind === (isFx ? 'fx' : 'transform'));

  // Selector de operación → reemplazo instantáneo (lpf↔hpf, fast↔slow…).
  const opSelect = (
    <select
      className="tn-op-select nodrag"
      value={d.opId ?? ''}
      onChange={(e) => replaceOp(id, e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      title="cambiar operación"
    >
      {choices.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div
      ref={useFlowGlow(id)}
      className={`tn ${isFx ? 'tn-fx' : 'tn-transform'}${selected ? ' sel' : ''}${collapsed ? ' is-collapsed' : ''}${d.mute ? ' is-cut' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        update(id, { mute: !d.mute });
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <NodeHeader id={id} data={d} badge={isFx ? 'fx' : 'transform'}>
        {opSelect}
      </NodeHeader>
      {collapsed ? (
        <CollapsedChip label={d.name?.trim() || op?.label || d.opId || 'op'} />
      ) : op && op.id === 'sidechain' ? (
        <SidechainControls id={id} d={d} />
      ) : (
        op &&
        op.params.length > 0 && (
          <div className="tn-params nodrag">
            {op.params.map((p) => {
              const raw = String(d.params?.[p.key] ?? p.default);
              const isNum = p.kind === 'number';
              const isExpr = isNum && !isPlainNumber(raw); // señal de automatización
              const setVal = (v: string | number) =>
                update(id, { params: { ...d.params, [p.key]: v } });
              const showKnob = isNum && !isExpr;
              return (
                <label key={p.key} className={isExpr ? 'mod' : undefined}>
                  <span>{p.label}</span>
                  <div className="tn-param-field">
                    {showKnob ? (
                      // perilla rotatoria: arrastra para alterar la potencia
                      <Knob
                        value={Number(raw)}
                        min={p.min ?? 0}
                        max={p.max ?? (Number(p.default) || 1) * 4}
                        step={p.step}
                        scale={p.scale}
                        size={18}
                        defaultValue={Number(p.default)}
                        label={p.label}
                        onChange={(v) => setVal(v)}
                      />
                    ) : (
                      <input
                        type="text"
                        className={isExpr ? 'expr' : undefined}
                        value={raw}
                        placeholder={isExpr ? 'sine.range(a,b).slow(n)' : undefined}
                        onChange={(e) => setVal(e.target.value)}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    )}
                    {isNum && (
                      // ∿ alterna entre perilla (valor fijo) y señal modulada
                      <button
                        className={`tn-mod${isExpr ? ' on' : ''}`}
                        title={isExpr ? 'valor fijo (perilla)' : 'modular con señal'}
                        onClick={() =>
                          setVal(isExpr ? Number(p.default) : `sine.range(0, ${p.default}).slow(8)`)
                        }
                      >
                        ∿
                      </button>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )
      )}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

// --- Out: terminal hacia el scheduler; tiene el tap del visualizador ---
function OutNode({ id, data, selected }: NodeProps) {
  const d = data as NodeData;
  const update = useGraphStore((s) => s.updateNodeData);
  return (
    <div
      ref={useFlowGlow(id)}
      className={`tn tn-out${selected ? ' sel' : ''}${d.mute ? ' is-cut' : ''}`}
      title="arrastrar: mover sólo el out · Alt+arrastrar: mover todo el patch · clic derecho: mute"
      onContextMenu={(e) => {
        e.preventDefault();
        update(id, { mute: !d.mute });
      }}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <header>
        <span className="tn-kind">out</span>
        <span className="tn-out-tag">{d.mute ? 'mute' : 'master'}</span>
      </header>
      <div className="tn-out-body">{d.mute ? '× silenciado' : '⊳ scope tap · sink'}</div>
    </div>
  );
}

// Envuelve cada tipo de nodo en una red de seguridad: si su render lanza, se muestra
// un chip de error EN ESE nodo (no se cae todo el lienzo). SIN `key` que dependa del
// código: remontar en cada tecla destruiría el editor. La recuperación es manual (clic
// «reintentar») o global (Ctrl+Z), que es lo que se necesita para un nodo roto.
function withNodeBoundary<P extends NodeProps>(Comp: (props: P) => React.ReactNode) {
  return function Guarded(props: P) {
    const d = props.data as NodeData;
    const label = (d.name?.trim() || (typeof d.code === 'string' ? d.code.trim().slice(0, 18) : d.opId) || props.id) as string;
    return (
      <ErrorBoundary variant="node" label={label}>
        <Comp {...props} />
      </ErrorBoundary>
    );
  };
}

export const nodeTypes = {
  source: withNodeBoundary(SourceNode),
  transform: withNodeBoundary(OpNode),
  fx: withNodeBoundary(OpNode),
  out: withNodeBoundary(OutNode),
};
