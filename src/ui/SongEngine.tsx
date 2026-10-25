import { useEffect } from 'react';
import { useSongStore } from '../store/useSongStore';
import { useScenesStore } from '../store/useScenesStore';
import { useGraphStore } from '../store/useGraphStore';
import { getScheduler } from '../audio/engine';
import { songPosition } from '../lib/songClock';

// MOTOR DE LA CANCIÓN (sin interfaz). UN SOLO RELOJ: la posición de la canción es el ciclo
// del scheduler (1 ciclo = 1 compás), el mismo con el que corren los arrange de cada
// instrumento desde el ciclo 0; no hay `start` propio. Dispara la escena de la sección activa
// en cada frontera. Vive montado UNA vez en App, fuera de las vistas: antes estaba dentro de
// la línea de tiempo del máster y, al pasar a una vista sin ese panel, la canción dejaba de
// disparar sus escenas aunque el audio siguiera. Editar los pasos sonando no la reinicia.
export function SongEngine(): null {
  const steps = useSongStore((s) => s.steps);
  const loop = useSongStore((s) => s.loop);
  const playing = useSongStore((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    const song = useSongStore.getState();
    if (!steps.length) { song.setPlaying(false); return; }
    let last = -1;
    let raf = 0;
    const tick = () => {
      // P2.3 — ANTICIPACIÓN: el disparo por rAF llegaba hasta un frame + un hot-swap TARDE
      // respecto a la frontera del compás. Miramos ~90 ms hacia delante (en ciclos, según el
      // cps real) para que la escena aterrice EN el 1, no después.
      const lookCyc = 0.09 * (useGraphStore.getState().cps || 0.5);
      const pos = songPosition(steps, getScheduler()?.now?.() ?? 0, loop, lookCyc);
      if (pos.end) { useSongStore.getState().setPlaying(false); return; }
      if (pos.idx !== last) {
        last = pos.idx;
        useSongStore.getState().setIndex(pos.idx);
        useScenesStore.getState().trigger(steps[pos.idx].scene);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, steps, loop]);

  return null;
}
