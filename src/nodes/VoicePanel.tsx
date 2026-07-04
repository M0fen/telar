import type { NodeData, VoiceParams } from '../graph/types';
import { VOICE_VOWELS, VOICE_SCALES, DEFAULT_VOICE } from '../graph/types';
import { useGraphStore } from '../store/useGraphStore';
import { MiniSlider } from './MiniSlider';

// Editor de voz: controles "tocables" sobre una grabación (sample). Mismo lenguaje
// visual que el panel de synth (mini-faders + selectores). Escribe en node.data.voice
// → el compilador (applyVoice) los aplica como sufijos en vivo:
//   melodía/autotune (note/scale) · position→begin · grain→chop · speed→speed ·
//   vowel→formante · shape→dist · room/delay→espacio · spread→pan · gain.
export function VoicePanel({ id, data }: { id: string; data: NodeData }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const v: VoiceParams = { ...DEFAULT_VOICE, ...(data.voice ?? {}) };
  const set = (patch: Partial<VoiceParams>) => update(id, { voice: { ...v, ...patch } });
  const melodic = !!(v.melody ?? '').trim();

  return (
    <div className="tn-synth tn-voice nodrag">
      {/* melodía / autotune: la voz "canta" la melodía. Con escala = grados snap a
          tono (autotune); sin escala = notas literales (c4 eb4 g4). */}
      <div className="tn-voice-mel">
        <input
          className="tn-voice-melin"
          value={v.melody ?? ''}
          placeholder={v.scale ? 'grados: 0 2 4 3' : 'melodía: c4 eb4 g4'}
          onChange={(e) => set({ melody: e.target.value })}
          title="re-afina la voz a esta melodía (autotune). Con escala usa grados (0 2 4); sin escala, notas (c4 eb4 g4)."
        />
        <select
          className="tn-voice-scale"
          value={v.scale ?? ''}
          onChange={(e) => set({ scale: e.target.value })}
          title="autotune: cuantiza la melodía (grados) a esta escala"
        >
          <option value="">notas</option>
          {VOICE_SCALES.map((s) => (
            <option key={s} value={s}>{s.replace('C:', '')}</option>
          ))}
        </select>
      </div>
      {/* modo de reproducción: natural (pitch real, recomendado) vs granular. En
          modo melódico ambos quedan inactivos (manda la melodía). */}
      <div className="tn-voice-mode">
        <button className={!melodic && !v.granular ? 'on' : ''} disabled={melodic} onClick={() => set({ granular: false })} title="pitch real (sin desafinar) — recomendado">natural</button>
        <button className={!melodic && v.granular ? 'on' : ''} disabled={melodic} onClick={() => set({ granular: true })} title="granular: loopAt + chop (afina el sample, texturas)">granular</button>
      </div>
      {/* selector de vocal (formante): — = sin formante */}
      <div className="tn-synth-waves">
        <button className={!v.vowel ? 'on' : ''} onClick={() => set({ vowel: '' })} title="sin formante">—</button>
        {VOICE_VOWELS.map((w) => (
          <button key={w} className={v.vowel === w ? 'on' : ''} onClick={() => set({ vowel: w })} title={`vocal ${w}`}>
            {w}
          </button>
        ))}
      </div>
      <div className="tn-synth-params">
        <MiniSlider label="pos" value={Number(v.position ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ position: x })} />
        {/* grain solo en modo granular (en natural/melódico no troceamos) */}
        <MiniSlider label="grain" value={Number(v.grain ?? 8)} min={1} max={32} step={1} disabled={melodic || !v.granular} onChange={(x) => set({ grain: x })} />
        <MiniSlider label="speed" value={Number(v.speed ?? 1)} min={0.25} max={4} step={0.05} onChange={(x) => set({ speed: x })} />
        <MiniSlider label="shape" value={Number(v.shape ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ shape: x })} />
        <MiniSlider label="room" value={Number(v.room ?? 0)} min={0} max={0.8} step={0.02} onChange={(x) => set({ room: x })} />
        <MiniSlider label="delay" value={Number(v.delay ?? 0)} min={0} max={1} step={0.02} onChange={(x) => set({ delay: x })} />
        <MiniSlider label="spread" value={Number(v.spread ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ spread: x })} />
        <MiniSlider label="gain" value={Number(v.gain ?? 1)} min={0} max={1.5} step={0.01} onChange={(x) => set({ gain: x })} />
      </div>
    </div>
  );
}
