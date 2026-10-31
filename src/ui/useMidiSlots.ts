import { useEffect } from 'react';
import { registerSlots } from '../audio/midiIn';
import { buildDjSlots } from '../audio/djMidi';
import { buildLiveSlots } from './MidiLive';
import { useGraphStore } from '../store/useGraphStore';

// Registro de slots MIDI para TODA la app (antes vivía en el panel EN VIVO: con el panel cerrado o en
// otra pestaña el controlador dejaba de tocar las pistas nuevas). Se rehace al cambiar las pistas.
export function useMidiSlotRegistry(): void {
  const sig = useGraphStore((s) => s.nodes.filter((n) => n.data.kind === 'source').map((n) => n.id).join('|'));
  useEffect(() => {
    registerSlots(buildLiveSlots(), 'live');
    registerSlots(buildDjSlots(), 'dj');
  }, [sig]);
}
