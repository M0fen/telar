// LUCES DEL CONTROLADOR: cada 120 ms se arma lo que deberían mostrar los dos primeros decks de la
// mesa (deck 1 = A) y se manda solo lo que cambió. Fuera del DJ, todo apagado. Si el aparato no
// tiene salida MIDI, no pasa nada.
import { useGraphStore } from '../store/useGraphStore';
import type { NodeData } from '../graph/types';
import type { ControllerMap, DeckLights } from '../lib/controllerMaps';
import { isDeck, orderDecks, useDjStore } from './djMix';
import { useSongDecks } from './songDeck';
import { sendMidiTo } from './engine';

let timer = 0;

export function startLights(c: ControllerMap): void {
  window.clearInterval(timer);
  if (!c.lights) return;
  const sent = new Map<string, number>();
  const tick = () => {
    const g = useGraphStore.getState();
    const dj = g.mode === 'dj';
    const decks = dj ? orderDecks(g.nodes.filter((n) => isDeck(n as { id: string; data: NodeData }))).slice(0, 2) : [];
    const state: DeckLights[] = decks.map((n) => {
      const d = n.data as NodeData;
      const t = d.djTrack;
      const ui = useSongDecks.getState().d[n.id];
      const loopBeats = ui?.loop != null ? ui.loop * (t?.beats || 4) : null;
      return {
        loaded: true,
        playing: t ? !!ui?.playing : !d.mute,
        sync: t ? t.sync !== false : false,
        pfl: !!useDjStore.getState().cue[n.id],
        hot: (t?.hot ?? []).map((h) => h != null),
        loopBeats,
      };
    });
    for (const [st, note, v] of c.lights!(state)) {
      const k = `${st}:${note}`;
      if (sent.get(k) === v) continue;
      if (sendMidiTo(c.match, [st, note, v])) sent.set(k, v);
    }
  };
  tick();
  timer = window.setInterval(tick, 120);
}

export function stopLights(): void { window.clearInterval(timer); timer = 0; }
