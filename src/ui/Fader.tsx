import { useCallback, useEffect, useRef } from 'react';

// Fader vertical (mesa de mezclas). Arrastra el tirador o la pista; rueda para
// ajustar; Shift = fino; doble clic = reset al valor por defecto. El relleno sube
// desde abajo. Pensado para niveles/gains en la zona de performance.
interface FaderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  height?: number;
  label?: string;
  onChange: (v: number) => void;
}

export function Fader({ value: rawValue, min, max, step = 0.01, defaultValue, height = 92, label, onChange }: FaderProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // valor seguro: nunca undefined/NaN (rompía toFixed en el relleno).
  const value = typeof rawValue === 'number' && isFinite(rawValue) ? rawValue : (defaultValue ?? min);
  const valueRef = useRef(value);
  valueRef.current = value;
  const trackRef = useRef<HTMLDivElement>(null);

  const round = useCallback(
    (v: number) => {
      const s = step || 0.01;
      const r = Math.round(v / s) * s;
      return Math.abs(r) >= 100 ? Math.round(r) : parseFloat(r.toFixed(4));
    },
    [step]
  );

  const clampT = (t: number) => Math.max(0, Math.min(1, t));
  const toT = (v: number) => clampT((v - min) / (max - min));
  const fromT = (t: number) => min + clampT(t) * (max - min);

  // Arrastre: salta al punto donde pinchas y sigue el cursor (sens = alto del track).
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    // sin shift: salto absoluto al punto pinchado. con shift: ajuste fino por delta.
    const absolute = (clientY: number) => onChangeRef.current(round(fromT(1 - (clientY - rect.top) / rect.height)));
    if (!e.shiftKey) absolute(e.clientY);
    let lastY = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.shiftKey) {
        const dy = lastY - ev.clientY; // arriba = +
        onChangeRef.current(round(fromT(clampT(toT(valueRef.current) + dy / (rect.height * 4)))));
      } else {
        absolute(ev.clientY);
      }
      lastY = ev.clientY;
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

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const notch = e.shiftKey ? 1 / 400 : 1 / 40;
      const dir = e.deltaY < 0 ? 1 : -1;
      const t = clampT(toT(valueRef.current) + dir * notch);
      onChangeRef.current(round(fromT(t)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, round]);

  const t = toT(value);
  return (
    <div
      ref={trackRef}
      className="fader"
      style={{ height }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (defaultValue != null) onChange(defaultValue);
      }}
      title={label ? `${label} · arrastra · rueda · shift=fino · doble clic=reset` : undefined}
    >
      <div className="fader-fill" style={{ height: `${(t * 100).toFixed(1)}%` }} />
      <div className="fader-cap" style={{ bottom: `calc(${(t * 100).toFixed(1)}% - 3px)` }} />
    </div>
  );
}
