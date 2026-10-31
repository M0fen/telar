import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { MiniEditor } from '../nodes/MiniEditor';
import { AnalyserScope } from './AnalyserScope';
import { Knob } from './Knob';
import { Fader } from './Fader';
import { Vu } from '../nodes/Vu';
import { Performance } from './Performance';
import { MidiLive } from './MidiLive';
import { Palette } from './Palette';
import { ErrorBoundary } from './ErrorBoundary';
import { useSequencerStore } from '../store/useSequencerStore';
import { useMidiStore, midiKeyLabel } from '../store/useMidiStore';
import { connectMidi } from '../audio/midiIn';
import { djSlotName, deckSlot } from '../audio/djMidi';
import { deckEq, eqPatch, EQ_MAX, EQ_MIN, isDeck, isKilled, killPatch, useDjStore, type EqBand } from '../audio/djMix';
import { canPickOutput, listOutputs, syncHeadphones, type OutputDevice } from '../audio/cueOut';
import { importDroppedFiles } from '../lib/dropFiles';
import { toast } from '../store/useNotifyStore';
import type { NodeData } from '../graph/types';

// MODO DJ — mesa de PERFORMANCE de N canales (consola tipo Pioneer/Xone adaptada a que los "decks"
// son PATRONES vivos, no dos temas terminados). Cada deck trae EQ de 3 bandas con KILL, filtro DJ,
// volumen con VU, FX momentáneos (roll/gate/echo), asignación al crossfader y mute / solo / cue.
// Volumen, crossfader, filtro, EQ, mute y solo actúan EN EL BUS del deck (al instante, aunque suene
// un loop largo); mute/solo caen en el 1 del próximo compás con «al compás». El CUE va a los
// audífonos (otra salida), antes del fader: se escucha un deck sin que la sala lo oiga.
// Consola: crossfader, audífonos, y en pestañas el máster, EN VIVO (MIDI) y los SONIDOS.

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

// etiqueta del control MIDI asignado a un slot (o nada)
function MK({ slot }: { slot: string }) {
  const key = useMidiStore((s) => Object.keys(s.map).find((k) => s.map[k] === slot) ?? '');
  return key ? <i className="mk">{midiKeyLabel(key)}</i> : null;
}

// «quitar deck» en dos toques (el primero arma, 3 s para confirmar): nada se borra de un clic
function RemoveDeck({ id }: { id: string }) {
  const remove = useGraphStore((s) => s.removeNode);
  const [armed, setArmed] = useState(false);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return (
    <button className={`ch-x${armed ? ' armed' : ''}`} title={armed ? 'toca otra vez para quitar el deck (Ctrl+Z lo devuelve)' : 'quitar deck'}
      onClick={() => {
        if (!armed) { setArmed(true); t.current = window.setTimeout(() => setArmed(false), 3000); return; }
        window.clearTimeout(t.current);
        remove(id);
      }}>
      {armed ? '¿quitar?' : '×'}
    </button>
  );
}

