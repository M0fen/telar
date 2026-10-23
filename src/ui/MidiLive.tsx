import { useEffect, useRef, useState } from 'react';
import './MidiLive.css';
import { startMidiInput } from '../audio/engine';
import { registerSlots, handleMidi, type MidiSlot } from '../audio/midiIn';
import { useMidiStore, midiKeyFor, midiKeyLabel } from '../store/useMidiStore';
import { useGraphStore } from '../store/useGraphStore';
import { useScenesStore } from '../store/useScenesStore';
import type { MasterFx } from '../graph/compile';

// Modo EN VIVO con controlador MIDI (pads + perillas), aparte del mezclador DJ.
// Modelo profesional: un PAD engancha un efecto (mientras lo mantienes) y su
// PERILLA fija la CANTIDAD (dry-wet) de ese efecto. Los efectos se aplican al
// MÁSTER (filter/eco/reverb/crush/drive/gate), que ya recompila con throttle. Los
// 8 pads de escena disparan las escenas guardadas. Todo asignable por "aprender".

// Cada efecto: su parámetro del máster y cómo la cantidad 0..1 mapea a su rango.
interface FxDef {
  id: string;
  label: string;
  sub: string;
  param: keyof MasterFx;
  toParam: (amt01: number) => number; // cantidad 0..1 → valor del parámetro
}
const EFFECTS: FxDef[] = [
  { id: 'filtro', label: 'Filtro', sub: 'lpf', param: 'filter', toParam: (a) => -a }, // 0..1 → 0..-1 (cierra graves)
  { id: 'eco', label: 'Eco', sub: 'delay', param: 'delay', toParam: (a) => a },
  { id: 'reverb', label: 'Reverb', sub: 'room', param: 'room', toParam: (a) => a * 0.8 },
  { id: 'crush', label: 'Crush', sub: 'bits', param: 'crush', toParam: (a) => a },
  { id: 'drive', label: 'Drive', sub: 'sat', param: 'drive', toParam: (a) => a },
  { id: 'gate', label: 'Gate', sub: 'corte', param: 'gate', toParam: (a) => Math.round(a * 16) },
];

// Base de SILBIDOS DE AVES, hipnótica, en La menor pentatónica — lista para soltar
// y mezclar con otra pista (p. ej. el hard techno exportado). Se insertan como
// sources nuevos SIN borrar lo que ya haya en el lienzo.
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

