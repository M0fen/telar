// Transporte de la CANCIÓN — lo comparten la línea de tiempo del máster (SongTimeline) y la
// vista DAW. El motor que dispara las escenas vive aparte (ui/SongEngine, montado una vez en
// App) para que la canción siga aunque cambies de vista.
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { toast } from '../store/useNotifyStore';
import { songTotal, arrangeMismatches, timelinePos } from './songClock';
import { getScheduler } from '../audio/engine';

// ▶ canción = compás 1 para TODO: si el transporte ya suena se reinicia (stop + play: el
// scheduler vuelve al ciclo 0), así las escenas y los arrange de los instrumentos cuentan
// desde el mismo compás. Sonando a mitad de compás quedaban desfasados.
export async function playSong(): Promise<void> {
  const steps = useSongStore.getState().steps;
  if (!steps.length) return;
  if (useGraphStore.getState().playing) await useGraphStore.getState().stop();
  useSongStore.getState().setFrom(0); // ▶ canción = SIEMPRE desde el compás 1
  await useGraphStore.getState().play();
  useSongStore.getState().setPlaying(true);
  const total = songTotal(steps);
  const mismatches = arrangeMismatches(
    steps,
    useGraphStore.getState().nodes.filter((n) => n.data.kind === 'source').map((n) => ({ id: n.id, name: n.data.name, code: n.data.code })),
  );
  if (mismatches.length) {
    const list = mismatches.slice(0, 3).map((m) => `${m.name} (${m.bars})`).join(', ');
    toast.warn(`la canción dura ${total} compases y ${list}${mismatches.length > 3 ? '…' : ''} no: la primera vuelta cae junta, la segunda se desfasa. Usa ⇋ instrumentos.`);
  }
}

// TOCAR DESDE UN COMPÁS (Modo DAW, Fase 1.4), como un DAW al dar play en otro punto: reinicia
// el transporte (ciclo 0) con `from = bar` → el compilador adelanta TODO `bar` compases, así el
// primer compás que suena es el `bar + 1`, instrumentos (arrange) y escena de su sección juntos
// (el motor de la canción cuenta desde ahí). ■ lo devuelve a 0. `bar` va desde 0.
export async function playFrom(bar: number): Promise<void> {
  const g = useGraphStore.getState();
  if (g.playing) await g.stop(); // suelta el ½ tiempo y pone from en 0
  // con el loop de región activo: dentro de la región arranca ahí y sigue en bucle; fuera, lo apaga
  const sg = useSongStore.getState();
  if (sg.regionOn && sg.region && (bar < sg.region.start || bar >= sg.region.start + sg.region.bars)) sg.setRegionOn(false);
  useSongStore.getState().setFrom(bar);
  await useGraphStore.getState().play();
  if (useSongStore.getState().steps.length) useSongStore.getState().setPlaying(true);
}

// Detiene el MODO canción (deja de disparar escenas); el transporte sigue.
export function stopSong(): void {
  useSongStore.getState().setPlaying(false);
}

// ⟳ LOOP DE REGIÓN (Fase 2.4). Activarlo sonando reinicia en el inicio de la región (como un
// DAW al activar el ciclo); desactivarlo sonando sigue desde el compás donde iba. Parado,
// solo cambia el modo: el próximo ▶ toca la región en bucle. ■ no la borra.
export async function setRegionLoop(on: boolean): Promise<void> {
  const song = useSongStore.getState();
  if (on && !song.region) return;
  const g = useGraphStore.getState();
  if (on) {
    if (g.playing) await g.stop();
    useSongStore.getState().setRegionOn(true);
    if (g.playing) {
      await useGraphStore.getState().play();
      if (useSongStore.getState().steps.length) useSongStore.getState().setPlaying(true);
    }
    return;
  }
  const cur = g.playing ? Math.floor(timelinePos(Number(getScheduler()?.now?.() ?? 0), song)) : 0;
  useSongStore.getState().setRegionOn(false);
  if (g.playing) await playFrom(cur);
}
