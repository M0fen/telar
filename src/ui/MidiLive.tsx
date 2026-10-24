import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import './MidiLive.css';
import { startMidiInput, setLiveFx, releaseAllLiveFx, getScheduler, type LiveFxKey } from '../audio/engine';
import { registerSlots, handleMidi, type MidiSlot } from '../audio/midiIn';
import { useMidiStore, midiKeyFor, midiKeyLabel } from '../store/useMidiStore';
import { useGraphStore } from '../store/useGraphStore';
import { useScenesStore } from '../store/useScenesStore';
import { toast } from '../store/useNotifyStore';
import type { MasterFx } from '../graph/compile';
import type { NodeData } from '../graph/types';

// Modo EN VIVO con controlador MIDI (perillas + pads), aparte del mezclador DJ.
//   • PERILLAS (continuas): filtro/eco/reverb/drive/crush — la perilla las ajusta
//     EN VIVO directamente (gira = más/menos). Doble clic = al centro.
//   • PADS momentáneos (mantienes = actúa, sueltas = para; se iluminan mientras actúan):
//     Roll ×2/×4/×8/×16 · Gate ×4/×8/×16 · Tiempo: Reverse y ½ tiempo · Envíos: Eco y Wash
//     (al soltar, la cola sigue) · Kill: graves / medios / agudos. Un pad por división →
//     cada uno se asigna fácil a un pad del controlador.
//   • REINICIAR: efectos del máster a neutro, suelta los FX en vivo y centra el filtro de
//     cada pista (pánico).
//   • PISTAS: por source, pad de mute + perillas de volumen y filtro. ESCENAS: 8 pads.
// Todo asignable por "aprender" (y «✕ quitar» para soltar una asignación). Dónde actúa:
//   BUS Web Audio (al instante, sin recompilar): perillas filtro/drive, Eco, Wash y Kills.
//   CÓDIGO (recompila con throttle): perillas eco/reverb/crush, Roll, Gate, Reverse, ½ tiempo.
// Las perillas ya ajustan con el mouse sin configurar MIDI.

interface KnobFx {
  id: string;
  label: string;
  param: keyof MasterFx;
  bipolar?: boolean;
  max?: number;
}
const KNOBS: KnobFx[] = [
  { id: 'filtro', label: 'Filtro', param: 'filter', bipolar: true },
  { id: 'eco', label: 'Eco', param: 'delay', max: 1 },
  { id: 'reverb', label: 'Reverb', param: 'room', max: 0.8 },
  { id: 'drive', label: 'Drive', param: 'drive', max: 1 },
  { id: 'crush', label: 'Crush', param: 'crush', max: 1 },
];

// Pads momentáneos: actúan MIENTRAS se mantienen. Dos clases:
//   • de PATRÓN (máster, recompila): roll/gate/reverse/½ tiempo → un valor del máster.
//   • de BUS (Web Audio, instantáneos): eco y wash con cola, kills de graves/medios/agudos.
type MomParam = 'roll' | 'gate' | 'rev' | 'half';
interface MomFx {
  id: string;
  label: string;
  group: string;
  title: string;
  param?: MomParam; // pad de patrón
  on?: number | boolean | (() => number); // valor mientras se mantiene (función = se calcula al pulsar)
  bus?: LiveFxKey; // pad de bus
}

// Ancla del ½ tiempo: el PRÓXIMO pulso (1/4 de ciclo), con margen para que el hot-swap
// (~120 ms) llegue antes → el cambio cae justo en el pulso, sin saltos.
const halfAnchor = (): number => {
  const sch = getScheduler() as { now?: () => number; cps?: number } | undefined;
  const now = Number(sch?.now?.() ?? 0);
  const cps = Number(sch?.cps) || gs().cps || 0.5;
  return Math.ceil((now + 0.12 * cps) * 4) / 4;
};