function Deck({ id, data, index, showCode }: { id: string; data: NodeData; index: number; showCode: boolean }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const anySolo = useGraphStore((s) => s.nodes.some((n) => isDeck(n as { id: string; data: NodeData }) && n.data.solo));
  const cue = useDjStore((s) => !!s.cue[id]);
  const toggleCue = useDjStore((s) => s.toggleCue);
  const pending = useDjStore((s) => s.pending[id] != null);
  const hpOn = useDjStore((s) => !!s.hp.device);
  const muted = !!data.mute;
  const soloed = !!data.solo;
  const dimmed = anySolo && !soloed;
  const slot = (what: string) => deckSlot(index, what);

  const eq = deckEq(data);
  const xfa = data.xfa as 'a' | 'b' | undefined;
  const setXfa = (side: 'a' | 'b') => update(id, { xfa: xfa === side ? undefined : side });

  const perf = (data.perf ?? {}) as { roll?: number; gate?: number; echo?: number };
  const setPerf = (patch: Partial<typeof perf>) => update(id, { perf: { ...perf, ...patch } });

  const onCue = () => {
    toggleCue(id);
    if (!hpOn && !cue) toast.info('Elige la salida de audífonos (🎧) en la consola para oír el cue.');
  };

  const band = (label: string, key: EqBand) => (
    <div className="deck-eqband">
      <span className="deck-learn" data-midi={slot(`eq${key}`)}>
        <Knob value={eq[key] ?? 0} min={EQ_MIN} max={EQ_MAX} step={0.5} size={30} defaultValue={0} label={`EQ ${label} (dB)`} hideValue
          onChange={(v) => update(id, eqPatch(data, { [key]: v }))} />
        <MK slot={slot(`eq${key}`)} />
      </span>
      <button className={`deck-kill${isKilled(data, key) ? ' on' : ''}`} data-midi={slot(`kill${key}`)} onClick={() => update(id, killPatch(data, key))} title={`kill ${label}`}>
        {label}<MK slot={slot(`kill${key}`)} />
      </button>
    </div>
  );

  return (
    <div className={`ch deck${muted ? ' muted' : ''}${soloed ? ' soloed' : ''}${dimmed ? ' dimmed' : ''}${cue ? ' cued' : ''}${pending ? ' pending' : ''}`}>
      <div className="ch-head">
        <span className="deck-num" title={`deck ${index + 1}`}>{index + 1}</span>
        <input className="ch-name" value={data.name ?? ''} placeholder="deck…" onChange={(e) => update(id, { name: e.target.value })} />
        <div className="deck-xf" title="asignar al crossfader (A/B)">
          <button className={`deck-xfbtn${xfa === 'a' ? ' on' : ''}`} onClick={() => setXfa('a')}>A</button>
          <button className={`deck-xfbtn${xfa === 'b' ? ' on' : ''}`} onClick={() => setXfa('b')}>B</button>
        </div>
        <RemoveDeck id={id} />
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

      {/* filtro + volumen */}
      <div className="ch-deckctl">
        <div className="ch-knob deck-learn" data-midi={slot('filter')}>
          <Knob value={data.chFilter ?? 0} min={-1} max={1} step={0.01} size={34} defaultValue={0} label="filtro DJ (lp◄►hp)" hideValue
            onChange={(v) => update(id, { chFilter: v })} />
          <span>filter<MK slot={slot('filter')} /></span>
        </div>
        <div className="ch-fadercell deck-learn" data-midi={slot('gain')}>
          <div className="ch-fadermeter">
            <Fader value={data.gain ?? 1} min={0} max={1.5} step={0.01} defaultValue={1} height={90} label="volumen del deck"
              onChange={(v) => update(id, { gain: v })} />
            <Vu id={id} className="vu-vert" />
          </div>
          <span>gain<MK slot={slot('gain')} /></span>
        </div>
      </div>

      {/* FX momentáneos por deck */}
      <div className="deck-fx">
        <HoldFx label="roll4" title="loop roll ×4 (mantén)" active={perf.roll === 4} onDown={() => setPerf({ roll: 4 })} onUp={() => setPerf({ roll: 0 })} />
        <HoldFx label="roll8" title="loop roll ×8 (mantén)" active={perf.roll === 8} onDown={() => setPerf({ roll: 8 })} onUp={() => setPerf({ roll: 0 })} />
        <HoldFx label="gate" title="gate rítmico (mantén)" active={!!perf.gate} onDown={() => setPerf({ gate: 8 })} onUp={() => setPerf({ gate: 0 })} />
        <HoldFx label="echo" title="echo throw (mantén)" active={!!perf.echo} onDown={() => setPerf({ echo: 0.6 })} onUp={() => setPerf({ echo: 0 })} />
      </div>

      <div className="ch-ms deck-ms">
        <button className={`ch-mute${muted ? ' on' : ''}`} data-midi={slot('mute')} onClick={() => update(id, { mute: !muted })}
          title={pending ? 'entra/sale en el 1 del próximo compás' : muted ? 'en silencio en la sala: toca para que entre' : 'sonando: toca para callarlo'}>
          {muted ? 'muted' : 'mute'}<MK slot={slot('mute')} />
        </button>
        <button className={`ch-solo${soloed ? ' on' : ''}`} data-midi={slot('solo')} onClick={() => update(id, { solo: !soloed })} title="solo: en la sala suena solo este deck (y los otros en solo)">
          solo<MK slot={slot('solo')} />
        </button>
        <button className={`deck-cue${cue ? ' on' : ''}`} data-midi={slot('cue')} onClick={onCue} title="cue: escúchalo en los audífonos (antes de su volumen; la sala no lo oye)">
          🎧<MK slot={slot('cue')} />
        </button>
      </div>
    </div>
  );
}

