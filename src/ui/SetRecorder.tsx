import { useEffect, useRef, useState } from 'react';
import { setElapsed, startSet, stopSet, useSetRec } from '../audio/setRecorder';
import { cueSheet, fmtStamp, tracklistText } from '../lib/setList';
import { downloadBlob } from '../lib/songExport';
import { toast } from '../store/useNotifyStore';

// GRABAR EL SET (modo DJ, DJ-4): el botón de la consola y lo que queda al parar — el MP3, la lista
// para pegar y el .cue. Mientras graba, la lista de temas se va armando a la vista.

export function SetRecButton() {
  const rec = useSetRec((s) => s.rec);
  const finishing = useSetRec((s) => s.finishing);
  const clock = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!rec) return;
    const t = window.setInterval(() => { if (clock.current) clock.current.textContent = fmtStamp(setElapsed()); }, 250);
    return () => window.clearInterval(t);
  }, [rec]);
  const onClick = async () => {
    if (finishing) return;
    if (rec) { await stopSet(); return; }
    if (!(await startSet())) {
      const e = useSetRec.getState().error;
      if (e) toast.warn(e);
    }
  };
  return (
    <button className={`dj-codebtn set-rec${rec ? ' on' : ''}`} data-midi="dj.setrec" onClick={() => void onClick()}
      title={rec ? 'parar y guardar el set (MP3 320 + lista de temas)' : 'grabar el set: lo que suena (MP3 320) y la lista de temas con su minuto'}>
      <span className="set-rec-dot" />
      {finishing ? 'cerrando…' : rec ? <span ref={clock}>0:00</span> : 'set'}
    </button>
  );
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function SetRecPanel() {
  const rec = useSetRec((s) => s.rec);
  const entries = useSetRec((s) => s.entries);
  const result = useSetRec((s) => s.result);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false); // ¿ya bajaste el MP3? (si no, cerrar pide un segundo toque)
  const [armed, setArmed] = useState(false);
  useEffect(() => { setSaved(false); setArmed(false); }, [result]);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(false), 3000); return () => window.clearTimeout(t); }, [armed]);
  if (!rec && !result) return null;
  const list = rec ? entries : result!.entries;
  const copy = async () => {
    try { await navigator.clipboard.writeText(tracklistText(list)); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { toast.warn('No pude copiar: selecciona la lista a mano.'); }
  };
  return (
    <div className={`set-panel${rec ? ' live' : ''}`}>
      {rec ? (
        <p className="set-head">grabando el set · {entries.length ? `${entries.length} ${entries.length === 1 ? 'tema' : 'temas'}` : 'cada tema que subas a la sala queda anotado con su minuto'}</p>
      ) : (
        <div className="set-head">
          <span>set grabado · {fmtStamp(result!.secs)} · {(result!.bytes / 1e6).toFixed(1)} MB · {list.length} {list.length === 1 ? 'tema' : 'temas'}</span>
          <span className="set-acts">
            <button className="sd-btn" onClick={() => { downloadBlob(result!.blob, `${result!.name}.mp3`); setSaved(true); }} title="descargar el set en MP3 320">MP3</button>
            <button className="sd-btn" disabled={!list.length} onClick={() => downloadBlob(new Blob([cueSheet(list, `${result!.name}.mp3`, `Set ${localDate(result!.when)}`)], { type: 'application/x-cue' }), `${result!.name}.cue`)}
              title="descargar el .cue: con él, un reproductor parte el MP3 en temas">.cue</button>
            <button className="sd-btn" disabled={!list.length} onClick={() => void copy()} title="copiar la lista de temas con su minuto (para Mixcloud, SoundCloud, una historia)">{copied ? 'copiada' : 'copiar lista'}</button>
            <button className={`sd-btn${armed ? ' warn' : ''}`} onClick={() => { if (saved || armed) useSetRec.setState({ result: null }); else setArmed(true); }}
              title={saved ? 'cerrar' : 'cerrar sin descargar: el MP3 se pierde (pide un segundo toque)'}>{armed ? '¿descartar?' : '×'}</button>
          </span>
        </div>
      )}
      {list.length > 0 && (
        <ol className="set-list">
          {list.map((e, i) => (
            <li key={`${e.t}-${i}`}><i>{fmtStamp(e.t)}</i> {e.title}<b>{[e.key, e.bpm ? `${Math.round(e.bpm)}` : ''].filter(Boolean).join(' · ')}</b><em>deck {e.deck}</em></li>
          ))}
        </ol>
      )}
    </div>
  );
}
