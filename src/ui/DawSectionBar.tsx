import { useEffect, useState } from 'react';
import type { SongStep } from '../store/useSongStore';
import type { Scene } from '../store/useScenesStore';
import { dawSection } from '../lib/dawActions';
import { playFrom } from '../lib/songTransport';
import { MAX_SECTION_BARS } from '../lib/arrangeEdit';

// BARRA DE LA SECCIÓN SELECCIONADA (Modo DAW, Fase 2.2): nombre, escena, compases, mover,
// duplicar, sección vacía, borrar y tocar desde aquí. Cada botón es UN paso deshacible que
// edita la canción y el mismo brazo en todas las pistas (dawActions → arrangeEdit).
export function DawSectionBar({
  index, steps, scenes, start, onSelect,
}: {
  index: number;
  steps: SongStep[];
  scenes: Record<number, Scene>;
  start: number; // compás de inicio (desde 0)
  onSelect: (i: number) => void;
}) {
  const st = steps[index];
  const [name, setName] = useState(st?.name ?? '');
  useEffect(() => setName(st?.name ?? ''), [st?.id, st?.name]);
  if (!st) return null;
  const last = steps.length - 1;
  const commitName = () => { if ((st.name ?? '') !== name.trim()) dawSection.rename(index, name); };

  return (
    <div className="daw-secbar" role="toolbar" aria-label={`sección ${index + 1}`}>
      <span className="daw-secbar-n">sección {index + 1}</span>
      <input
        className="daw-secbar-name"
        value={name}
        placeholder={scenes[st.scene]?.name ?? `escena ${st.scene}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(st.name ?? ''); (e.target as HTMLInputElement).blur(); } }}
        title="nombre de la sección (marcador); vacío = el de su escena"
        maxLength={48}
      />
      <label className="daw-secbar-sc" title="escena que se dispara al entrar en esta sección (mezcla: mutes, volúmenes, filtros…)">
        escena
        <select value={st.scene} onChange={(e) => dawSection.scene(index, Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>{n}{scenes[n] ? ` · ${scenes[n].name}` : ' · (vacía)'}</option>
          ))}
        </select>
      </label>
      <span className="daw-secbar-bars" title="compases de la sección (cambia también el brazo de cada pista)">
        <button className="daw-btn" onClick={() => dawSection.resize(index, st.bars - 1)} disabled={st.bars <= 1} aria-label="un compás menos">−</button>
        <b>{st.bars}</b>
        <button className="daw-btn" onClick={() => dawSection.resize(index, st.bars + 1)} disabled={st.bars >= MAX_SECTION_BARS} aria-label="un compás más">+</button>
        <button className="daw-btn" onClick={() => dawSection.resize(index, st.bars * 2)} disabled={st.bars * 2 > MAX_SECTION_BARS} title="doble de compases">×2</button>
      </span>
      <button className="daw-btn" onClick={() => { if (dawSection.move(index, index - 1)) onSelect(index - 1); }} disabled={index === 0} title="mover a la izquierda (Alt+←)" aria-label="mover a la izquierda">←</button>
      <button className="daw-btn" onClick={() => { if (dawSection.move(index, index + 1)) onSelect(index + 1); }} disabled={index === last} title="mover a la derecha (Alt+→)" aria-label="mover a la derecha">→</button>
      <button className="daw-btn" onClick={() => { if (dawSection.duplicate(index)) onSelect(index + 1); }} title="duplicar la sección justo después (Ctrl+D)">⧉ duplicar</button>
      <button className="daw-btn" onClick={() => { if (dawSection.insertEmpty(index, 8)) onSelect(index + 1); }} title="añadir después una sección VACÍA de 8 compases (todo en silencio)">✚ vacía</button>
      <button className="daw-btn danger" onClick={() => { if (dawSection.remove(index)) onSelect(Math.max(0, index - 1)); }} disabled={steps.length < 2} title="borrar la sección en la canción y en todas las pistas (Supr) — Ctrl+Z la devuelve">✕ borrar</button>
      <button className="daw-btn" onClick={() => void playFrom(start)} title="tocar desde el inicio de esta sección">▶ desde aquí</button>
      <button className="daw-btn ghost" onClick={() => onSelect(-1)} title="cerrar (Esc)" aria-label="cerrar">×</button>
    </div>
  );
}
