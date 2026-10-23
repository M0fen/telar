import { useEffect } from 'react';
import './MidiLive.css';
import { startMidiInput } from '../audio/engine';
import { registerSlots, handleMidi, type MidiSlot } from '../audio/midiIn';
import { useMidiStore, midiKeyFor, midiKeyLabel } from '../store/useMidiStore';
import { useGraphStore } from '../store/useGraphStore';
import { useScenesStore } from '../store/useScenesStore';
import type { MasterFx } from '../graph/compile';

// Modo EN VIVO con controlador MIDI (perillas + pads), aparte del mezclador DJ.
//   • PERILLAS (continuas): filtro/eco/reverb/drive/crush — la perilla las ajusta
//     EN VIVO directamente (gira = más/menos). Doble clic = al centro.
//   • PADS momentáneos: Roll ×2/×4/×8/×16 y Gate ×4/×8/×16 (divisiones clásicas) y
//     Reverse — mantienes el pad y suena; sueltas y para. Cada división es su pad,
//     así cada uno se asigna fácil a un pad del controlador.
//   • REINICIAR: devuelve todos los efectos del máster a neutro (botón de pánico).
//   • PISTAS: por source, pad de mute + perillas de volumen y filtro. ESCENAS: 8 pads.
// Todo asignable por "aprender". Los efectos aplican al MÁSTER (setMaster, recompila
// con throttle). Las perillas ya ajustan con el mouse sin configurar MIDI.

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

// Pads momentáneos: cada uno aplica un valor FIJO mientras se mantiene.
interface MomFx {
  id: string;
  label: string;
  group: string;
  param: 'roll' | 'gate' | 'rev';
  on: number | boolean;
}
const MOMENTARY: MomFx[] = [
  { id: 'roll2', label: '×2', group: 'Roll', param: 'roll', on: 2 },
  { id: 'roll4', label: '×4', group: 'Roll', param: 'roll', on: 4 },
  { id: 'roll8', label: '×8', group: 'Roll', param: 'roll', on: 8 },
  { id: 'roll16', label: '×16', group: 'Roll', param: 'roll', on: 16 },
  { id: 'gate4', label: '×4', group: 'Gate', param: 'gate', on: 4 },
  { id: 'gate8', label: '×8', group: 'Gate', param: 'gate', on: 8 },
  { id: 'gate16', label: '×16', group: 'Gate', param: 'gate', on: 16 },
  { id: 'rev', label: 'Reverse', group: 'Reverse', param: 'rev', on: true },
];
const GROUPS = ['Roll', 'Gate', 'Reverse'];

// Base de SILBIDOS DE AVES (La menor pentatónica) — se insertan como sources nuevos
// SIN borrar el lienzo, para mezclarlos con otra pista.
const AVES: { name: string; code: string }[] = [
  {
    name: 'drone_aves',
    code: 'note("<a1 a1 e1 a1>").s("sawtooth").lpf("<300 400 350>").lpq(5).attack(0.8).decay(2).sustain(0.6).release(2).shape(0.15).hpf(35).gain(0.3).room(0.55)',
  },
  {
    name: 'aves_silbido',
    code: 'note("<a5 e6 c6 d6 e6 a5 g5 e6>").s("sine").penv("<12 -7 9 -5 7 -9>").pattack(0.004).pdecay(0.08).attack(0.004).decay(0.11).sustain(0).release(0.09).hpf(1400).gain(0.3).room(0.6).roomsize(0.85).delay(0.4).delaytime(0.33).delayfeedback(0.52).sometimesBy(0.35, x=>x.ply(3)).degradeBy(0.12).pan(sine.range(0.3,0.7).slow(8))',
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
const momOff = (m: MomFx): Partial<MasterFx> => ({ [m.param]: m.param === 'rev' ? false : 0 } as Partial<MasterFx>);

// Reinicia TODOS los efectos del máster a neutro (botón de pánico).
const RESET: Partial<MasterFx> = { filter: 0, delay: 0, room: 0, drive: 0, crush: 0, roll: 0, gate: 0, rev: false };

export function MidiLive() {
  const { on, learn, pick, inputs, err, map } = useMidiStore();
  const setStatus = useMidiStore((s) => s.setStatus);
  const master = useGraphStore((s) => s.master);
  const nodes = useGraphStore((s) => s.nodes);
  const sources = nodes.filter((n) => n.data.kind === 'source');
  const srcSig = sources.map((s) => s.id).join('|');

  const engageMom = (m: MomFx) => setM({ [m.param]: m.on } as Partial<MasterFx>);
  const releaseMom = (m: MomFx) => setM(momOff(m));
  const resetAll = () => setM(RESET);

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
    const list = await startMidiInput(handleMidi);
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

  const addAves = () => gs().addSources(AVES);

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
        className={`ml-pad sm${pick === slot ? ' pick' : ''}`}
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
        title={`${m.group} ${m.label}: mantén para aplicar`}
      >
        {m.label}
        {key && <span className="ml-badge sm">{midiKeyLabel(key)}</span>}
      </button>
    );
  };

  return (
    <div className="ml-panel">
      <div className="ml-head">
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

      {learn && (
        <div className="ml-learnbar">
          {pick ? (
            <>Asignando <b>{pickName(pick)}</b>: ahora <b>mueve la perilla o pulsa el pad</b> en tu M-Wave.</>
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
        <h4>Pads momentáneos (mantén para aplicar)</h4>
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