export function MidiLive() {
  const { on, learn, pick, inputs, err, map } = useMidiStore();
  const setStatus = useMidiStore((s) => s.setStatus);

  // Cantidad (0..1) por efecto, en un ref para que las perillas MIDI lean el valor
  // vivo sin re-registrar los slots en cada cambio.
  const amtRef = useRef<Record<string, number>>({ filtro: 0.5, eco: 0.4, reverb: 0.4, crush: 0.5, drive: 0.5, gate: 0.5 });
  const [amts, setAmts] = useState<Record<string, number>>({ ...amtRef.current });
  // valor del máster guardado al enganchar un efecto, para restaurar al soltar.
  const heldRef = useRef<Record<string, number | undefined>>({});

  const applyParam = (id: string) => {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e) return;
    useGraphStore.getState().setMaster({ [e.param]: e.toParam(amtRef.current[id] ?? 0) } as Partial<MasterFx>);
  };
  const setAmt = (id: string, v: number) => {
    amtRef.current = { ...amtRef.current, [id]: v };
    setAmts(amtRef.current);
    if (heldRef.current[id] !== undefined) applyParam(id); // si está enganchado, modula en vivo
  };
  const engage = (id: string) => {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e) return;
    heldRef.current[id] = (useGraphStore.getState().master[e.param] as number) ?? 0;
    applyParam(id);
  };
  const release = (id: string) => {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e) return;
    const saved = heldRef.current[id];
    heldRef.current[id] = undefined;
    useGraphStore.getState().setMaster({ [e.param]: saved ?? 0 } as Partial<MasterFx>);
  };

  // Registra los slots UNA vez: los handlers leen refs / getState (sin estado rancio).
  useEffect(() => {
    const slots: Record<string, MidiSlot> = {};
    for (const e of EFFECTS) {
      slots[`fx.${e.id}.knob`] = { kind: 'knob', get: () => amtRef.current[e.id] ?? 0, set: (v) => setAmt(e.id, v) };
      slots[`fx.${e.id}.pad`] = { kind: 'pad', down: () => engage(e.id), up: () => release(e.id) };
    }
    for (let n = 1; n <= 8; n++) slots[`scene.${n}`] = { kind: 'tap', tap: () => useScenesStore.getState().trigger(n) };
    registerSlots(slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMidiBtn = async () => {
    if (on) {
      setStatus({ learn: !learn, pick: null });
      return;
    }
    if (!('requestMIDIAccess' in navigator)) {
      setStatus({ err: 'Este navegador no tiene MIDI. Usa Chrome o Edge en el computador (y conecta el controlador por cable USB).' });
      return;
    }
    const list = await startMidiInput(handleMidi);
    setStatus({ on: true, inputs: list, err: '', learn: Object.keys(map).length === 0 });
  };

  // Clic en un control de la pantalla: en modo aprender, lo ELIGE para asignarlo.
  const pickIf = (slot: string): boolean => {
    if (!learn) return false;
    setStatus({ pick: slot });
    return true;
  };

  const addAves = () => useGraphStore.getState().addSources(AVES);

  return (
    <div className="ml-panel">
      <div className="ml-head">
        <button className={`ml-midibtn${on ? ' on' : ''}${learn ? ' learn' : ''}`} onClick={() => void onMidiBtn()} title="Conecta tu controlador y asigna pads y perillas">
          {on ? (learn ? 'Listo' : 'Aprender MIDI') : 'MIDI'}
        </button>
        <button className="ml-aves" onClick={addAves} title="Inserta la base de silbidos de aves (3 fuentes) en el lienzo actual">🐦 Base aves</button>
        <span className="ml-status">
          {err
            ? err
            : learn
              ? pick
                ? 'Ahora mueve la perilla o toca el pad del controlador.'
                : 'Toca un control de la pantalla y luego su perilla/pad en el controlador. «Listo» para terminar.'
              : on
                ? `MIDI: ${inputs.join(' · ') || 'conéctalo por USB (Chrome/Edge)'}${Object.keys(map).length ? ` · ${Object.keys(map).length} asignados` : ''}`
                : 'Efectos en vivo: pad engancha, perilla gradúa. Conecta tu M-Wave.'}
        </span>
      </div>

      <div className="ml-fxrow">
        {EFFECTS.map((e) => {
          const padSlot = `fx.${e.id}.pad`;
          const knobSlot = `fx.${e.id}.knob`;
          const padKey = midiKeyFor(padSlot);
          const knobKey = midiKeyFor(knobSlot);
          return (
            <div className={`ml-fx${pick === padSlot || pick === knobSlot ? ' pick' : ''}`} key={e.id}>
              <button
                className="ml-pad"
                onPointerDown={(ev) => {
                  if (pickIf(padSlot)) return;
                  ev.preventDefault();
                  engage(e.id);
                  const up = () => {
                    release(e.id);
                    window.removeEventListener('pointerup', up);
                  };
                  window.addEventListener('pointerup', up);
                }}
                title={`${e.label}: mantén para aplicar`}
              >
                {e.label}
                {padKey && <span className="ml-badge">{midiKeyLabel(padKey)}</span>}
              </button>
              <input
                className="ml-knob"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={amts[e.id] ?? 0}
                aria-label={`${e.label} cantidad`}
                onPointerDown={() => pickIf(knobSlot)}
                onChange={(ev) => setAmt(e.id, parseFloat(ev.target.value))}
              />
              <span className="ml-sub">{e.sub}{knobKey && <span className="ml-badge sm">{midiKeyLabel(knobKey)}</span>}</span>
            </div>
          );
        })}
      </div>

      <div className="ml-scenes">
        <span className="ml-scl">escenas</span>
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
  );
}
