import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { tapTempo } from '../lib/tapTempo';
import { ROOT_NAMES, keyLong, keyShort, suggestKey } from '../lib/songKey';
import type { WarpInfo } from '../lib/loopWarp';
import { Knob } from './Knob';

// Nombre de la nota (clave) para mostrar el "tono". 0 = C (sin transposición).
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const keyName = (t: number) => KEYS[(((t % 12) + 12) % 12)];

// TONALIDAD DEL TEMA (Fase 5.1): raíz + modo, sin tonalidad, la sugerida por los loops de Splice
// del proyecto y el tono (transposición) con su «volver a 0».
function KeyPicker({ onClose }: { onClose: () => void }) {
  const songKey = useGraphStore((s) => s.songKey);
  const setSongKey = useGraphStore((s) => s.setSongKey);
  const transpose = useGraphStore((s) => s.transpose);
  const setTranspose = useGraphStore((s) => s.setTranspose);
  const nodes = useGraphStore((s) => s.nodes);
  const files = useMemo(() => nodes.map((n) => (n.data.warp as WarpInfo | undefined)?.file).filter((f): f is string => !!f), [nodes]);
  const sug = useMemo(() => suggestKey(files), [files]);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const minor = songKey?.minor ?? true;
  const showSug = sug && (!songKey || sug.key.root !== songKey.root || sug.key.minor !== songKey.minor);
  return (
    <div className="key-pop" ref={ref}>
      <div className="key-pop-head">tonalidad del tema</div>
      <div className="key-roots">
        {ROOT_NAMES.map((r, i) => (
          <button key={r} className={songKey?.root === i ? 'on' : ''} onClick={() => setSongKey({ root: i, minor })}>{r}</button>
        ))}
      </div>
      <div className="key-modes">
        <button className={songKey && songKey.minor ? 'on' : ''} onClick={() => setSongKey({ root: songKey?.root ?? 9, minor: true })}>menor</button>
        <button className={songKey && !songKey.minor ? 'on' : ''} onClick={() => setSongKey({ root: songKey?.root ?? 0, minor: false })}>mayor</button>
        <button className={!songKey ? 'on' : ''} onClick={() => setSongKey(null)} title="sin tonalidad: la escala vuelve a C y los loops no se transponen">sin tonalidad</button>
      </div>
      {showSug && sug && (
        <button className="key-sug" onClick={() => setSongKey(sug.key)} title="la tonalidad que traen los loops de Splice del proyecto">
          usar {keyLong(sug.key)} · la de {sug.votes} loop{sug.votes === 1 ? '' : 's'}
        </button>
      )}
      {transpose !== 0 && (
        <div className="key-tr">
          tono {transpose > 0 ? '+' : ''}{transpose}{songKey ? <> → suena en <b>{keyLong(songKey, transpose)}</b></> : null}
          <button onClick={() => setTranspose(0)}>volver a 0</button>
        </div>
      )}
      <p className="key-hint">La usan los secuenciadores (escala), el autotune de la voz y el nombre de lo que exportas. Los − + de al lado transponen el tema.</p>
    </div>
  );
}

