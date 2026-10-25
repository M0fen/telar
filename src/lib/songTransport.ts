// Transporte de la CANCIÓN — lo comparten la línea de tiempo del máster (SongTimeline) y la
// vista DAW. El motor que dispara las escenas vive aparte (ui/SongEngine, montado una vez en
// App) para que la canción siga aunque cambies de vista.
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { toast } from '../store/useNotifyStore';
import { songTotal, arrangeMismatches } from './songClock';

// ▶ canción = compás 1 para TODO: si el transporte ya suena se reinicia (stop + play: el
// scheduler vuelve al ciclo 0), así las escenas y los arrange de los instrumentos cuentan
// desde el mismo compás. Sonando a mitad de compás quedaban desfasados.
export async function playSong(): Promise<void> {
  const steps = useSongStore.getState().steps;
  if (!steps.length) return;
  if (useGraphStore.getState().playing) await useGraphStore.getState().stop();
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

// Detiene el MODO canción (deja de disparar escenas); el transporte sigue.
export function stopSong(): void {
  useSongStore.getState().setPlaying(false);
}
