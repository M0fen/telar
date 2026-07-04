import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { tapTempo } from '../lib/tapTempo';
import { Knob } from './Knob';

// Nombre de la nota (clave) para mostrar el "tono". 0 = C (sin transposición).
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const keyName = (t: number) => KEYS[(((t % 12) + 12) % 12)];

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
      {/* Tono: transposición global en semitonos (solo afecta note(…)). El número
          grande es la clave; los botones suben/bajan; clic en la clave = reset. */}
      <div className="tono" title={`tono: ${transpose >= 0 ? '+' : ''}${transpose} semitonos`}>
        <button className="tono-step" onClick={() => setTranspose(transpose - 1)} title="bajar semitono">−</button>
        <button className="tono-key" onClick={() => setTranspose(0)} title="clic = volver a C (0)">
          {keyName(transpose)}
          <span className="tono-semi">{transpose === 0 ? 'tono' : `${transpose > 0 ? '+' : ''}${transpose}`}</span>
        </button>
        <button className="tono-step" onClick={() => setTranspose(transpose + 1)} title="subir semitono">+</button>
      </div>
      <div className={`status ${error ? 'err' : 'ok'}`} title={error ?? undefined}>
        {error ? `⚠ ${error}` : initializing ? '◌ init audio…' : playing ? '● live' : '○ idle'}
      </div>
    </div>
  );
}