// Transporte: Play/Stop + tempo (perilla + BPM editable + tap) + tono. setcps
// controla la velocidad del scheduler. BPM ≈ cps · 60 · tiempos_por_ciclo. El "/N"
// (tiempos por ciclo) es opcional: por defecto se oculta y se asume 4. (master-prompt §5)
export function Transport() {
  const playing = useGraphStore((s) => s.playing);
  const initializing = useGraphStore((s) => s.initializing);
  const cps = useGraphStore((s) => s.cps);
  const beatsPerCycle = useGraphStore((s) => s.beatsPerCycle);
  const setBeatsPerCycle = useGraphStore((s) => s.setBeatsPerCycle);
  const transpose = useGraphStore((s) => s.transpose);
  const setTranspose = useGraphStore((s) => s.setTranspose);
  const songKey = useGraphStore((s) => s.songKey);
  const [keyOpen, setKeyOpen] = useState(false);
  const compileError = useGraphStore((s) => s.compileError);
  const runtimeError = useGraphStore((s) => s.runtimeError);
  const play = useGraphStore((s) => s.play);
  const stop = useGraphStore((s) => s.stop);
  const setCpsValue = useGraphStore((s) => s.setCpsValue);

  // El "/N" se muestra si el usuario lo activa o si ya no es el 4 por defecto.
  const [showBeats, setShowBeats] = useState(beatsPerCycle !== 4);

  const error = compileError ?? runtimeError;
  const bpm = Math.round(cps * 60 * beatsPerCycle);
  const setBpm = (b: number) => setCpsValue(Math.max(40, Math.min(300, b)) / (60 * beatsPerCycle));

  return (
    <div className="transport">
      <button className={`play ${playing ? 'on' : ''}`} onClick={() => (playing ? stop() : play())}>
        {playing ? '■ stop' : '▶ play'}
      </button>
      <div className="tempo">
        <Knob
          value={bpm}
          min={40}
          max={300}
          step={1}
          size={40}
          defaultValue={120}
          hideValue
          label="tempo (bpm)"
          onChange={(v) => setBpm(v)}
        />
        <div className="tempo-read">
          <div className="tempo-bpm">
            <input
              type="number"
              value={bpm}
              min={40}
              max={300}
              onChange={(e) => setBpm(Number(e.target.value))}
            />
            {/* "/N" opcional: chip para mostrarlo, luego input de tiempos por ciclo. */}
            {showBeats ? (
              <div className="tempo-beats" title="tiempos por ciclo (compás). doble-clic = ocultar">
                <span className="slash">/</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={beatsPerCycle}
                  onChange={(e) => setBeatsPerCycle(Number(e.target.value))}
                  onDoubleClick={() => beatsPerCycle === 4 && setShowBeats(false)}
                />
              </div>
            ) : (
              <button className="tempo-beats-add" title="añadir compás (/N)" onClick={() => setShowBeats(true)}>
                /
              </button>
            )}
            <span>bpm</span>
          </div>
          <span className="cps">cps {cps.toFixed(3)}</span>
        </div>
        <button
          className="tap"
          title="tap tempo: pulsa al ritmo (tecla T)"
          onClick={() => {
            const c = tapTempo();
            if (c) setCpsValue(c);
          }}
        >
          tap
        </button>
      </div>
      {/* Tonalidad + tono: con tonalidad (5.1) muestra la que SUENA (raíz + tono); − + transponen
          en semitonos (note(…)); clic en el centro = elegir la tonalidad o volver el tono a 0. */}
      <div className="tono-wrap">
        <div className="tono" title={`${songKey ? `tonalidad ${keyLong(songKey)} · ` : ''}tono: ${transpose >= 0 ? '+' : ''}${transpose} semitonos`}>
          <button className="tono-step" onClick={() => setTranspose(transpose - 1)} title="bajar semitono">−</button>
          <button className={`tono-key${songKey ? ' has-key' : ''}`} onClick={() => setKeyOpen(!keyOpen)} title="tonalidad del tema (clic = elegir)">
            {songKey ? keyShort(songKey, transpose) : keyName(transpose)}
            <span className="tono-semi">{transpose === 0 ? (songKey ? 'tonalidad' : 'tono') : `${transpose > 0 ? '+' : ''}${transpose}`}</span>
          </button>
          <button className="tono-step" onClick={() => setTranspose(transpose + 1)} title="subir semitono">+</button>
        </div>
        {keyOpen && <KeyPicker onClose={() => setKeyOpen(false)} />}
      </div>
      <div className={`status ${error ? 'err' : 'ok'}`} title={error ?? undefined}>
        {error ? `⚠ ${error}` : initializing ? '◌ init audio…' : playing ? '● live' : '○ idle'}
      </div>
    </div>
  );
}
