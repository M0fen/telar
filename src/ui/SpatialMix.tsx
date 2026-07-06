import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store/useGraphStore';
import { useVizFlagsStore } from '../store/useVizFlagsStore';
import { getBranchMetric, requestCentroid, releaseCentroid } from '../audio/branchMeter';
import { DEFAULT_CHANNEL_EQ } from '../graph/types';

// V3 — SUPERFICIE DE MEZCLA ESPACIAL. Cada source = un punto en una caja:
//   X = paneo (chPan)          · arrastrar horizontal → coloca en el estéreo
//   Y = centro de frecuencia   · arrastrar vertical → inclina el EQ del canal (grave↔agudo)
//   tamaño/brillo = nivel real (medición por rama)
//   halo = reverb del canal (chRoom) · rueda del ratón sobre el punto
// Los puntos amontonados en la misma banda vertical (misma frecuencia) se marcan: pelean
// por el mismo rango. Es una superficie de MEZCLA (escribe pan/EQ/reverb en vivo), no un
// dibujo. La animación (posición Y + tamaño en vivo) es imperativa (rAF, sin re-render).

const TILT_DB = 11; // inclinación máxima del EQ al llevar un punto arriba/abajo
const COLLIDE_Y = 0.055; // cercanía en Y (frecuencia) que cuenta como colisión
const AUDIBLE = 0.06; // nivel mínimo para contar en colisiones

