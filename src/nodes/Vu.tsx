import { useEffect, useRef } from 'react';
import { registerMeter, unregisterMeter } from './meterEngine';

// Barra de nivel (VU). id = 'master' o el id de un Source. El relleno lo anima el
// meterEngine (rAF compartido) escalando en X desde la izquierda.
export function Vu({ id, className }: { id: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    registerMeter(id, el);
    return () => unregisterMeter(id);
  }, [id]);
  return (
    <div className={`vu${className ? ' ' + className : ''}`}>
      <div ref={ref} className="vu-fill" />
    </div>
  );
}
