import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { MiniEditor } from '../nodes/MiniEditor';
import { AnalyserScope } from './AnalyserScope';
import { Knob } from './Knob';
import { Fader } from './Fader';
import { Vu } from '../nodes/Vu';
import { Performance } from './Performance';
import { DEFAULT_CHANNEL_EQ, type ChannelEq, type NodeData } from '../graph/types';

// MODO DJ — mixer de PERFORMANCE de N canales (consola tipo Pioneer/Xone adaptada a
// que los "decks" son PATRONES vivos, no dos tracks terminados). Cada deck trae:
//   • EQ de 3 bandas con KILL (reusa el EQ por-canal real del motor, filtros Biquad),
//   • filtro DJ (lp◄►hp), gain con VU,
//   • FX MOMENTÁNEOS por deck (roll/echo/gate) que se sostienen mientras pulsas,
//   • asignación al CROSSFADER (A/B) — el fader vive en la consola central.
// La consola central = crossfader + máster (Performance) + escenas.

// Botón de FX MOMENTÁNEO: activo mientras lo mantienes; con SHIFT queda fijado (latch)
// hasta soltar Shift (cursor libre para tocar varias cosas).
function HoldFx({ label, title, active, onDown, onUp }: { label: string; title: string; active: boolean; onDown: () => void; onUp: () => void }) {
  const [latched, setLatched] = useState(false);
  const press = (e: React.PointerEvent) => {
    e.preventDefault();
    onDown();
    if (e.shiftKey) {
      setLatched(true);
      const onKeyUp = (ke: KeyboardEvent) => {
        if (ke.key === 'Shift') { setLatched(false); onUp(); window.removeEventListener('keyup', onKeyUp); }
      };
      window.addEventListener('keyup', onKeyUp);
    } else {
      const up = () => { onUp(); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointerup', up);
    }
  };
  return (
    <button className={`deck-hold${active ? ' on' : ''}${latched ? ' latched' : ''}`} title={`${title} · shift+clic = fijar`}
      onPointerDown={press} onMouseDown={(e) => e.preventDefault()}>
      {label}
    </button>
  );
}

const KILL = -30; // dB de corte del KILL (el compilador permite hasta −30)

function Deck({ id, data, showCode }: { id: string; data: NodeData; showCode: boolean }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const remove = useGraphStore((s) => s.removeNode);
  const anySolo = useGraphStore((s) => s.nodes.some((n) => n.data.kind === 'source' && n.data.solo));
  const muted = !!data.mute;
  const soloed = !!data.solo;
  const dimmed = anySolo && !soloed;

  const eq: ChannelEq = { ...DEFAULT_CHANNEL_EQ, ...(data.eq ?? {}) };
  const setEq = (patch: Partial<ChannelEq>) => update(id, { eq: { ...eq, on: true, ...patch } });
  const killed = (band: 'low' | 'mid' | 'high') => (eq[band] ?? 0) <= KILL + 1;
  const toggleKill = (band: 'low' | 'mid' | 'high') => setEq({ [band]: killed(band) ? 0 : KILL } as Partial<ChannelEq>);

  const xfa = data.xfa as 'a' | 'b' | undefined;
  const setXfa = (side: 'a' | 'b') => update(id, { xfa: xfa === side ? undefined : side });

  const perf = (data.perf ?? {}) as { roll?: number; gate?: number; echo?: number };
  const setPerf = (patch: Partial<typeof perf>) => update(id, { perf: { ...perf, ...patch } });

  const band = (label: string, key: 'low' | 'mid' | 'high') => (
    <div className="deck-eqband">
      <Knob value={eq[key] ?? 0} min={-26} max={6} step={0.5} size={30} defaultValue={0} label={`EQ ${label} (dB)`} hideValue
        onChange={(v) => setEq({ [key]: v } as Partial<ChannelEq>)} />
      <button className={`deck-kill${killed(key) ? ' on' : ''}`} onClick={() => toggleKill(key)} title={`kill ${label}`}>{label}</button>
    </div>
  );

  return (
    <div className={`ch deck${muted ? ' muted' : ''}${soloed ? ' soloed' : ''}${dimmed ? ' dimmed' : ''}`}>
      <div className="ch-head">
        <input className="ch-name" value={data.name ?? ''} placeholder="deck…" onChange={(e) => update(id, { name: e.target.value })} />
        <div className="deck-xf" title="asignar al crossfader (A/B)">
          <button className={`deck-xfbtn${xfa === 'a' ? ' on' : ''}`} onClick={() => setXfa('a')}>A</button>
          <button className={`deck-xfbtn${xfa === 'b' ? ' on' : ''}`} onClick={() => setXfa('b')}>B</button>
        </div>
        <button className="ch-x" title="quitar deck" onClick={() => remove(id)}>×</button>
      </div>

      {showCode ? (
        <div className="ch-code"><MiniEditor nodeId={id} value={data.code ?? ''} wrap={false} onChange={(code) => update(id, { code })} /></div>
      ) : (
        <div className="ch-scope"><AnalyserScope nodeId={id} className="ch-scope-canvas" /></div>
      )}

      {/* EQ 3 bandas + KILL */}
      <div className="deck-eq">
        {band('hi', 'high')}
        {band('mid', 'mid')}
        {band('lo', 'low')}
      </div>

      {/* filtro + gain */}
      <div className="ch-deckctl">
        <div className="ch-knob">
          <Knob value={data.chFilter ?? 0} min={-1} max={1} step={0.01} size={34} defaultValue={0} label="filtro DJ (lp◄►hp)" hideValue
            onChange={(v) => update(id, { chFilter: v })} />
          <span>filter</span>
        </div>
        <div className="ch-fadercell">
          <div className="ch-fadermeter">
            <Fader value={data.gain ?? 1} min={0} max={1.5} step={0.01} defaultValue={1} height={90} label="gain del canal"
              onChange={(v) => update(id, { gain: v })} />
            <Vu id={id} className="vu-vert" />
          </div>
          <span>gain</span>
        </div>
      </div>

      {/* FX momentáneos por deck */}
      <div className="deck-fx">
        <HoldFx label="roll4" title="loop roll ×4 (mantén)" active={perf.roll === 4} onDown={() => setPerf({ roll: 4 })} onUp={() => setPerf({ roll: 0 })} />
        <HoldFx label="roll8" title="loop roll ×8 (mantén)" active={perf.roll === 8} onDown={() => setPerf({ roll: 8 })} onUp={() => setPerf({ roll: 0 })} />
        <HoldFx label="gate" title="gate rítmico (mantén)" active={!!perf.gate} onDown={() => setPerf({ gate: 8 })} onUp={() => setPerf({ gate: 0 })} />
        <HoldFx label="echo" title="echo throw (mantén)" active={!!perf.echo} onDown={() => setPerf({ echo: 0.6 })} onUp={() => setPerf({ echo: 0 })} />
      </div>

      <div className="ch-ms">
        <button className={`ch-mute${muted ? ' on' : ''}`} onClick={() => update(id, { mute: !muted })}>{muted ? 'muted' : 'mute'}</button>
        <button className={`ch-solo${soloed ? ' on' : ''}`} onClick={() => update(id, { solo: !soloed })} title="solo/cue: aísla este deck">cue</button>
      </div>
    </div>
  );
}

// Crossfader horizontal (curva de potencia constante en el compilador). Doble clic = centro.
function Crossfader() {
  const xfader = useGraphStore((s) => s.xfader);
  const setXfader = useGraphStore((s) => s.setXfader);
  return (
    <div className="dj-xfader">
      <span className="dj-xf-side">A</span>
      <input className="dj-xf-range" type="range" min={0} max={1} step={0.01} value={xfader}
        onChange={(e) => setXfader(Number(e.target.value))}
        onDoubleClick={() => setXfader(0.5)} title="crossfader A ◄► B · doble clic = centro" />
      <span className="dj-xf-side">B</span>
    </div>
  );
}

export function DjMixer() {
  const nodes = useGraphStore((s) => s.nodes);
  const orientation = useGraphStore((s) => s.djOrientation);
  const addSourceToOut = useGraphStore((s) => s.addSourceToOut);
  const showCode = useGraphStore((s) => s.djShowCode);
  const setDjShowCode = useGraphStore((s) => s.setDjShowCode);
  const sources = nodes.filter((n) => n.data.kind === 'source');

  return (
    <div className={`dj dj-${orientation}`}>
      <div className="dj-decks">
        {sources.map((n) => (
          <Deck key={n.id} id={n.id} data={n.data as NodeData} showCode={showCode} />
        ))}
        <button className="dj-add" onClick={addSourceToOut} title="añadir deck">+ deck</button>
      </div>

      {/* consola central: crossfader + máster + FX de performance + escenas */}
      <div className="dj-console">
        <div className="dj-bar">
          <span className="dj-bar-brand">MASTER</span>
          <button className={`dj-codebtn${showCode ? ' on' : ''}`} onClick={() => setDjShowCode(!showCode)}
            title={showCode ? 'colapsar a ondas (decks tipo Traktor)' : 'mostrar los editores de código'}>
            {showCode ? 'código ▾' : 'ondas ▸'}
          </button>
        </div>
        <Crossfader />
        <Performance />
      </div>
    </div>
  );
}
