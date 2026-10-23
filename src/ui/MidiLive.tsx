import { useEffect, useRef, useState } from 'react';
import './MidiLive.css';
import { startMidiInput } from '../audio/engine';
import { registerSlots, handleMidi, type MidiSlot } from '../audio/midiIn';
import { useMidiStore, midiKeyFor, midiKeyLabel } from '../store/useMidiStore';
import { useGraphStore } from '../store/useGraphStore';
import { useScenesStore } from '../store/useScenesStore';
import type { MasterFx } from '../graph/compile';

// Modo EN VIVO con controlador MIDI (pads + perillas), aparte del mezclador DJ.
// Tres bloques, todos asignables por "aprender":
//   • EFECTOS (máster): un PAD engancha el efecto y su PERILLA gradúa la cantidad.
//   • PISTAS (cada source): PAD = mute, PERILLA = volumen, PERILLA = filtro.
//   • ESCENAS: 8 pads que disparan las escenas guardadas.
// Los efectos aplican al máster (setMaster, recompila con throttle); las pistas
// usan updateNodeData. NO toca DjMixer.tsx (se MONTA en ambos modos desde App).

interface FxDef {
  id: string;
  label: string;
  sub: string;
  param: keyof MasterFx;
  toParam: (amt01: number) => number;
}
const EFFECTS: FxDef[] = [
  { id: 'filtro', label: 'Filtro', sub: 'lpf', param: 'filter', toParam: (a) => -a },
  { id: 'eco', label: 'Eco', sub: 'delay', param: 'delay', toParam: (a) => a },
  { id: 'reverb', label: 'Reverb', sub: 'room', param: 'room', toParam: (a) => a * 0.8 },
  { id: 'crush', label: 'Crush', sub: 'bits', param: 'crush', toParam: (a) => a },
  { id: 'drive', label: 'Drive', sub: 'sat', param: 'drive', toParam: (a) => a },
  { id: 'gate', label: 'Gate', sub: 'corte', param: 'gate', toParam: (a) => Math.round(a * 16) },
];

// Base de SILBIDOS DE AVES, hipnótica, en La menor pentatónica — lista para soltar
// y mezclar con otra pista. Se insertan como sources nuevos SIN borrar el lienzo.
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
const srcGain = (id: string) => (gs().nodes.find((n) => n.id === id)?.data.gain ?? 1) as number;
const srcFilter = (id: string) => (gs().nodes.find((n) => n.id === id)?.data.chFilter ?? 0) as number;
const srcMuted = (id: string) => !!gs().nodes.find((n) => n.id === id)?.data.mute;

export function MidiLive() {
  const { on, learn, pick, inputs, err, map } = useMidiStore();
  const setStatus = useMidiStore((s) => s.setStatus);
  // sources del grafo (reactivo): la sección Pistas se arma con ellos.
  const nodes = useGraphStore((s) => s.nodes);
  const sources = nodes.filter((n) => n.data.kind === 'source');
  const srcSig = sources.map((s) => s.id).join('|');

  // cantidad (0..1) por efecto del máster, en ref para que las perillas MIDI lean
  // el valor vivo sin re-registrar en cada cambio.
  const amtRef = useRef<Record<string, number>>({ filtro: 0.5, eco: 0.4, reverb: 0.4, crush: 0.5, drive: 0.5, gate: 0.5 });
  const [amts, setAmts] = useState<Record<string, number>>({ ...amtRef.current });
  const heldRef = useRef<Record<string, number | undefined>>({});

  const applyParam = (id: string) => {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e) return;
    gs().setMaster({ [e.param]: e.toParam(amtRef.current[id] ?? 0) } as Partial<MasterFx>);
  };
  const setAmt = (id: string, v: number) => {
    amtRef.current = { ...amtRef.current, [id]: v };
    setAmts(amtRef.current);
    if (heldRef.current[id] !== undefined) applyParam(id);
  };
  const engage = (id: string) => {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e) return;
    heldRef.current[id] = (gs().master[e.param] as number) ?? 0;
    applyParam(id);
  };
  const release = (id: string) => {
    const e = EFFECTS.find((x) => x.id === id);
    if (!e) return;
    const saved = heldRef.current[id];
    heldRef.current[id] = undefined;
    gs().setMaster({ [e.param]: saved ?? 0 } as Partial<MasterFx>);
  };

  // Registra TODOS los slots (efectos + pistas + escenas). Se re-registra cuando
  // cambia la lista de sources (para incluir/quitar pistas). Los handlers leen
  // refs / getState, así que no hay estado rancio.
  useEffect(() => {
    const slots: Record<string, MidiSlot> = {};
    for (const e of EFFECTS) {
      slots[`fx.${e.id}.knob`] = { kind: 'knob', get: () => amtRef.current[e.id] ?? 0, set: (v) => setAmt(e.id, v) };
      slots[`fx.${e.id}.pad`] = { kind: 'pad', down: () => engage(e.id), up: () => release(e.id) };
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
  const pickName = (slot: string | null): string => {
    if (!slot) return '';
    const [kind, a, b] = slot.split('.');
    if (kind === 'fx') return `${EFFECTS.find((e) => e.id === a)?.label ?? a} · ${b === 'pad' ? 'pad' : 'perilla'}`;
    if (kind === 'scene') return `escena ${a}`;
    if (kind === 'src') {
      const nm = sources.find((s) => s.id === a)?.data.name ?? 'pista';
      return `${nm} · ${b === 'mute' ? 'mute' : b === 'gain' ? 'volumen' : 'filtro'}`;
    }
    return slot;
  };

  const addAves = () => gs().addSources(AVES);

  // Función (NO componente) para no remontar el slider en cada render — si fuera
  // un <Componente/> interno, React lo recrearía y cortaría el arrastre.
  const knobCtl = (slot: string, value: number, onCh: (v: number) => void, aria: string) => {
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
              : 'Conecta tu M-Wave para tocar en vivo.'}
        </span>
      </div>

      {learn && (
        <div className="ml-learnbar">
          {pick ? (
            <>Asignando <b>{pickName(pick)}</b>: ahora <b>mueve la perilla o pulsa el pad</b> en tu M-Wave.</>
          ) : (
            <>Modo aprender: <b>toca abajo</b> un pad o perilla (efecto, pista o escena) y luego <b>muévelo en tu controlador</b>. «✓ Terminar» cuando acabes.</>
          )}
        </div>
      )}

      <div className="ml-sec">
        <h4>Efectos (máster) — pad engancha · perilla gradúa</h4>
        <div className="ml-fxrow">
          {EFFECTS.map((e) => {
            const padSlot = `fx.${e.id}.pad`;
            const knobSlot = `fx.${e.id}.knob`;
            const padKey = midiKeyFor(padSlot);
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
                {knobCtl(knobSlot, amts[e.id] ?? 0, (v) => setAmt(e.id, v), `${e.label} cantidad`)}
                <span className="ml-sub">{e.sub}</span>
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
                  {knobCtl(`src.${id}.gain`, (s.data.gain ?? 1) / 1.5, (v) => gs().updateNodeData(id, { gain: v * 1.5 }), `volumen ${s.data.name || 'pista'}`)}
                  {knobCtl(`src.${id}.filter`, ((s.data.chFilter ?? 0) + 1) / 2, (v) => gs().updateNodeData(id, { chFilter: v * 2 - 1 }), `filtro ${s.data.name || 'pista'}`)}
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