export function SpatialMix({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nodes = useGraphStore((s) => s.nodes);
  const update = useGraphStore((s) => s.updateNodeData);
  const spatialMix = useVizFlagsStore((s) => s.flags.spatialMix);
  const branchMetering = useVizFlagsStore((s) => s.flags.branchMetering);
  const sources = useMemo(
    () => nodes.filter((n) => n.data.kind === 'source').map((n) => ({ id: n.id, name: (n.data.name?.trim() || n.data.code?.trim() || 'src').slice(0, 14), chPan: Number(n.data.chPan ?? 0.5), chRoom: Number(n.data.chRoom ?? 0) })),
    [nodes],
  );
  const areaRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef(new Map<string, HTMLDivElement>());
  const dragging = useRef<string | null>(null);
  // el rAF lee los sources por REF (no por dep) para no reiniciarse en cada arrastre.
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Mientras el panel está abierto, PIDE el cálculo del centroide (meterEngine solo lo
  // computa bajo demanda → sin costo de frecuencia cuando V3 está cerrado).
  useEffect(() => {
    if (!open) return;
    requestCentroid();
    return () => releaseCentroid();
  }, [open]);

  // rAF: posiciona cada punto por su medición (Y = centroide, tamaño = nivel) + su chPan
  // (X) + halo (chRoom), y marca las colisiones de frecuencia. Solo con el panel ABIERTO y
  // el flag spatialMix activo (no-op real en off). Imperativo, sin re-render por frame.
  useEffect(() => {
    if (!open || !spatialMix) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const list = sourcesRef.current;
      const ys: { id: string; y: number; level: number }[] = [];
      for (const s of list) {
        const el = dotRefs.current.get(s.id);
        if (!el) continue;
        const m = getBranchMetric(s.id);
        const level = m?.level ?? 0;
        const y = 1 - (m?.centroid01 ?? 0.5); // agudo arriba, grave abajo
        if (dragging.current !== s.id) {
          el.style.left = `${s.chPan * 100}%`;
          el.style.top = `${y * 100}%`;
        }
        el.style.setProperty('--sz', `${10 + level * 30}px`);
        el.style.setProperty('--lvl', level.toFixed(3));
        el.style.setProperty('--halo', `${(s.chRoom * 34).toFixed(1)}px`);
        ys.push({ id: s.id, y, level });
      }
      // colisiones: pares con Y cercano y ambos audibles → pelean por el mismo rango
      const collide = new Set<string>();
      for (let i = 0; i < ys.length; i++) {
        for (let j = i + 1; j < ys.length; j++) {
          if (ys[i].level > AUDIBLE && ys[j].level > AUDIBLE && Math.abs(ys[i].y - ys[j].y) < COLLIDE_Y) {
            collide.add(ys[i].id);
            collide.add(ys[j].id);
          }
        }
      }
      for (const s of list) dotRefs.current.get(s.id)?.classList.toggle('collide', collide.has(s.id));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, spatialMix]);

  // arrastre: X → chPan (paneo) · Y → inclinación del EQ del canal (grave↔agudo). Durante
  // el arrastre el punto sigue al cursor (dragging skip en el rAF); al soltar, el centroide
  // medido ya se movió hacia donde lo dejaste (lo ves Y lo oyes).
  const onDotDown = (id: string) => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    dragging.current = id;
    const area = areaRef.current!;
    // BASELINE: el EQ manual del canal al empezar. El tilt se aplica SOBRE él (no lo pisa):
    // en el centro (tilt 0) el EQ queda idéntico al que tenías; arrastrar inclina alrededor.
    const base = { ...DEFAULT_CHANNEL_EQ, ...(useGraphStore.getState().nodes.find((n) => n.id === id)?.data.eq ?? {}) };
    const clampDb = (v: number) => Math.max(-15, Math.min(15, v));
    const move = (m: PointerEvent) => {
      const r = area.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (m.clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (m.clientY - r.top) / r.height));
      const el = dotRefs.current.get(id);
      if (el) { el.style.left = `${x * 100}%`; el.style.top = `${y * 100}%`; }
      // X → paneo. Y → tilt de EQ: arriba (y→0) = agudo (high+ / low−); abajo = grave.
      const tilt = (0.5 - y) * 2; // -1..1
      update(id, {
        chPan: Number(x.toFixed(3)),
        eq: {
          ...base,
          on: true,
          low: Number(clampDb((base.low ?? 0) - tilt * TILT_DB).toFixed(1)),
          high: Number(clampDb((base.high ?? 0) + tilt * TILT_DB).toFixed(1)),
        },
      });
    };
    const up = () => {
      dragging.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // rueda sobre un punto → reverb del canal (halo). Sin scroll de la página.
  const onDotWheel = (id: string) => (ev: React.WheelEvent) => {
    ev.preventDefault();
    const cur = Number(useGraphStore.getState().nodes.find((n) => n.id === id)?.data.chRoom ?? 0);
    const next = Math.max(0, Math.min(0.8, cur - ev.deltaY * 0.0012));
    update(id, { chRoom: Number(next.toFixed(3)) });
  };

  if (!open) return null;
  const hue = (i: number) => 150 + (i * 47) % 210; // tono por source, para distinguirlos

  return createPortal(
    <>
      <div className="sm-backdrop" onClick={onClose} />
      <div className="sm-panel">
        <header className="sm-head">
          <span className="sm-title">superficie de mezcla</span>
          <span className="sm-sub">X paneo · Y frecuencia · tamaño nivel · rueda = reverb</span>
          <button className="sm-x" onClick={onClose} title="cerrar">×</button>
        </header>
        {!branchMetering && (
          <div className="sm-warn">activa «medición por rama» (panel dev) para ver frecuencia y nivel en vivo.</div>
        )}
        {sources.length === 0 ? (
          <div className="sm-empty">no hay instrumentos que mezclar todavía.</div>
        ) : (
          <div className="sm-area" ref={areaRef}>
            {/* ejes */}
            <span className="sm-axis-y sm-axis-hi">agudo</span>
            <span className="sm-axis-y sm-axis-lo">grave</span>
            <span className="sm-axis-x sm-axis-l">izq</span>
            <span className="sm-axis-x sm-axis-r">der</span>
            <span className="sm-mid-h" />
            <span className="sm-mid-v" />
            {sources.map((s, i) => (
              <div
                key={s.id}
                ref={(el) => { if (el) dotRefs.current.set(s.id, el); else dotRefs.current.delete(s.id); }}
                className="sm-dot"
                style={{ left: `${s.chPan * 100}%`, top: '50%', ['--hue' as string]: hue(i) }}
                onPointerDown={onDotDown(s.id)}
                onWheel={onDotWheel(s.id)}
                title={`${s.name} — arrastra: X paneo · Y EQ (grave↔agudo) · rueda: reverb`}
              >
                <span className="sm-dot-core" />
                <span className="sm-dot-label">{s.name}</span>
              </div>
            ))}
          </div>
        )}
        <p className="sm-hint">arrastra un punto: <b>izquierda/derecha</b> = paneo · <b>arriba/abajo</b> = inclina el EQ hacia agudos/graves. La <b>rueda</b> sube la reverb (halo). Dos puntos en la misma altura <b>pelean por la misma frecuencia</b> (se marcan): sepáralos moviéndolos en Y.</p>
      </div>
    </>,
    document.body,
  );
}
