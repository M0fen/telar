import { useEffect, useState } from 'react';
import { useSongStore } from '../store/useSongStore';
import { useScenesStore } from '../store/useScenesStore';
import { useGraphStore } from '../store/useGraphStore';
import { getScheduler } from '../audio/engine';

// Línea de tiempo / SONG MODE: arregla la canción como secciones (escena × compases)
// y la reproduce avanzando por ellas al ritmo del reloj. Vive en el panel de
// performance (colapsable). Cada bloque = una sección editable.
export function SongTimeline() {
  const steps = useSongStore((s) => s.steps);
  const loop = useSongStore((s) => s.loop);
  const playing = useSongStore((s) => s.playing);
  const index = useSongStore((s) => s.index);
  const addStep = useSongStore((s) => s.addStep);
  const updateStep = useSongStore((s) => s.updateStep);
  const removeStep = useSongStore((s) => s.removeStep);
  const setLoop = useSongStore((s) => s.setLoop);
  const setPlaying = useSongStore((s) => s.setPlaying);
  const setIndex = useSongStore((s) => s.setIndex);
  const scenes = useScenesStore((s) => s.scenes);
  const [open, setOpen] = useState(false);

  // motor: mientras la canción suena, sigue el reloj (ciclos = compases) y dispara
  // la escena de la sección activa en cada frontera. Reinicia si cambian los pasos.
  useEffect(() => {
    if (!playing) return;
    if (!steps.length) { setPlaying(false); return; }
    const total = steps.reduce((s, st) => s + Math.max(1, st.bars), 0) || 1;
    const start = getScheduler()?.now?.() ?? 0;
    let last = -1;
    let raf = 0;
    const tick = () => {
      const now = getScheduler()?.now?.() ?? start;
      let elapsed = now - start;
      if (loop) elapsed = ((elapsed % total) + total) % total;
      else if (elapsed >= total) { setPlaying(false); return; }
      let acc = 0;
      let idx = steps.length - 1;
      for (let i = 0; i < steps.length; i++) { acc += Math.max(1, steps[i].bars); if (elapsed < acc) { idx = i; break; } }
      if (idx !== last) { last = idx; setIndex(idx); useScenesStore.getState().trigger(steps[idx].scene); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, steps, loop, setIndex, setPlaying]);

  const playSong = async () => {
    if (!steps.length) return;
    if (!useGraphStore.getState().playing) await useGraphStore.getState().play();
    setPlaying(true);
  };
  const stopSong = () => setPlaying(false);

  return (
    <div className={`song${open ? ' open' : ''}`}>
      <div className="song-head">
        <button className="song-toggle" onClick={() => setOpen((o) => !o)} title="línea de tiempo (song mode)">
          canción {open ? '▾' : '▸'}
        </button>
        {open && (
          <>
            <button className={`song-play${playing ? ' on' : ''}`} onClick={() => (playing ? stopSong() : void playSong())} title={playing ? 'detener la canción' : 'reproducir la canción (avanza por las secciones)'}>
              {playing ? '■ stop' : '▶ play'}
            </button>
            <button className={`song-loop${loop ? ' on' : ''}`} onClick={() => setLoop(!loop)} title="repetir la canción al terminar">⟳</button>
            <button className="song-add" onClick={addStep} title="añadir sección">+ sección</button>
          </>
        )}
      </div>
      {open && (
        <div className="song-track">
          {steps.length === 0 && <span className="song-empty">añade secciones y asigna a cada una una escena (captura escenas con ⇧+1–9). La canción salta entre ellas.</span>}
          {steps.map((st, i) => {
            const sc = scenes[st.scene];
            return (
              <div className={`song-step${i === index && playing ? ' active' : ''}`} key={st.id} style={{ flexGrow: Math.max(1, st.bars) }}>
                <div className="song-step-top">
                  <select value={st.scene} onChange={(e) => updateStep(st.id, { scene: Number(e.target.value) })} title="escena de esta sección">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}{scenes[n] ? '' : '·'}</option>)}
                  </select>
                  <button className="song-step-x" onClick={() => removeStep(st.id)} title="quitar sección">×</button>
                </div>
                <span className="song-step-name">{sc?.name ?? `escena ${st.scene}`}</span>
                <div className="song-step-bars">
                  <button onClick={() => updateStep(st.id, { bars: Math.max(1, st.bars - 1) })}>−</button>
                  <b>{st.bars}</b>
                  <button onClick={() => updateStep(st.id, { bars: Math.min(64, st.bars + 1) })}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