const MOMENTARY: MomFx[] = [
  { id: 'roll2', label: '×2', group: 'Roll', title: 'loop roll ×2', param: 'roll', on: 2 },
  { id: 'roll4', label: '×4', group: 'Roll', title: 'loop roll ×4', param: 'roll', on: 4 },
  { id: 'roll8', label: '×8', group: 'Roll', title: 'loop roll ×8', param: 'roll', on: 8 },
  { id: 'roll16', label: '×16', group: 'Roll', title: 'loop roll ×16', param: 'roll', on: 16 },
  { id: 'gate4', label: '×4', group: 'Gate', title: 'gate ×4', param: 'gate', on: 4 },
  { id: 'gate8', label: '×8', group: 'Gate', title: 'gate ×8', param: 'gate', on: 8 },
  { id: 'gate16', label: '×16', group: 'Gate', title: 'gate ×16', param: 'gate', on: 16 },
  { id: 'rev', label: 'Reverse', group: 'Tiempo', title: 'reverse', param: 'rev', on: true },
  { id: 'half', label: '½ tiempo', group: 'Tiempo', title: 'todo a media velocidad desde el próximo pulso; al soltar, la canción sigue en su sitio', param: 'half', on: halfAnchor },
  { id: 'echo', label: 'Eco', group: 'Envíos', title: 'eco a tempo (3/16): al soltar la cola sigue sonando', bus: 'echo' },
  { id: 'wash', label: 'Wash', group: 'Envíos', title: 'lavado de reverb: al soltar la cola sigue sonando', bus: 'wash' },
  { id: 'killLow', label: 'Graves', group: 'Kill', title: 'quita los graves (bombo y bajo) mientras mantienes', bus: 'killLow' },
  { id: 'killMid', label: 'Medios', group: 'Kill', title: 'quita los medios mientras mantienes', bus: 'killMid' },
  { id: 'killHigh', label: 'Agudos', group: 'Kill', title: 'quita los agudos (hats, aire) mientras mantienes', bus: 'killHigh' },
];
const GROUPS = ['Roll', 'Gate', 'Tiempo', 'Envíos', 'Kill'];

// Base de SILBIDOS DE AVES (La menor pentatónica) — se insertan como sources nuevos
// SIN borrar el lienzo, para mezclarlos con otra pista. Sin funciones flecha (`x=>…`): el
// `>` de `=>` descuadra el parser de `arrange` y «⇋ instrumentos» anidaba el arreglo
// (`ply(3)` curried suena idéntico, verificado en Strudel). El parser se arregla en DAW 0.3.
const AVES: { name: string; code: string }[] = [
  {
    name: 'drone_aves',
    code: 'note("<a1 a1 e1 a1>").s("sawtooth").lpf("<300 400 350>").lpq(5).attack(0.8).decay(2).sustain(0.6).release(2).shape(0.15).hpf(35).gain(0.3).room(0.55)',
  },
  {
    name: 'aves_silbido',
    code: 'note("<a5 e6 c6 d6 e6 a5 g5 e6>").s("sine").penv("<12 -7 9 -5 7 -9>").pattack(0.004).pdecay(0.08).attack(0.004).decay(0.11).sustain(0).release(0.09).hpf(1400).gain(0.3).room(0.6).roomsize(0.85).delay(0.4).delaytime(0.33).delayfeedback(0.52).sometimesBy(0.35, ply(3)).degradeBy(0.12).pan(sine.range(0.3,0.7).slow(8))',
  },
  {
    name: 'aves_chirp',
    code: 'note("e6 ~ a6 ~ ~ g6 ~ c7 ~ ~ e6 ~ a6 ~ ~ ~").s("sine").penv("<-9 8 -6 10>").pdecay(0.05).attack(0.003).decay(0.06).sustain(0).hpf(2600).gain(0.2).room(0.65).delay(0.5).delaytime(0.1875).delayfeedback(0.6).degradeBy(0.45).pan(rand.range(0.15,0.85))',
  },
];