// Crossfader horizontal (curva de potencia constante) + «al compás». Doble clic = centro.
function Crossfader() {
  const xfader = useGraphStore((s) => s.xfader);
  const setXfader = useGraphStore((s) => s.setXfader);
  const quantize = useDjStore((s) => s.quantize);
  const setQuantize = useDjStore((s) => s.setQuantize);
  return (
    <div className="dj-xfrow">
      <div className="dj-xfader" data-midi="dj.xfader">
        <span className="dj-xf-side">A</span>
        <input className="dj-xf-range" type="range" min={0} max={1} step={0.01} value={xfader}
          onChange={(e) => setXfader(Number(e.target.value))}
          onDoubleClick={() => setXfader(0.5)} title="crossfader A ◄► B · doble clic = centro" />
        <span className="dj-xf-side">B</span>
        <MK slot="dj.xfader" />
      </div>
      <button className={`dj-q${quantize ? ' on' : ''}`} data-midi="dj.quant" onClick={() => setQuantize(!quantize)}
        title={quantize ? 'mute y solo caen en el 1 del próximo compás (toca para que sean al instante)' : 'mute y solo al instante (toca para que caigan en el compás)'}>
        ♩ {quantize ? 'al compás' : 'al toque'}<MK slot="dj.quant" />
      </button>
    </div>
  );
}

