import { useGraphStore } from '../store/useGraphStore';
import { useIrStore } from '../store/useIrStore';
import { IR_SPACES } from '../lib/irGen';
import { DELAY_NOTES, returnsFromMaster, sendsActive } from '../lib/returns';
import { Knob } from './Knob';

// RETORNOS COMPARTIDOS (Fase 6.4): UNA reverb y UN eco a tempo para todo el tema, con su EQ (corte
// de graves y de agudos) y su nivel. Cada pista manda lo suyo con «→rev» / «→eco» en su
// mini-mezclador. Las perillas no recompilan (van al motor) y las escenas las recuerdan.
export function FxReturnsPanel() {
  const master = useGraphStore((s) => s.master);
  const setMaster = useGraphStore((s) => s.setMaster);
  // cuántas pistas mandan algo (número: selector estable)
  const sending = useGraphStore((s) => s.nodes.reduce((k, n) => k + (n.data.kind === 'source' && sendsActive(n.data.sends) ? 1 : 0), 0));
  const userIrs = useIrStore((s) => s.userIrs);
  const r = returnsFromMaster(master);
  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`);
  return (
    <div className="perf-ret">
      <div className="perf-ret-head">
        <span className="perf-bus-tag">retornos</span>
        <span className="perf-ret-hint">
          {sending ? `${sending === 1 ? '1 pista manda' : `${sending} pistas mandan`}` : 'manda una pista con «→rev» / «→eco» en su mini-mezclador'}
        </span>
      </div>
      <div className="perf-ret-row">
        <span className="perf-ret-tag">reverb</span>
        <select className="perf-space-sel" value={r.rvSpace} onChange={(e) => setMaster({ rvSpace: e.target.value })} title="el espacio de la reverb compartida (una sola para todo el tema)">
          <optgroup label="espacios">
            {IR_SPACES.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
          </optgroup>
          {userIrs.length > 0 && (
            <optgroup label="IRs reales (tuyos)">
              {userIrs.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
            </optgroup>
          )}
        </select>
        <div className="perf-cell">
          <Knob value={r.rvLevel} min={-30} max={6} step={0.5} size={30} defaultValue={0} label="nivel del retorno de reverb (dB)" onChange={(v) => setMaster({ rvLevel: v })} />
          <span className="perf-cap">nivel</span>
        </div>
        <div className="perf-cell">
          <Knob value={r.rvPre} min={0} max={150} step={1} size={30} defaultValue={20} label="pre-delay (ms): separa el golpe de su cola" onChange={(v) => setMaster({ rvPre: v })} />
          <span className="perf-cap">pre</span>
        </div>
        <div className="perf-cell">
          <Knob value={r.rvLow} min={20} max={1000} step={1} scale="exp" size={30} defaultValue={250} label={`corte de graves de la cola: ${hz(r.rvLow)} Hz (que no embarre el bombo)`} onChange={(v) => setMaster({ rvLow: Math.round(v) })} />
          <span className="perf-cap">graves</span>
        </div>
        <div className="perf-cell">
          <Knob value={r.rvHigh} min={1500} max={20000} step={10} scale="exp" size={30} defaultValue={9000} label={`corte de agudos de la cola: ${hz(r.rvHigh)} Hz`} onChange={(v) => setMaster({ rvHigh: Math.round(v) })} />
          <span className="perf-cap">agudos</span>
        </div>
      </div>
      <div className="perf-ret-row">
        <span className="perf-ret-tag">eco</span>
        <select className="perf-space-sel" value={String(r.dlNote)} onChange={(e) => setMaster({ dlNote: Number(e.target.value) })} title="la división del eco, a tempo">
          {DELAY_NOTES.map((n) => <option key={n.label} value={String(n.beats)} title={n.title}>{n.label}</option>)}
        </select>
        <div className="perf-cell">
          <Knob value={r.dlLevel} min={-30} max={6} step={0.5} size={30} defaultValue={0} label="nivel del retorno de eco (dB)" onChange={(v) => setMaster({ dlLevel: v })} />
          <span className="perf-cap">nivel</span>
        </div>
        <div className="perf-cell">
          <Knob value={r.dlFb} min={0} max={0.9} step={0.01} size={30} defaultValue={0.35} label="repeticiones (realimentación)" onChange={(v) => setMaster({ dlFb: v })} />
          <span className="perf-cap">repet.</span>
        </div>
        <div className="perf-cell">
          <Knob value={r.dlLow} min={20} max={2000} step={1} scale="exp" size={30} defaultValue={300} label={`corte de graves de las repeticiones: ${hz(r.dlLow)} Hz (cada vuelta más fina)`} onChange={(v) => setMaster({ dlLow: Math.round(v) })} />
          <span className="perf-cap">graves</span>
        </div>
        <div className="perf-cell">
          <Knob value={r.dlHigh} min={1000} max={20000} step={10} scale="exp" size={30} defaultValue={5000} label={`corte de agudos de las repeticiones: ${hz(r.dlHigh)} Hz (cada vuelta más oscura)`} onChange={(v) => setMaster({ dlHigh: Math.round(v) })} />
          <span className="perf-cap">agudos</span>
        </div>
      </div>
    </div>
  );
}
