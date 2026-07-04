import { useState } from 'react';
import { enableMidi } from '../audio/engine';

// Activa la salida MIDI (WebMIDI) y muestra los dispositivos disponibles, para que
// sepas qué nombre poner en el nodo "midi out" (vacío = primera salida). (Tier 2)
export function MidiButton() {
  const [outs, setOuts] = useState<string[]>([]);
  const [on, setOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const enable = async () => {
    const list = await enableMidi();
    setOuts(list);
    setOn(true);
    setNote(list.length ? `${list.length} salida(s): ${list.join(' · ')}` : 'sin salidas MIDI conectadas');
    setTimeout(() => setNote(null), 3200);
  };

  return (
    <div className="midi-wrap">
      <button
        className={`midi-btn${on ? ' on' : ''}`}
        onClick={() => void enable()}
        title={outs.length ? `salidas MIDI: ${outs.join(', ')}` : 'activar salida MIDI'}
      >
        midi{outs.length ? ` · ${outs.length}` : ''}
      </button>
      {note && <span className="midi-note">{note}</span>}
    </div>
  );
}
