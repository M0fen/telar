import { useCallback, useEffect, useRef } from 'react';

// Perilla rotatoria controlable arrastrando el mouse (vertical = subir/bajar) o con
// la RUEDA. Escala lineal o exponencial (frecuencias). Shift = ajuste fino, doble
// clic = reset al valor por defecto. Estética terminal/Pioneer: anillo + indicador.
interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: 'lin' | 'exp';
  size?: number;
  defaultValue?: number;
  label?: string;
  hideValue?: boolean; // oculta el número (cuando hay un readout aparte, ej. tempo)
  onChange: (v: number) => void;
}

const SWEEP = 270; // grados de recorrido de la perilla

function toNorm(v: number, min: number, max: number, scale: 'lin' | 'exp'): number {
  if (scale === 'exp') {
    const lo = Math.log(min <= 0 ? 1e-3 : min);
    const hi = Math.log(max);
    return (Math.log(Math.max(v, Math.exp(lo))) - lo) / (hi - lo);
  }
  return (v - min) / (max - min);
}
function fromNorm(t: number, min: number, max: number, scale: 'lin' | 'exp'): number {
  const c = Math.max(0, Math.min(1, t));
  if (scale === 'exp') {
    const lo = Math.log(min <= 0 ? 1e-3 : min);
    const hi = Math.log(max);
    return Math.exp(lo + c * (hi - lo));
  }
  return min + c * (max - min);
}

export function Knob({
  value: rawValue,
  min,
  max,
  step = 0.01,
  scale = 'lin',
  size = 34,
  defaultValue,
  label,
  hideValue,
  onChange,
}: KnobProps) {
  // onChange puede cambiar de identidad en cada render (cierra sobre los params
  // actuales). Lo leemos por ref para que el arrastre siempre use el más reciente
  // y nunca un cierre obsoleto.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // valor SEGURO: si llega undefined/NaN (p.ej. un parámetro que falta), cae al default
  // o al mínimo — nunca undefined (rompía toFixed/toNorm y tumbaba el panel).
  const value = typeof rawValue === 'number' && isFinite(rawValue) ? rawValue : (defaultValue ?? min);
  const valueRef = useRef(value); // valor más reciente para la rueda
  valueRef.current = value;
  const rootRef = useRef<HTMLDivElement>(null);

  const round = useCallback(
    (v: number) => {
      const s = step || 0.01;
      const r = Math.round(v / s) * s;
      // limpia ruido de coma flotante
      return Math.abs(r) >= 100 ? Math.round(r) : parseFloat(r.toFixed(4));
    },
    [step]
  );

  // Rueda del ratón: ajusta el valor por muescas. Listener nativo NO pasivo para
  // poder cancelar el scroll de la página (React lo registra pasivo por defecto).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startT = toNorm(valueRef.current, min, max, scale);
      const notch = e.shiftKey ? 1 / 400 : 1 / 40; // shift = fino
      const dir = e.deltaY < 0 ? 1 : -1;
      const t = Math.max(0, Math.min(1, startT + dir * notch));
      onChangeRef.current(round(fromNorm(t, min, max, scale)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [min, max, scale, round]);

  // Arrastre con listeners en window: captura el movimiento aunque el puntero
  // salga de la perilla y, sobre todo, NO altera el valor al soltar (antes el
  // pointer-capture sobre un hijo SVG provocaba un salto al mínimo al soltar).
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startT = toNorm(value, min, max, scale);
    const move = (ev: PointerEvent) => {
      const dy = startY - ev.clientY; // arriba = +
      const sens = ev.shiftKey ? 1 / 900 : 1 / 220; // shift = fino
      const t = Math.max(0, Math.min(1, startT + dy * sens));
      onChangeRef.current(round(fromNorm(t, min, max, scale)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const t = Math.max(0, Math.min(1, toNorm(value, min, max, scale)));
  const sw = Math.max(2, size * 0.085); // grosor del anillo, escala con el tamaño
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - sw - 1;
  const C = 2 * Math.PI * r;
  const arc = (SWEEP / 360) * C;
  const angle = -SWEEP / 2 + t * SWEEP; // grados desde arriba
  const rad = (angle * Math.PI) / 180;
  const ix = cx + Math.sin(rad) * (r - 2);
  const iy = cy - Math.cos(rad) * (r - 2);

  const display =
    value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : value >= 10 ? Math.round(value) : value.toFixed(2);

  return (
    <div
      ref={rootRef}
      className="knob"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (defaultValue != null) onChange(defaultValue);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={label ? `${label} · arrastra · rueda · shift=fino · doble clic=reset` : undefined}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* pista (270°, hueco abajo) */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#1b2530"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${C}`}
          transform={`rotate(135 ${cx} ${cy})`}
        />
        {/* valor */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#3df0d0"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${t * arc} ${C}`}
          transform={`rotate(135 ${cx} ${cy})`}
        />
        {/* indicador */}
        <line x1={cx} y1={cy} x2={ix} y2={iy} stroke="#3df0d0" strokeWidth={Math.max(1.4, sw * 0.5)} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={Math.max(1.4, sw * 0.5)} fill="#3df0d0" />
      </svg>
      {!hideValue && <span className="knob-val">{display}</span>}
    </div>
  );
}
