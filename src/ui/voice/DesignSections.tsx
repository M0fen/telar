import type { VoiceParams } from '../../graph/types';
import { VOICE_VOWELS } from '../../graph/types';
import { MiniSlider } from '../../nodes/MiniSlider';

// Secciones presentacionales del estudio de voz: "reproducción" (modos/formante/pulir)
// y "diseño de sonido" (sliders agrupados). El estado vive en VoiceStudio; `set` es el
// setter con audición en vivo.

export function PlaybackSection({ v, melodic, set }: {
  v: VoiceParams; melodic: boolean; set: (patch: Partial<VoiceParams>) => void;
}) {
  return (
    <div className="vs-sec">
      <h4>reproducción</h4>
      <div className="vs-row">
        <div className="vs-modes">
          <button className={!melodic && !v.granular && !v.tempo ? 'on' : ''} disabled={melodic} onClick={() => set({ granular: false, tempo: false })} title="pitch real (recomendado)">natural</button>
          <button className={!melodic && !!v.tempo ? 'on' : ''} disabled={melodic} onClick={() => set({ tempo: true, granular: false })} title="al tempo: encaja la voz en N ciclos siguiendo el BPM (el tono acompaña a la velocidad; usa «afinar» para recuperar la altura)">al tempo</button>
          <button className={!melodic && v.granular && !v.tempo ? 'on' : ''} disabled={melodic} onClick={() => set({ granular: true, tempo: false })} title="granular: loopAt + chop">granular</button>
        </div>
        {!melodic && v.tempo && (
          <div className="vs-stepper" title="ciclos que ocupa la voz al encajar en el grid">
            <button onClick={() => set({ tempoCycles: Math.max(1, Math.round(Number(v.tempoCycles ?? 1)) - 1) })}>−</button>
            <b>{Math.max(1, Math.round(Number(v.tempoCycles ?? 1)))}<i>ciclos</i></b>
            <button onClick={() => set({ tempoCycles: Math.min(16, Math.round(Number(v.tempoCycles ?? 1)) + 1) })}>+</button>
          </div>
        )}
        <div className="vs-vowels">
          <button className={!v.vowel ? 'on' : ''} onClick={() => set({ vowel: '' })} title="sin formante">—</button>
          {VOICE_VOWELS.map((w) => (
            <button key={w} className={v.vowel === w ? 'on' : ''} onClick={() => set({ vowel: w })} title={`vocal ${w}`}>{w}</button>
          ))}
        </div>
        <button
          className={`vs-polish${v.polish ? ' on' : ''}`}
          onClick={() => set({ polish: !v.polish })}
          title="pulir: paso-alto (quita retumbe) + compresor (nivela la dinámica) → voz más pro"
        >{v.polish ? '✓ pulida' : 'pulir voz'}</button>
      </div>
    </div>
  );
}

export function SoundDesignSection({ v, melodic, set }: {
  v: VoiceParams; melodic: boolean; set: (patch: Partial<VoiceParams>) => void;
}) {
  return (
    <div className="vs-sec">
      <h4>diseño de sonido</h4>
      <div className="vs-group">
        <span className="vs-subcap">afinación & tiempo</span>
        <div className="vs-grid">
          <MiniSlider label="afinar" value={Number(v.pitchShift ?? 0)} min={-12} max={12} step={1} onChange={(x) => set({ pitchShift: x })} />
          <MiniSlider label="speed" value={Number(v.speed ?? 1)} min={0.25} max={4} step={0.05} onChange={(x) => set({ speed: x })} />
          <MiniSlider label="grain" value={Number(v.grain ?? 8)} min={1} max={32} step={1} disabled={melodic || !v.granular} onChange={(x) => set({ grain: x })} />
        </div>
      </div>
      <div className="vs-group">
        <span className="vs-subcap">carácter</span>
        <div className="vs-grid">
          <MiniSlider label="shape" value={Number(v.shape ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ shape: x })} />
          <MiniSlider label="pos" value={Number(v.position ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ position: x })} />
          <MiniSlider label="gain" value={Number(v.gain ?? 1)} min={0} max={1.5} step={0.01} onChange={(x) => set({ gain: x })} />
        </div>
      </div>
      <div className="vs-group">
        <span className="vs-subcap">espacio & anchura</span>
        <div className="vs-grid">
          <MiniSlider label="room" value={Number(v.room ?? 0)} min={0} max={0.8} step={0.02} onChange={(x) => set({ room: x })} />
          <MiniSlider label="delay" value={Number(v.delay ?? 0)} min={0} max={1} step={0.02} onChange={(x) => set({ delay: x })} />
          <MiniSlider label="spread" value={Number(v.spread ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ spread: x })} />
        </div>
        <label className="tn-syn-dsync" title="tiempo del eco vocal, sincronizado al tempo (fracción del compás). Puntillo 3/16 = el dub delay del dancehall — el throw de voz cae en el grid a cualquier BPM.">
          <span>tiempo eco</span>
          <select
            value={String(Number((v.delaysync ?? 3 / 16).toFixed(4)))}
            onChange={(e) => set({ delaysync: Number(e.target.value) })}
          >
            <option value={String(Number((1 / 16).toFixed(4)))}>1/16 semicorchea</option>
            <option value={String(Number((1 / 8).toFixed(4)))}>1/8 corchea</option>
            <option value={String(Number((1 / 6).toFixed(4)))}>1/6 tresillo</option>
            <option value={String(Number((3 / 16).toFixed(4)))}>3/16 puntillo (dub)</option>
            <option value={String(Number((1 / 4).toFixed(4)))}>1/4 negra</option>
          </select>
        </label>
      </div>
    </div>
  );
}
