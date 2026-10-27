// LO QUE SE OYE DEL PATRÓN que se edita (9.3/9.4): los compases que lleva su vuelta, para el cabezal
// de la rejilla y del piano roll. Usa lo que SE OYE (8.2: heardCycle) en la línea de tiempo de la
// canción y, si el patrón es un brazo de un arrange, su tiempo propio (armTime). Con ▶ (audición de
// la sección) el brazo suena solo, desde el compás 0 de la línea de tiempo.
import { heardCycle } from '../audio/engine';
import { armTime, timelinePos, type ArmSpan } from '../lib/songClock';
import { useSongStore } from '../store/useSongStore';
import { useGraphStore } from '../store/useGraphStore';

export type ArmPos = ArmSpan;

export function heardPatternTime(arm: ArmPos | undefined, preview: boolean): number {
  if (!useGraphStore.getState().playing) return NaN;
  const t = timelinePos(heardCycle(), useSongStore.getState());
  if (!arm || preview) return t >= 0 ? t : NaN;
  return armTime(t, arm);
}
