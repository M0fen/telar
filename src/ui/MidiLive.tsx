import { useEffect, useRef, useState } from 'react';
import './MidiLive.css';
import { startMidiInput } from '../audio/engine';
import { registerSlots, handleMidi, type MidiSlot } from '../audio/midiIn';
import { useMidiStore, midiKeyFor, midiKeyLabel } from '../store/useMidiStore';
import { useGraphStore } from '../store/useGraphStore';
import { useScenesStore } from '../store/useScenesStore';
import type { MasterFx } from '../graph/compile';

// Modo EN VIVO con controlador MIDI (perillas + pads), aparte del mezclador DJ.
// Modelo DJ:
//   • PERILLAS (continuas): filtro/eco/reverb/drive/crush — la perilla las ajusta
//     EN VIVO directamente (gira = más/menos efecto). Doble clic = al centro.
//   • PADS (momentáneos): roll y gate — mantienes el pad y suena; su perilla gradúa
//     la intensidad. Sueltas y para.
//   • PISTAS: por source, pad de mute + perillas de volumen y filtro.
//   • ESCENAS: 8 pads.
// Todo asignable por "aprender". Los efectos aplican al MÁSTER (setMaster, recompila
// con throttle). Las perillas en pantalla ya ajustan con el mouse sin configurar MIDI.

// Perillas continuas: parámetro del máster + rango. bipolar = -1..1 (filtro DJ).
interface KnobFx {
  id: string;
  label: string;
  param: keyof MasterFx;
  bipolar?: boolean;
  max?: number; // para no-bipolares: cantidad 0..1 → 0..max
}
const KNOBS: KnobFx[] = [
  { id: 'filtro', label: 'Filtro', param: 'filter', bipolar: true }, // izq=grave (lpf) · der=agudo (hpf)
  { id: 'eco', label: 'Eco', param: 'delay', max: 1 },
  { id: 'reverb', label: 'Reverb', param: 'room', max: 0.8 },
  { id: 'drive', label: 'Drive', param: 'drive', max: 1 },
  { id: 'crush', label: 'Crush', param: 'crush', max: 1 },
];
// Pads momentáneos: mantener aplica roll/gate; la perilla gradúa la intensidad (n).
interface PadFx {
  id: string;
  label: string;
  param: keyof MasterFx;
  min: number;
  max: number;
}
const PADS: PadFx[] = [
  { id: 'roll', label: 'Roll', param: 'roll', min: 2, max: 16 }, // .ply(n) — beat-repeat
  { id: 'gate', label: 'Gate', param: 'gate', min: 2, max: 16 }, // corte rítmico
];

// Base de SILBIDOS DE AVES, hipnótica, en La menor pentatónica — se insertan como
// sources nuevos SIN borrar el lienzo, para mezclarlos con otra pista.
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

// cantidad 0..1 ↔ valor del parámetro para una perilla continua
const knobTo = (k: KnobFx, v01: number) => (k.bipolar ? v01 * 2 - 1 : v01 * (k.max ?? 1));
const knobFrom = (k: KnobFx, val: number) => (k.bipolar ? (val + 1) / 2 : val / (k.max ?? 1));

