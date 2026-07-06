import { MiniSlider } from '../../nodes/MiniSlider';
import { AT_ROOTS, AT_SCALE_NAMES } from './voiceUtils';

// Estado de la sección de corrección (vive en VoiceStudio para sobrevivir a
// cerrar/reabrir el panel, igual que antes del split).
export interface AtState { root: number; scale: string; speed: number; gate: number }

// B2 — AUTOTUNE REAL (corrige el tono de la toma) + B5 — LIMPIAR (noise gate).
// Presentacional: la lógica async (worker, bake) queda en VoiceStudio.
export function AutotuneSection({ at, busy, onAt, onRun, onClean }: {
  at: AtState;
  busy: boolean;
  onAt: (patch: Partial<AtState>) => void;
  onRun: (bake: boolean) => void;
  onClean: () => void;
}) {
  return (
    <div className="vs-sec">
      <h4>corregir tono · autotune real <span className="vs-h4sub">(afina tu grabación)</span></h4>
      <div className="vs-at">
        <label className="vs-at-scale" title="tonalidad a la que se cuantiza el tono de tu voz">
          <span>tono</span>
          <select className="nodrag" value={at.root} onChange={(e) => onAt({ root: Number(e.target.value) })}>{AT_ROOTS.map((r, i) => <option key={i} value={i}>{r}</option>)}</select>
          <select className="nodrag" value={at.scale} onChange={(e) => onAt({ scale: e.target.value })}>{AT_SCALE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <MiniSlider label="retune" value={at.speed} min={0} max={1} step={0.05} onChange={(x) => onAt({ speed: x })} />
        <button className="vs-fxbtn" disabled={busy} onClick={() => onRun(false)} title="previsualizar la corrección sin hornearla (A/B de escala y velocidad)">{busy ? '⋯' : '▶ probar'}</button>
        <button className="vs-crop" disabled={busy} onClick={() => onRun(true)} title="aplicar la corrección: la hornea en la voz (suena corregida en todo el proyecto). Irreversible en la sesión.">aplicar</button>
      </div>
      <p className="vs-hint">corrige el TONO de tu toma a la escala (tus palabras y tu tiempo intactos). <b>retune 0</b> = duro/robótico (T-Pain) · <b>alto</b> = natural. «probar» previsualiza; «aplicar» lo hornea. Distinto del «sampler» de arriba (que re-dispara notas).</p>
      <div className="vs-at">
        <MiniSlider label="ruido" value={at.gate} min={0} max={1} step={0.05} onChange={(x) => onAt({ gate: x })} />
        <button className="vs-crop" disabled={busy} onClick={onClean} title="limpiar: silencia el ruido de fondo / hiss entre frases (noise gate) y lo hornea en la voz. El de-esser (suavizar eses) llegará después.">✧ limpiar</button>
      </div>
      <p className="vs-hint">limpiar = quita el ruido de fondo (noise gate). Sube «ruido» si queda hiss entre frases; bájalo si se come el final de las palabras.</p>
    </div>
  );
}
