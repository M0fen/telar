// Mini-fader monocromo reutilizable (estética algorave): etiqueta + slider fino +
// valor. Lo usan el panel de synth y el editor de voz. "Simple pero pro".
function fmtDefault(v: number, max: number): string {
  if (max >= 100) return String(Math.round(v));
  const s = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return s || '0';
}

export function MiniSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number, max: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className={`tn-ms${disabled ? ' is-off' : ''}`} title={label}>
      <span className="tn-ms-k">{label}</span>
      <input
        type="range"
        className="tn-ms-r nodrag"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <span className="tn-ms-v">{(format ?? fmtDefault)(value, max)}</span>
    </label>
  );
}