export function MidiLive() {
  const { on, learn, pick, inputs, err, map } = useMidiStore();
  const setStatus = useMidiStore((s) => s.setStatus);
  const master = useGraphStore((s) => s.master); // reactivo: las perillas reflejan el máster
  const nodes = useGraphStore((s) => s.nodes);
  const sources = nodes.filter((n) => n.data.kind === 'source');
  const srcSig = sources.map((s) => s.id).join('|');

  // intensidad (0..1) de cada pad momentáneo (roll/gate), en ref para la lectura viva
  const padAmtRef = useRef<Record<string, number>>({ roll: 0.33, gate: 0.5 });
  const [padAmts, setPadAmts] = useState<Record<string, number>>({ ...padAmtRef.current });
  const padN = (p: PadFx) => Math.round(p.min + (padAmtRef.current[p.id] ?? 0.5) * (p.max - p.min));
  const engagePad = (p: PadFx) => setM({ [p.param]: padN(p) } as Partial<MasterFx>);
  const releasePad = (p: PadFx) => setM({ [p.param]: 0 } as Partial<MasterFx>);
  const setPadAmt = (id: string, v: number) => {
    padAmtRef.current = { ...padAmtRef.current, [id]: v };
    setPadAmts(padAmtRef.current);
  };

  // Registra TODOS los slots. Re-registra cuando cambian los sources.
  useEffect(() => {
    const slots: Record<string, MidiSlot> = {};
    for (const k of KNOBS) {
      slots[`fx.${k.id}`] = {
        kind: 'knob',
        get: () => knobFrom(k, (gs().master[k.param] as number) ?? 0),
        set: (v) => setM({ [k.param]: knobTo(k, v) } as Partial<MasterFx>),
      };
    }
    for (const p of PADS) {
      slots[`pad.${p.id}`] = { kind: 'pad', down: () => engagePad(p), up: () => releasePad(p) };
      slots[`pad.${p.id}.amt`] = { kind: 'knob', get: () => padAmtRef.current[p.id] ?? 0.5, set: (v) => setPadAmt(p.id, v) };
    }
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
    if (kind === 'pad') return `${PADS.find((p) => p.id === a)?.label ?? a}${b === 'amt' ? ' · intensidad' : ' · pad'}`;
    if (kind === 'scene') return `escena ${a}`;
    if (kind === 'src') {
      const nm = sources.find((s) => s.id === a)?.data.name ?? 'pista';
      return `${nm} · ${b === 'mute' ? 'mute' : b === 'gain' ? 'volumen' : 'filtro'}`;
    }
    return slot;
  };

  const addAves = () => gs().addSources(AVES);

  // Perilla (función, NO componente, para no cortar el arrastre). pct: valor 0..1 a mostrar.
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

  return (
    <div className="ml-panel">
      <div className="ml-head">
        <button className={`ml-midibtn${on ? ' on' : ''}${learn ? ' learn' : ''}`} onClick={() => void onMidiBtn()}>
          {on ? (learn ? '✓ Terminar' : '⌨ Aprender') : 'Conectar MIDI'}
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
                {knob(slot, val, (v) => setM({ [k.param]: knobTo(k, v) } as Partial<MasterFx>), () => setM({ [k.param]: k.bipolar ? 0 : 0 } as Partial<MasterFx>), `${k.label}`)}
                <span className="ml-krv">{pctTxt}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ml-sec">
        <h4>Pads momentáneos (mantén para aplicar · perilla = intensidad)</h4>
        <div className="ml-padrow">
          {PADS.map((p) => {
            const padSlot = `pad.${p.id}`;
            const amtSlot = `pad.${p.id}.amt`;
            const padKey = midiKeyFor(padSlot);
            return (
              <div className={`ml-padcell${pick === padSlot ? ' pick' : ''}`} key={p.id}>
                <button
                  className="ml-pad"
                  onPointerDown={(ev) => {
                    if (pickIf(padSlot)) return;
                    ev.preventDefault();
                    engagePad(p);
                    const up = () => {
                      releasePad(p);
                      window.removeEventListener('pointerup', up);
                    };
                    window.addEventListener('pointerup', up);
                  }}
                  title={`${p.label}: mantén para aplicar`}
                >
                  {p.label}
                  {padKey && <span className="ml-badge">{midiKeyLabel(padKey)}</span>}
                </button>
                {knob(amtSlot, padAmts[p.id] ?? 0.5, (v) => setPadAmt(p.id, v), null, `${p.label} intensidad`)}
                <span className="ml-sub">×{padN(p)}</span>
              </div>
            );
          })}
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