// AUDÍFONOS: salida aparte para el cue (+ algo de máster, a gusto) y su volumen
function Headphones() {
  const hp = useDjStore((s) => s.hp);
  const setHp = useDjStore((s) => s.setHp);
  const playing = useGraphStore((s) => s.playing);
  const [devs, setDevs] = useState<OutputDevice[]>([]);
  const [msg, setMsg] = useState('');
  const can = canPickOutput();
  useEffect(() => { if (can) void listOutputs(false).then(setDevs); }, [can]);
  useEffect(() => {
    let alive = true;
    const run = () => void syncHeadphones(hp.device, hp.mix, hp.vol).then((m) => { if (alive) setMsg(m ?? ''); });
    run();
    // se rearma solo si el motor se reinicia o el máster se reconstruye
    const t = hp.device ? window.setInterval(run, 2000) : undefined;
    return () => { alive = false; window.clearInterval(t); };
  }, [hp.device, hp.mix, hp.vol, playing]);
  if (!can) return <p className="dj-hp-msg">🎧 Para audífonos aparte usa Chrome o Edge (este navegador no deja elegir la salida).</p>;
  const known = !hp.device || devs.some((d) => d.id === hp.device);
  return (
    <div className="dj-hp">
      <span className="dj-hp-ico" title="audífonos (cue)">🎧</span>
      <select className="dj-hp-dev" value={hp.device ?? ''} onChange={(e) => setHp({ device: e.target.value || null })} title="salida de los audífonos (otra que la de la sala)">
        <option value="">audífonos apagados</option>
        {!known && <option value={hp.device ?? ''}>salida guardada</option>}
        {devs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      <button className="dj-hp-scan" onClick={() => void listOutputs(true).then(setDevs)} title="buscar salidas (pide permiso de audio una vez para ver sus nombres; no graba nada)">↻</button>
      <div className="dj-hp-knob">
        <Knob value={hp.mix} min={0} max={1} step={0.01} size={24} defaultValue={0.25} label="audífonos: cue ◄► máster" hideValue onChange={(v) => setHp({ mix: v })} />
        <span>cue·mst</span>
      </div>
      <div className="dj-hp-knob">
        <Knob value={hp.vol} min={0} max={1.5} step={0.01} size={24} defaultValue={1} label="volumen de los audífonos" hideValue onChange={(v) => setHp({ vol: v })} />
        <span>vol</span>
      </div>
      {msg && <p className="dj-hp-msg">{msg}</p>}
    </div>
  );
}

// botón MIDI de la consola: conecta y luego arma/desarma «aprender» (tocar un control de la mesa
// y mover el del controlador)
function MidiBtn() {
  const on = useMidiStore((s) => s.on);
  const learn = useMidiStore((s) => s.learn);
  const setStatus = useMidiStore((s) => s.setStatus);
  return (
    <button className={`dj-codebtn dj-midibtn${learn ? ' on' : ''}`} title={on ? (learn ? 'terminar de asignar' : 'asignar controles: toca un control de la mesa y mueve el del controlador') : 'conectar el controlador MIDI'}
      onClick={() => { if (!on) void connectMidi(); else setStatus({ learn: !learn, pick: null }); }}>
      🎛 {on ? (learn ? 'listo' : 'asignar') : 'MIDI'}
    </button>
  );
}

// pestaña de la consola, recordada en este navegador
type Tab = 'master' | 'live' | 'sounds';
const TAB_KEY = 'telar.dj.tab';
const readTab = (): Tab => { try { const v = localStorage.getItem(TAB_KEY); return v === 'live' || v === 'sounds' ? v : 'master'; } catch { return 'master'; } };

export function DjMixer() {
  const nodes = useGraphStore((s) => s.nodes);
  const orientation = useGraphStore((s) => s.djOrientation);
  const addSourceToOut = useGraphStore((s) => s.addSourceToOut);
  const showCode = useGraphStore((s) => s.djShowCode);
  const setDjShowCode = useGraphStore((s) => s.setDjShowCode);
  const [tab, setTabState] = useState<Tab>(readTab);
  const seqOpen = useSequencerStore((s) => s.open);
  const setSeqOpen = useSequencerStore((s) => s.setOpen);
  const learn = useMidiStore((s) => s.learn);
  const pick = useMidiStore((s) => s.pick);
  const [dropping, setDropping] = useState(false);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* solo esta sesión */ } };
  // las transiciones del DAW no son un deck (no suenan como canal)
  const decks = nodes.filter((n) => isDeck(n as { id: string; data: NodeData }));

  // APRENDER (MIDI): con «asignar» activo, tocar un control de la mesa lo elige (no lo mueve)
  const onLearnCapture = (e: React.PointerEvent) => {
    if (!useMidiStore.getState().learn) return;
    const el = (e.target as HTMLElement).closest('[data-midi]') as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    useMidiStore.getState().setStatus({ pick: el.dataset.midi ?? null });
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (useMidiStore.getState().learn && (e.target as HTMLElement).closest('[data-midi]')) { e.preventDefault(); e.stopPropagation(); }
  };

  return (
    <div className={`dj dj-${orientation}${learn ? ' learning' : ''}`} onPointerDownCapture={onLearnCapture} onClickCapture={onClickCapture}>
      <div className={`dj-decks${dropping ? ' dropping' : ''}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          setDropping(false);
          if (!e.dataTransfer.files?.length) return;
          e.preventDefault();
          if (!importDroppedFiles(e.dataTransfer.files)) toast.warn('Suelta audio (wav, mp3…) o un .mid.');
        }}>
        {decks.map((n, i) => (
          <Deck key={n.id} id={n.id} index={i} data={n.data as NodeData} showCode={showCode} />
        ))}
        <button className="dj-add" onClick={addSourceToOut} title="añadir deck (o suelta aquí un audio / .mid, o tráelo de «sonidos»)">+ deck</button>
      </div>

      {/* consola: crossfader y audífonos siempre a la vista; debajo, en pestañas, el máster, EN VIVO
          (MIDI) o los SONIDOS (biblioteca: entran como decks nuevos, en silencio) */}
      <aside className="dj-console" aria-label="consola: crossfader, audífonos, máster, en vivo y sonidos">
        <div className="dj-bar">
          <span className="dj-bar-brand">MASTER</span>
          <button className={`dj-codebtn${showCode ? ' on' : ''}`} onClick={() => setDjShowCode(!showCode)}
            title={showCode ? 'colapsar a ondas (decks tipo Traktor)' : 'mostrar los editores de código'}>
            {showCode ? 'código ▾' : 'ondas ▸'}
          </button>
          {/* el secuenciador global aquí (su botón flotante tapaba el primer deck) */}
          <button className={`dj-codebtn${seqOpen ? ' on' : ''}`} onClick={() => setSeqOpen(!seqOpen)} title="secuenciador de pasos (drum machine)">▦ seq</button>
        </div>
        {learn && (
          <p className="dj-learn-hint">{pick ? <>asignando <b>{djSlotName(pick) ?? pick}</b>: mueve la perilla o toca el pad del controlador</> : 'toca un control de la mesa (perilla, botón, crossfader) y luego el del controlador'}</p>
        )}
        <Crossfader />
        <Headphones />
        <div className="dock-tabs dj-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'master'} className={tab === 'master' ? 'on' : ''} onClick={() => setTab('master')} title="nivel, filtro, efectos, limitador, EQ, LUFS y retornos del máster">máster</button>
          <button role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')} title="MIDI, perillas de efectos, pads y pistas para tocar con el controlador">en vivo</button>
          <button role="tab" aria-selected={tab === 'sounds'} className={tab === 'sounds' ? 'on' : ''} onClick={() => setTab('sounds')} title="sonidos, kits, loops y tus patrones: entran como deck nuevo (en silencio)">sonidos</button>
          <MidiBtn />
        </div>
        <div className="dj-console-body">
          {tab === 'master'
            ? <ErrorBoundary variant="panel" label="máster"><Performance /></ErrorBoundary>
            : tab === 'live'
              ? <ErrorBoundary variant="panel" label="MIDI en vivo"><MidiLive docked /></ErrorBoundary>
              : <ErrorBoundary variant="panel" label="sonidos"><Palette dj /></ErrorBoundary>}
        </div>
      </aside>
    </div>
  );
}