const gs = () => useGraphStore.getState();
const setM = (patch: Partial<MasterFx>) => gs().setMaster(patch);
const srcGain = (id: string) => (gs().nodes.find((n) => n.id === id)?.data.gain ?? 1) as number;
const srcFilter = (id: string) => (gs().nodes.find((n) => n.id === id)?.data.chFilter ?? 0) as number;
const srcMuted = (id: string) => !!gs().nodes.find((n) => n.id === id)?.data.mute;

const knobTo = (k: KnobFx, v01: number) => (k.bipolar ? v01 * 2 - 1 : v01 * (k.max ?? 1));
const knobFrom = (k: KnobFx, val: number) => (k.bipolar ? (val + 1) / 2 : val / (k.max ?? 1));
const momOff = (p: MomParam): Partial<MasterFx> => ({ [p]: p === 'rev' ? false : 0 } as Partial<MasterFx>);

// Pads de PATRÓN del MISMO efecto que se solapan (mantienes Roll ×4 y tocas ×8): al soltar
// uno vuelve el que sigue apretado. Pila por parámetro con el valor fijado AL PULSAR (el
// ancla del ½ tiempo no se recalcula al volver → no salta).
const held: Record<string, { id: string; v: number | boolean }[]> = {};
const engageMom = (m: MomFx) => {
  useMidiStore.getState().setLit(m.id, true);
  if (m.bus) { setLiveFx(m.bus, true, gs().cps); return; }
  if (!m.param) return;
  const v = typeof m.on === 'function' ? m.on() : (m.on ?? true);
  const st = (held[m.param] = (held[m.param] ?? []).filter((x) => x.id !== m.id));
  st.push({ id: m.id, v });
  setM({ [m.param]: v } as Partial<MasterFx>);
};
const releaseMom = (m: MomFx) => {
  useMidiStore.getState().setLit(m.id, false);
  if (m.bus) { setLiveFx(m.bus, false); return; }
  if (!m.param) return;
  const st = (held[m.param] = (held[m.param] ?? []).filter((x) => x.id !== m.id));
  const top = st[st.length - 1];
  setM(top ? ({ [m.param]: top.v } as Partial<MasterFx>) : momOff(m.param));
};

// REINICIAR (pánico): efectos del máster a neutro, suelta los FX en vivo del bus (las colas
// terminan solas) y centra el filtro de TODAS las pistas. No toca volúmenes ni mutes.
const RESET: Partial<MasterFx> = { filter: 0, delay: 0, room: 0, drive: 0, crush: 0, roll: 0, gate: 0, rev: false, half: 0 };
const resetAll = () => {
  for (const k of Object.keys(held)) delete held[k];
  releaseAllLiveFx();
  useMidiStore.getState().clearLit();
  setM(RESET);
  const g = gs();
  const upd: Record<string, Partial<NodeData>> = {};
  for (const n of g.nodes) if (n.data.kind === 'source' && Math.abs(Number(n.data.chFilter) || 0) > 0.001) upd[n.id] = { chFilter: 0 };
  if (Object.keys(upd).length) g.applyNodeStates(upd);
};

// Monitor aparte: es lo ÚNICO que se repinta con cada mensaje del controlador (un barrido de
// perilla manda decenas por segundo; antes se repintaba el panel entero). El punto parpadea
// con una animación CSS que reinicia `key` → se apaga solo (antes quedaba encendido).
function MidiMonitor() {
  const last = useMidiStore((s) => s.last);
  const lastAt = useMidiStore((s) => s.lastAt);
  return (
    <div className="ml-monitor">
      <span key={lastAt} className={`ml-dot${lastAt ? ' flash' : ''}`} />
      {last ? (
        <>Controlador: <b>{last}</b></>
      ) : (
        <>Mueve una perilla o pad del M-Wave para probar que llega… (si no aparece nada, conéctalo por <b>USB</b> y revisa que sea <b>Chrome/Edge</b>)</>
      )}
    </div>
  );
}

