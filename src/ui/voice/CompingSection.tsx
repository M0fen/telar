// B4 — COMPING: graba varias tomas y arma la mejor eligiendo por tramos.
// Presentacional: el estado (tomas/tramos/selección/grabación) vive en VoiceStudio
// para sobrevivir a cerrar/reabrir el panel; aquí solo se pinta y se delega.

export interface Take { id: number; buf: AudioBuffer; peaks: number[] }

export function CompingSection({ baseBuf, basePeaks, takes, nSeg, selection, recording, onRec, onStopRec, onNSeg, onPick, onRemoveTake, onCompose }: {
  baseBuf: AudioBuffer | null;
  basePeaks: number[] | null;
  takes: Take[];
  nSeg: number;
  selection: number[];
  recording: boolean;
  onRec: () => void;
  onStopRec: () => void;
  onNSeg: (n: number) => void;
  onPick: (seg: number, takeIdx: number) => void;
  onRemoveTake: (recIdx: number) => void;
  onCompose: () => void;
}) {
  return (
    <div className="vs-sec">
      <h4>comping · tomas <span className="vs-h4sub">(arma la mejor de varias)</span></h4>
      <div className="vs-at">
        <button className={`vs-fxbtn${recording ? ' on' : ''}`} onClick={recording ? onStopRec : onRec} title="graba una toma nueva con el micrófono (se añade como carril)">{recording ? '■ detener' : '● grabar toma'}</button>
        <span className="vs-at-scale" title="en cuántos tramos se divide la toma para elegir">
          <span>tramos</span>
          <button className="vs-warpstep" onClick={() => onNSeg(nSeg - 1)}>−</button>
          <b className="vs-warpsemi">{nSeg}</b>
          <button className="vs-warpstep" onClick={() => onNSeg(nSeg + 1)}>+</button>
        </span>
        <button className="vs-crop" onClick={onCompose} title="arma la toma final: cada tramo del carril elegido, con crossfades, y la aplica a la voz">componer</button>
      </div>
      <div className="vs-comp-lanes">
        {[{ buf: baseBuf, peaks: basePeaks ?? [] }, ...takes.map((t) => ({ buf: t.buf, peaks: t.peaks }))].map((lane, ci) => (
          lane.buf ? (
            <div className="vs-comp-lane" key={ci}>
              <span className="vs-comp-name">{ci === 0 ? 'actual' : `toma ${ci}`}</span>
              <div className="vs-comp-segs">
                {selection.map((selIdx, s) => {
                  const active = selIdx === ci;
                  const L = lane.peaks.length;
                  const segPk = lane.peaks.slice(Math.floor((s / nSeg) * L), Math.floor(((s + 1) / nSeg) * L));
                  return (
                    <button key={s} className={`vs-comp-seg${active ? ' on' : ''}`} onClick={() => onPick(s, ci)} title={`tramo ${s + 1}: usar ${ci === 0 ? 'la voz actual' : 'la toma ' + ci}`}>
                      {segPk.map((p, i) => <span key={i} style={{ height: `${Math.max(6, p * 100)}%` }} />)}
                    </button>
                  );
                })}
              </div>
              {ci > 0 && <span className="vs-rm-take" onClick={() => onRemoveTake(ci - 1)} title="quitar esta toma">×</span>}
            </div>
          ) : null
        ))}
      </div>
      <p className="vs-hint">graba varias tomas (mic) · en cada TRAMO, clic en el carril de la toma que quieres que suene ahí (se resalta) · «componer» arma la final con crossfades y la aplica. La «actual» es tu voz de ahora.</p>
    </div>
  );
}
