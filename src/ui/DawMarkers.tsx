import { useEffect, useRef, useState } from 'react';
import { useSongStore } from '../store/useSongStore';
import { useGraphStore } from '../store/useGraphStore';
import { playFrom } from '../lib/songTransport';
import type { SongMarker } from '../lib/projectStore';
import type { DawSection, DawTrack } from '../lib/dawModel';

// MARCADORES Y MINIMAPA (Fase 10.5).
// Marcadores: banderas con nombre sobre la regla. Clic = tocar desde ahí · arrastrar = moverlo ·
// doble clic = renombrar · clic derecho = quitar. «M» (o ＋ marcador) pone uno en el cabezal.
// Minimapa: la canción entera de un vistazo — cada sección con la ENERGÍA de lo que suena en ella
// (pistas encendidas por su volumen), los marcadores, el cabezal y la ventana que se ve; clic o
// arrastre para ir a esa parte.

let mkSeq = 0;
export const newMarkerId = () => `mk_${Date.now().toString(36)}_${(mkSeq++).toString(36)}`;

export function addMarkerAt(bar: number): void {
  const cur = useSongStore.getState().markers;
  const b = Math.max(0, Math.round(bar * 4) / 4);
  if (cur.some((m) => Math.abs(m.bar - b) < 0.01)) return;
  useGraphStore.getState().setMarkers([...cur, { id: newMarkerId(), bar: b, name: `marcador ${cur.length + 1}` }].sort((a, c) => a.bar - c.bar));
}

export function DawMarkers({ px, total }: { px: number; total: number }) {
  const markers = useSongStore((s) => s.markers);
  const [edit, setEdit] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; bar: number } | null>(null);
  const drag = useRef<{ id: string; x0: number; bar0: number; moved: boolean } | null>(null);
  const clickT = useRef<number | undefined>(undefined); // el clic toca desde ahí un instante después: un doble clic renombra
  const set = (next: SongMarker[]) => useGraphStore.getState().setMarkers(next.sort((a, b) => a.bar - b.bar));
  if (!markers.length && !dragging) return null;
  return (
    <div className="daw-markers" aria-label="marcadores">
      {markers.map((m) => {
        const bar = dragging?.id === m.id ? dragging.bar : m.bar;
        return (
          <div key={m.id} className={`daw-mk${dragging?.id === m.id ? ' drag' : ''}`} style={{ left: bar * px }}
            title={`${m.name} · compás ${Math.floor(m.bar) + 1}\nclic: tocar desde aquí · arrastrar: mover · doble clic: renombrar · clic derecho: quitar`}
            onPointerDown={(e) => {
              if (e.button !== 0 || edit === m.id) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: m.id, x0: e.clientX, bar0: m.bar, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const dx = e.clientX - d.x0;
              if (!d.moved && Math.abs(dx) < 4) return;
              d.moved = true;
              setDragging({ id: d.id, bar: Math.max(0, Math.min(total - 1, Math.round(d.bar0 + dx / px))) });
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (!d) return;
              if (d.moved && dragging) set(markers.map((x) => (x.id === d.id ? { ...x, bar: dragging.bar } : x)));
              else if (!d.moved) { window.clearTimeout(clickT.current); clickT.current = window.setTimeout(() => void playFrom(Math.floor(m.bar)), 240); }
              setDragging(null);
            }}
            onDoubleClick={(e) => { e.stopPropagation(); window.clearTimeout(clickT.current); setEdit(m.id); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); set(markers.filter((x) => x.id !== m.id)); }}
          >
            <span className="daw-mk-flag" />
            {edit === m.id ? (
              <input className="daw-mk-in" autoFocus defaultValue={m.name} maxLength={40}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => { const v = e.target.value.trim(); setEdit(null); if (v && v !== m.name) set(markers.map((x) => (x.id === m.id ? { ...x, name: v } : x))); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null); e.stopPropagation(); }} />
            ) : (
              <span className="daw-mk-name">{m.name}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// energía de cada sección: suma de los volúmenes de las pistas que suenan en ella (encendidas,
// audibles), por la parte de la sección que ocupan — normalizada a la sección más llena
export function sectionEnergies(sections: DawSection[], tracks: DawTrack[], gainOf: (id: string) => number): number[] {
  const raw = sections.map((s) => {
    let e = 0;
    for (const t of tracks) {
      if (!t.audible) continue;
      let cover = 0;
      for (const b of t.blocks) {
        if (b.state !== 'on') continue;
        const a = Math.max(s.start, b.start);
        const z = Math.min(s.start + s.bars, b.start + b.bars);
        if (z > a) cover += z - a;
      }
      e += Math.sqrt(Math.max(0, gainOf(t.id))) * Math.min(1, cover / Math.max(1, s.bars));
    }
    return e;
  });
  const max = Math.max(1e-6, ...raw);
  return raw.map((x) => x / max);
}

export function DawMinimap({ sections, tracks, total, px, view, scrollTo, phPos }: {
  sections: DawSection[];
  tracks: DawTrack[];
  total: number;
  px: number;
  view: { x0: number; w: number }; // px de la línea de tiempo: desde dónde y cuánto se ve
  scrollTo: (x0: number) => void;
  phPos: () => number; // compás que suena (NaN parado)
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const markers = useSongStore((s) => s.markers);
  const ref = useRef<HTMLDivElement>(null);
  const phRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = phPos();
      if (phRef.current) {
        phRef.current.style.display = Number.isFinite(p) ? '' : 'none';
        if (Number.isFinite(p)) phRef.current.style.transform = `translateX(${(p / Math.max(1, total)) * w}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phPos, total, w]);
  const gainOf = (id: string) => Number(nodes.find((n) => n.id === id)?.data.gain ?? 1) || 0;
  const energy = sectionEnergies(sections, tracks, gainOf);
  const k = w / Math.max(1, total); // px del minimapa por compás
  const visBars = Math.max(1, view.w / px);
  const startBar = view.x0 / px;
  const go = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const bar = ((clientX - r.left) / r.width) * total;
    scrollTo(Math.max(0, (bar - visBars / 2) * px));
  };
  const dragging = useRef(false);
  return (
    <div className="daw-mini" ref={ref} role="slider" aria-label="minimapa de la canción" aria-valuemin={1} aria-valuemax={total} aria-valuenow={Math.round(startBar) + 1}
      title="la canción entera: la altura de cada sección es su energía (lo que suena en ella). Clic o arrastra para ir ahí."
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); go(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) go(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}>
      {sections.map((s, i) => (
        <div key={i} className={`daw-mini-sec${i % 2 ? ' alt' : ''}`} style={{ left: s.start * k, width: Math.max(1, s.bars * k - 1) }}>
          <div className="daw-mini-e" style={{ height: `${Math.round(12 + energy[i] * 88)}%` }} />
          {s.bars * k > 44 && <span>{s.label}</span>}
        </div>
      ))}
      {markers.map((m) => <div key={m.id} className="daw-mini-mk" style={{ left: m.bar * k }} title={m.name} />)}
      <div className="daw-mini-view" style={{ left: startBar * k, width: Math.max(4, visBars * k) }} />
      <div className="daw-mini-ph" ref={phRef} style={{ display: 'none' }} />
    </div>
  );
}
