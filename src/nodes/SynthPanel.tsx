import type { NodeData, SynthParams } from '../graph/types';
import { SYNTH_WAVES, DEFAULT_SYNTH } from '../graph/types';
import { SYNTH_PRESETS } from '../graph/synthPresets';
import { WAVETABLES } from '../audio/wavetables';
import { useGraphStore } from '../store/useGraphStore';
import { MiniSlider } from './MiniSlider';

// Mini-panel de synth nativo expandido: power (bypass) + presets + oscilador
// (ondas y wavetables) + FM + ADSR + filtro con envolvente + vibrato + carácter.
// ABRIR el panel NO cambia el sonido; el synth se activa con el switch, al elegir
// una onda/wavetable, aplicar un preset o mover cualquier control. (synth nativo)
const WAVE_GLYPH: Record<string, string> = {
  sawtooth: '⊿',
  square: '⊓',
  triangle: '△',
  sine: '∿',
  supersaw: '≣',
};

export function SynthPanel({ id, data }: { id: string; data: NodeData }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const setSynthEdit = useGraphStore((s) => s.setSynthEdit);
  const syn: SynthParams = { ...DEFAULT_SYNTH, ...(data.synth ?? {}) };
  const on = !!data.synthOn;
  // cualquier ajuste activa el synth (no así abrir el panel).
  const set = (patch: Partial<SynthParams>) => update(id, { synthOn: true, synth: { ...syn, ...patch } });
  const num = (v: number | undefined) => Number(v ?? 0);
  const applyPreset = (i: number) => {
    if (i < 0) return;
    update(id, { synthOn: true, synth: { ...DEFAULT_SYNTH, ...SYNTH_PRESETS[i].params } });
  };

  return (
    <div className="tn-synth nodrag">
      <div className="tn-syn-head">
        <button
          className={`tn-syn-power${on ? ' on' : ''}`}
          onClick={() => update(id, { synthOn: !on })}
          title={on ? 'synth activo · clic = bypass' : 'synth en bypass · clic = activar'}
        >
          {on ? '● on' : '○ bypass'}
        </button>
        <select
          className="tn-syn-preset"
          value=""
          onChange={(e) => applyPreset(Number(e.target.value))}
          onMouseDown={(e) => e.stopPropagation()}
          title="presets de timbre"
        >
          <option value="">preset…</option>
          {SYNTH_PRESETS.map((p, i) => (
            <option key={p.name} value={i}>{p.name}</option>
          ))}
        </select>
        <button className="tn-syn-expand" onClick={() => setSynthEdit(id)} title="abrir synth studio (panel grande con envolvente y onda)">⤢</button>
      </div>

      <div className="tn-synth-waves">
        {SYNTH_WAVES.map((w) => (
          <button key={w} className={syn.wave === w ? 'on' : ''} onClick={() => set({ wave: w })} title={w}>
            {WAVE_GLYPH[w] ?? w}
          </button>
        ))}
      </div>
      <div className="tn-syn-wt-wrap">
        <span className="tn-syn-tag" title="wavetables: formas de onda ricas (organ, buzz, hollow, vocal, metal)">wt</span>
        <div className="tn-synth-waves tn-syn-wt">
          {WAVETABLES.map((wt) => (
            <button key={wt.name} className={syn.wave === wt.name ? 'on' : ''} onClick={() => set({ wave: wt.name })} title={`wavetable · ${wt.label}`}>
              {wt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tn-syn-row">
        <span className="tn-syn-tag">amp</span>
        <MiniSlider label="A" value={num(syn.attack)} min={0} max={1} step={0.005} onChange={(v) => set({ attack: v })} />
        <MiniSlider label="D" value={num(syn.decay)} min={0} max={1} step={0.005} onChange={(v) => set({ decay: v })} />
        <MiniSlider label="S" value={num(syn.sustain)} min={0} max={1} step={0.01} onChange={(v) => set({ sustain: v })} />
        <MiniSlider label="R" value={num(syn.release)} min={0} max={2} step={0.01} onChange={(v) => set({ release: v })} />
      </div>

      <div className="tn-syn-row">
        <span className="tn-syn-tag">flt</span>
        <MiniSlider label="cut" value={num(syn.cutoff)} min={0} max={12000} step={50} onChange={(v) => set({ cutoff: v })} />
        <MiniSlider label="res" value={num(syn.lpq)} min={0} max={20} step={0.5} onChange={(v) => set({ lpq: v })} />
        <MiniSlider label="env" value={num(syn.lpenv)} min={0} max={4} step={0.05} onChange={(v) => set({ lpenv: v })} />
        <MiniSlider label="eA" value={num(syn.lpa)} min={0} max={1} step={0.005} onChange={(v) => set({ lpa: v })} />
      </div>

      <div className="tn-syn-row">
        <span className="tn-syn-tag">fm</span>
        <MiniSlider label="idx" value={num(syn.fm)} min={0} max={8} step={0.1} onChange={(v) => set({ fm: v })} />
        <MiniSlider label="rat" value={Number(syn.fmh ?? 1)} min={0.5} max={8} step={0.5} onChange={(v) => set({ fmh: v })} />
        <MiniSlider label="vib" value={num(syn.vib)} min={0} max={12} step={0.1} onChange={(v) => set({ vib: v })} />
        <MiniSlider label="dep" value={num(syn.vibmod)} min={0} max={2} step={0.05} onChange={(v) => set({ vibmod: v })} />
      </div>

      <div className="tn-syn-row">
        <span className="tn-syn-tag">chr</span>
        <MiniSlider label="noi" value={num(syn.noise)} min={0} max={1} step={0.02} onChange={(v) => set({ noise: v })} />
        <MiniSlider label="spr" value={num(syn.spread)} min={0} max={1} step={0.02} onChange={(v) => set({ spread: v })} />
        <MiniSlider label="drv" value={num(syn.drive)} min={0} max={1} step={0.02} onChange={(v) => set({ drive: v })} />
        <MiniSlider label="crsh" value={Number(syn.coarse ?? 1)} min={1} max={16} step={1} onChange={(v) => set({ coarse: v })} />
      </div>
    </div>
  );
}
