import { useGraphStore } from '../store/useGraphStore';
import { useShallow } from 'zustand/react/shallow';
import { usePadRecStore, armPadRec, setPadMode, setPadOctave, learnPadBase, togglePadRec, newPadTrack } from '../audio/padRecorder';
import { scaleNote } from '../lib/padRecord';
import { keyLong } from '../lib/songKey';
import { midiKeyFor, midiKeyLabel } from '../store/useMidiStore';

// TOCAR Y GRABAR CON LOS PADS (Fase 7.1), dentro del panel MIDI en vivo: elige la pista, el modo
// (batería o escala del tema) y ● grabar (también desde un pad: apréndelo como cualquier control).
export function PadRecSection({ pick, pickIf }: { pick: string | null; pickIf: (slot: string) => boolean }) {
  const { armed, mode, octave, rec, base, learning, map, last, hits } = usePadRecStore(
    useShallow((s) => ({ armed: s.armed, mode: s.mode, octave: s.octave, rec: s.rec, base: s.base, learning: s.learning, map: s.map, last: s.last, hits: s.hits })),
  );
  const nodes = useGraphStore((s) => s.nodes);
  const songKey = useGraphStore((s) => s.songKey);
  const playing = useGraphStore((s) => s.playing);
  const sources = nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions)); // la pista de transiciones no se toca con pads
  const recKey = midiKeyFor('padrec.rec');
  const labels = mode === 'scale' ? Array.from({ length: 16 }, (_, i) => scaleNote(i, songKey, octave)) : map.map((s) => s ?? '');
  return (
    <div className="ml-sec">
      <h4>Pads → pista: tocar y grabar (cuantizado a semicorcheas, con la fuerza del pad)</h4>
      <div className="ml-padrec">
        <select className="ml-padsel" value={armed ?? ''} onChange={(e) => armPadRec(e.target.value || null)} title="la pista que tocan los pads">
          <option value="">— pads apagados —</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.data.name || s.id}</option>)}
        </select>
        <button className="ml-padnew" onClick={() => newPadTrack('drum')} title="pista de batería nueva (16 pasos vacíos, caja 909) y armada">＋ batería</button>
        <button className="ml-padnew" onClick={() => newPadTrack('melody')} title="pista melódica nueva (16 pasos vacíos) y armada en la escala del tema">＋ melodía</button>
        {armed && (
          <>
            <span className="ml-seg">
              <button className={mode === 'drum' ? 'on' : ''} onClick={() => setPadMode('drum')} title="cada pad, un sonido de batería">batería</button>
              <button className={mode === 'scale' ? 'on' : ''} onClick={() => setPadMode('scale')} title={`los pads son la escala del tema (${songKey ? keyLong(songKey) : 'do menor: elige la tonalidad en la barra'})`}>escala</button>
            </span>
            {mode === 'scale' && (
              <span className="ml-oct" title="octava del pad 1">
                <button onClick={() => setPadOctave(octave - 1)} disabled={octave <= 0}>−</button>
                <b>oct {octave}</b>
                <button onClick={() => setPadOctave(octave + 1)} disabled={octave >= 6}>+</button>
              </span>
            )}
            <button
              className={`ml-rec${rec ? ' on' : ''}${pick === 'padrec.rec' ? ' pick' : ''}`}
              onPointerDown={() => { if (pickIf('padrec.rec')) return; togglePadRec(); }}
              title="● grabar: con ▶ (arranca solo), cada golpe entra en la rejilla de la pista; toda la toma es un paso de Ctrl+Z"
            >
              {rec ? `■ parar (${hits})` : '● grabar'}
              {recKey && <span className="ml-badge sm">{midiKeyLabel(recKey)}</span>}
            </button>
          </>
        )}
      </div>
      {armed && (
        <>
          <div className="ml-padgrid">
            {labels.map((l, i) => (
              <span key={`${i}-${last?.pad === i ? last.at : 0}`} className={`ml-padcell${l ? '' : ' empty'}${last?.pad === i ? ' hit' : ''}`} title={l ? `pad ${i + 1}: ${l}` : `pad ${i + 1}: libre`}>
                <i>{i + 1}</i>{l || '·'}
              </span>
            ))}
          </div>
          <p className="ml-hint">
            {learning ? <b>Toca el pad que será el 1…</b> : <>Pad 1 = nota {base} · <button className="ml-link" onClick={learnPadBase}>aprender el pad 1</button></>}
            {rec && !playing ? ' · arrancando ▶…' : rec ? ' · grabando: lo que toques entra en el bucle' : ' · los pads suenan; ● grabar para que queden en la pista'}
          </p>
        </>
      )}
    </div>
  );
}