export function MidiLive() {
  const { on, learn, pick, inputs, err, map, lit } = useMidiStore(
    useShallow((s) => ({ on: s.on, learn: s.learn, pick: s.pick, inputs: s.inputs, err: s.err, map: s.map, lit: s.lit })),
  );
  const setStatus = useMidiStore((s) => s.setStatus);
  const master = useGraphStore((s) => s.master);
  const nodes = useGraphStore((s) => s.nodes);
  const sources = nodes.filter((n) => n.data.kind === 'source');
  const srcSig = sources.map((s) => s.id).join('|');

  // minimizar: persiste en localStorage para que el panel recuerde su estado.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('telar.midilive.collapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed((c) => {
    const v = !c;
    try { localStorage.setItem('telar.midilive.collapsed', v ? '1' : '0'); } catch { /* */ }
    return v;
  });

  useEffect(() => {
    const slots: Record<string, MidiSlot> = {};
    for (const k of KNOBS) {
      slots[`fx.${k.id}`] = {
        kind: 'knob',
        get: () => knobFrom(k, (gs().master[k.param] as number) ?? 0),
        set: (v) => setM({ [k.param]: knobTo(k, v) } as Partial<MasterFx>),
      };
    }
    for (const m of MOMENTARY) slots[`mom.${m.id}`] = { kind: 'pad', down: () => engageMom(m), up: () => releaseMom(m) };
    slots['reset'] = { kind: 'tap', tap: () => resetAll() };
    for (const s of sources) {
      const id = s.id;
      slots[`src.${id}.mute`] = { kind: 'tap', tap: () => gs().updateNodeData(id, { mute: !srcMuted(id) }) };
      slots[`src.${id}.gain`] = { kind: 'knob', get: () => srcGain(id) / 1.5, set: (v) => gs().updateNodeData(id, { gain: v * 1.5 }) };
      slots[`src.${id}.filter`] = { kind: 'knob', get: () => (srcFilter(id) + 1) / 2, set: (v) => gs().updateNodeData(id, { chFilter: v * 2 - 1 }) };
    }
    for (let n = 1; n <= 8; n++) slots[`scene.${n}`] = { kind: 'tap', tap: () => useScenesStore.getState().trigger(n) };
    registerSlots(slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcSig]);

  const onMidiBtn = async () => {
    if (on) {
      setStatus({ learn: !learn, pick: null });
      return;
    }
    if (!('requestMIDIAccess' in navigator)) {
      setStatus({ err: 'Este navegador no tiene MIDI. Usa Chrome o Edge y conecta el controlador por cable USB.' });
      return;
    }
    const list = await startMidiInput(handleMidi, (l) => setStatus({ inputs: l }));
    if (!list) {
      setStatus({ err: 'No pude abrir el MIDI: acepta el permiso del navegador (Chrome/Edge) y vuelve a pulsar «Conectar MIDI».' });
      return;
    }
    setStatus({ on: true, inputs: list, err: '', learn: Object.keys(map).length === 0 });
  };

  const pickIf = (slot: string): boolean => {
    if (!learn) return false;
    setStatus({ pick: slot });
    return true;
  };
  const pickName = (slot: string | null): string => {
    if (!slot) return '';
    const [kind, a, b] = slot.split('.');
    if (kind === 'fx') return `${KNOBS.find((k) => k.id === a)?.label ?? a} · perilla`;
    if (kind === 'mom') { const m = MOMENTARY.find((x) => x.id === a); return m ? `${m.group} ${m.label}` : a; }
    if (slot === 'reset') return 'Reiniciar';
    if (kind === 'scene') return `escena ${a}`;
    if (kind === 'src') {
      const nm = sources.find((s) => s.id === a)?.data.name ?? 'pista';
      return `${nm} · ${b === 'mute' ? 'mute' : b === 'gain' ? 'volumen' : 'filtro'}`;
    }
    return slot;
  };

  // inserta solo las que falten (antes cada clic duplicaba las 3 fuentes)
  const addAves = () => {
    const have = new Set(gs().nodes.filter((n) => n.data.kind === 'source').map((n) => String(n.data.name ?? '')));
    const faltan = AVES.filter((a) => !have.has(a.name));
    if (!faltan.length) { toast.info('la base de aves ya está en el lienzo'); return; }
    gs().addSources(faltan);
  };

  const knob = (slot: string, value: number, onCh: (v: number) => void, onReset: (() => void) | null, aria: string) => {
    const k = midiKeyFor(slot);
    return (
      <span className={`ml-kc${pick === slot ? ' pick' : ''}`} key={slot}>
        <input
          className="ml-knob"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          aria-label={aria}
          onPointerDown={() => pickIf(slot)}
          onChange={(ev) => onCh(parseFloat(ev.target.value))}
          onDoubleClick={() => onReset && onReset()}
        />
        {k && <span className="ml-badge sm">{midiKeyLabel(k)}</span>}
      </span>
    );
  };

  const momPad = (m: MomFx) => {
    const slot = `mom.${m.id}`;
    const key = midiKeyFor(slot);
    return (
      <button
        className={`ml-pad sm${pick === slot ? ' pick' : ''}${lit[m.id] ? ' on' : ''}`}
        key={m.id}
        onPointerDown={(ev) => {
          if (pickIf(slot)) return;
          ev.preventDefault();
          engageMom(m);
          const up = () => {
            releaseMom(m);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointerup', up);
        }}
        title={`${m.title} — mantén para aplicar`}
      >
        {m.label}
        {key && <span className="ml-badge sm">{midiKeyLabel(key)}</span>}
      </button>
    );
  };

  if (collapsed) {
    return (
      <div className="ml-panel collapsed">
        <button className="ml-toggle" onClick={toggleCollapsed} title="Expandir el panel MIDI en vivo">🎛 MIDI en vivo ▸</button>
      </div>
    );
  }

  return (
    <div className="ml-panel">
      <div className="ml-head">
        <button className="ml-min" onClick={toggleCollapsed} title="Minimizar el panel">▾</button>
        <button className={`ml-midibtn${on ? ' on' : ''}${learn ? ' learn' : ''}`} onClick={() => void onMidiBtn()}>
          {on ? (learn ? '✓ Terminar' : '⌨ Aprender') : 'Conectar MIDI'}
        </button>
        <button className={`ml-reset${pick === 'reset' ? ' pick' : ''}`} onPointerDown={() => { if (pickIf('reset')) return; resetAll(); }} title="Reinicia todos los efectos a neutro">
          ↺ Reiniciar
        </button>
        <button className="ml-aves" onClick={addAves} title="Inserta la base de silbidos de aves (3 fuentes)">🐦 Base aves</button>
        <span className="ml-status">
          {err
            ? err
            : on
              ? `MIDI: ${inputs.join(' · ') || 'conéctalo por USB (Chrome/Edge)'}${Object.keys(map).length ? ` · ${Object.keys(map).length} asignados` : ''}`
              : 'Gira las perillas para los efectos. Conecta el M-Wave para tocar con el controlador.'}
        </span>
      </div>

      {on && <MidiMonitor />}

      {learn && (
        <div className="ml-learnbar">
          {pick ? (
            <>
              Asignando <b>{pickName(pick)}</b>: ahora <b>mueve la perilla o pulsa el pad</b> en tu M-Wave.
              {midiKeyFor(pick) && (
                <button
                  className="ml-unmap"
                  onClick={() => { useMidiStore.getState().clearSlot(pick); setStatus({ pick: null }); }}
                  title="quita la asignación de este control"
                >
                  ✕ quitar {midiKeyLabel(midiKeyFor(pick))}
                </button>
              )}
            </>
          ) : (
            <>Modo aprender: <b>toca abajo</b> una perilla o pad y luego <b>muévelo en el controlador</b>. «✓ Terminar» al acabar.</>
          )}
        </div>
      )}

      <div className="ml-sec">
        <h4>Perillas (gira = ajusta el efecto en vivo · doble clic al centro)</h4>
        <div className="ml-knobs">
          {KNOBS.map((k) => {
            const slot = `fx.${k.id}`;
            const val = knobFrom(k, (master[k.param] as number) ?? 0);
            const pctTxt = k.bipolar
              ? val < 0.47
                ? `lpf ${Math.round((0.5 - val) * 200)}%`
                : val > 0.53
                  ? `hpf ${Math.round((val - 0.5) * 200)}%`
                  : 'off'
              : `${Math.round(val * 100)}%`;
            return (
              <div className={`ml-knobrow${pick === slot ? ' pick' : ''}`} key={k.id}>
                <span className="ml-krl">{k.label}</span>
                {knob(slot, val, (v) => setM({ [k.param]: knobTo(k, v) } as Partial<MasterFx>), () => setM({ [k.param]: 0 } as Partial<MasterFx>), `${k.label}`)}
                <span className="ml-krv">{pctTxt}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ml-sec">
        <h4>Pads momentáneos (mantén para aplicar · se iluminan mientras actúan)</h4>
        <div className="ml-moms">
          {GROUPS.map((grp) => (
            <div className="ml-momgrp" key={grp}>
              <span className="ml-momlbl">{grp}</span>
              <div className="ml-momrow">{MOMENTARY.filter((m) => m.group === grp).map(momPad)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="ml-sec">
        <h4>Pistas — pad mute · perillas volumen y filtro</h4>
        <div className="ml-tracks">
          {sources.length === 0 ? (
            <span className="ml-empty">No hay pistas aún. Suelta la «Base aves» o añade sources al lienzo.</span>
          ) : (
            sources.map((s) => {
              const id = s.id;
              const muteSlot = `src.${id}.mute`;
              const muteKey = midiKeyFor(muteSlot);
              const muted = !!s.data.mute;
              return (
                <div className="ml-track" key={id}>
                  <span className="ml-tname" title={s.data.name || id}>{s.data.name || 'pista'}</span>
                  <button
                    className={`ml-mute${muted ? ' on' : ''}${pick === muteSlot ? ' pick' : ''}`}
                    onPointerDown={() => {
                      if (pickIf(muteSlot)) return;
                      gs().updateNodeData(id, { mute: !muted });
                    }}
                    title="mute de la pista"
                  >
                    {muted ? 'muted' : 'mute'}
                    {muteKey && <span className="ml-badge sm">{midiKeyLabel(muteKey)}</span>}
                  </button>
                  {knob(`src.${id}.gain`, (s.data.gain ?? 1) / 1.5, (v) => gs().updateNodeData(id, { gain: v * 1.5 }), () => gs().updateNodeData(id, { gain: 1 }), `volumen ${s.data.name || 'pista'}`)}
                  {knob(`src.${id}.filter`, ((s.data.chFilter ?? 0) + 1) / 2, (v) => gs().updateNodeData(id, { chFilter: v * 2 - 1 }), () => gs().updateNodeData(id, { chFilter: 0 }), `filtro ${s.data.name || 'pista'}`)}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="ml-sec">
        <h4>Escenas</h4>
        <div className="ml-scenes">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => {
            const slot = `scene.${n}`;
            const k = midiKeyFor(slot);
            return (
              <button
                key={n}
                className={`ml-scpad${pick === slot ? ' pick' : ''}`}
                onPointerDown={() => {
                  if (pickIf(slot)) return;
                  useScenesStore.getState().trigger(n);
                }}
                title={`escena ${n}`}
              >
                {n}
                {k && <span className="ml-badge sm">{midiKeyLabel(k)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
