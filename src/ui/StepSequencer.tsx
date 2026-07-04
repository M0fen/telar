import { useEffect, useState } from 'react';
import { useSequencerStore, SEQ_SOUNDS, SEQ_BANKS } from '../store/useSequencerStore';
import { useGraphStore } from '../store/useGraphStore';
import { useUserSoundsStore } from '../store/useUserSoundsStore';
import { getScheduler } from '../audio/engine';

// SECUENCIADOR de pasos multipista (drum machine). Rejilla: filas = pistas (cada una
// un Source del grafo), columnas = pasos. Cabezal sincronizado al reloj. Editar una
// celda actualiza el patrón `.struct(...)` de esa pista. (useSequencerStore hace el sync)
export function StepSequencer() {
  const open = useSequencerStore((s) => s.open);
  const setOpen = useSequencerStore((s) => s.setOpen);
  const lanes = useSequencerStore((s) => s.lanes);
  const stepCount = useSequencerStore((s) => s.stepCount);
  const swing = useSequencerStore((s) => s.swing);
  const setStepCount = useSequencerStore((s) => s.setStepCount);
  const setSwing = useSequencerStore((s) => s.setSwing);
  const addLane = useSequencerStore((s) => s.addLane);
  const removeLane = useSequencerStore((s) => s.removeLane);
  const freezeLane = useSequencerStore((s) => s.freezeLane);
  const toggleStep = useSequencerStore((s) => s.toggleStep);
  const clearLane = useSequencerStore((s) => s.clearLane);
  const setLaneSound = useSequencerStore((s) => s.setLaneSound);
  const setLaneBank = useSequencerStore((s) => s.setLaneBank);
  const setLaneGain = useSequencerStore((s) => s.setLaneGain);
  const toggleMute = useSequencerStore((s) => s.toggleMute);
  const playing = useGraphStore((s) => s.playing);
  const userSounds = useUserSoundsStore((s) => s.sounds);

  const [cur, setCur] = useState(-1); // paso bajo el cabezal
  const known = [...SEQ_SOUNDS, ...userSounds];

  // cabezal: sigue el reloj (ciclo = compás). paso = floor(fracción_de_ciclo * pasos).
  useEffect(() => {
    if (!open || !playing) { setCur(-1); return; }
    let raf = 0;
    const tick = () => {
      const sched = getScheduler();
      if (sched) {
        const now = sched.now();
        setCur(Math.floor((now - Math.floor(now)) * stepCount));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, stepCount]);

  return (
    <>
      <button className={`seq-open${open ? ' on' : ''}`} onClick={() => setOpen(!open)} title="secuenciador de pasos (drum machine)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="2" y="4" width="4" height="4" rx="1" /><rect x="10" y="4" width="4" height="4" rx="1" opacity="0.4" /><rect x="18" y="4" width="4" height="4" rx="1" />
          <rect x="2" y="10" width="4" height="4" rx="1" opacity="0.4" /><rect x="10" y="10" width="4" height="4" rx="1" /><rect x="18" y="10" width="4" height="4" rx="1" opacity="0.4" />
          <rect x="2" y="16" width="4" height="4" rx="1" /><rect x="10" y="16" width="4" height="4" rx="1" /><rect x="18" y="16" width="4" height="4" rx="1" />
        </svg>
        seq
      </button>

      {open && (
        <div className="seq-panel">
          <header className="seq-head">
            <span className="seq-title">secuenciador</span>
            <div className="seq-steps-sel">
              {[8, 16, 32].map((n) => (
                <button key={n} className={stepCount === n ? 'on' : ''} onClick={() => setStepCount(n)}>{n}</button>
              ))}
            </div>
            <label className="seq-swing" title="swing (retrasa los off-beats)">
              swing<input type="range" min={0} max={0.6} step={0.02} value={swing} onChange={(e) => setSwing(Number(e.target.value))} /><i>{Math.round(swing * 100)}</i>
            </label>
            <span className="seq-add">
              <select value="" onChange={(e) => { const v = e.target.value; if (v) addLane(v, userSounds.includes(v) ? '' : 'RolandTR808'); }} title="añadir pista">
                <option value="">+ pista…</option>
                <optgroup label="batería">
                  {SEQ_SOUNDS.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
                {userSounds.length > 0 && (
                  <optgroup label="mis sonidos">
                    {userSounds.map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                )}
              </select>
            </span>
            <button className="seq-x" onClick={() => setOpen(false)} title="cerrar">×</button>
          </header>

          <div className="seq-grid">
            {lanes.length === 0 && <div className="seq-empty">añade una pista para empezar a picar un beat</div>}
            {lanes.map((l) => (
              <div key={l.id} className={`seq-lane${l.muted ? ' muted' : ''}`}>
                <div className="seq-lane-ctl nodrag">
                  <button className={`seq-mute${l.muted ? ' on' : ''}`} onClick={() => toggleMute(l.id)} title="silenciar pista">M</button>
                  <select className="seq-snd" value={known.includes(l.sound) ? l.sound : ''} onChange={(e) => { const v = e.target.value; setLaneSound(l.id, v); if (userSounds.includes(v)) setLaneBank(l.id, ''); }} title="sonido">
                    {!known.includes(l.sound) && <option value="">{l.sound}</option>}
                    <optgroup label="batería">
                      {SEQ_SOUNDS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </optgroup>
                    {userSounds.length > 0 && (
                      <optgroup label="mis sonidos">
                        {userSounds.map((s) => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <select className="seq-bank" value={l.bank} onChange={(e) => setLaneBank(l.id, e.target.value)} title="banco / caja de ritmos">
                    {SEQ_BANKS.map((b) => <option key={b} value={b}>{b ? b.replace('Roland', '').replace('Akai', '') : '—'}</option>)}
                  </select>
                  <input className="seq-gain" type="range" min={0} max={1.4} step={0.05} value={l.gain ?? 1} onChange={(e) => setLaneGain(l.id, Number(e.target.value))} title={`nivel ${(l.gain ?? 1).toFixed(2)}`} />
                  <button className="seq-clear" onClick={() => clearLane(l.id)} title="limpiar pista">∅</button>
                  <button className="seq-freeze" onClick={() => freezeLane(l.id)} title="fijar: guarda esta pista como un nodo suelto que sigue sonando (sale de la rejilla, editable y se guarda con el proyecto)">⤓</button>
                  <button className="seq-rm" onClick={() => removeLane(l.id)} title="quitar pista">×</button>
                </div>
                <div className="seq-cells" style={{ gridTemplateColumns: `repeat(${stepCount}, 1fr)` }}>
                  {Array.from({ length: stepCount }, (_, i) => (
                    <button
                      key={i}
                      className={`seq-cell${l.steps?.[i] ? ' on' : ''}${i % 4 === 0 ? ' beat' : ''}${i === cur ? ' cur' : ''}`}
                      onClick={() => toggleStep(l.id, i)}
                      title={`paso ${i + 1}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="seq-foot">las pistas son Sources del grafo (se conectan al Out) · edítalas también como nodos</div>
        </div>
      )}
    </>
  );
}
