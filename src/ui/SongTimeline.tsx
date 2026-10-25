import { useMemo, useState } from 'react';
import { useSongStore } from '../store/useSongStore';
import { useScenesStore } from '../store/useScenesStore';
import { useGraphStore } from '../store/useGraphStore';
import { useVizFlagsStore } from '../store/useVizFlagsStore';
import { alignArrangeToBars, splitArrange } from '../nodes/stepseqCode';
import { sectionEnergy } from '../lib/arrangeEnergy';
import { songTotal, arrangeMismatches } from '../lib/songClock';
import { playSong, stopSong } from '../lib/songTransport';
import { askConfirm, toast } from '../store/useNotifyStore';
import type { NodeData } from '../graph/types';

// Línea de tiempo / SONG MODE: arregla la canción como secciones (escena × compases)
// y la reproduce avanzando por ellas al ritmo del reloj. Vive en el panel de
// performance (colapsable). Cada bloque = una sección editable. El MOTOR que dispara las
// escenas es ui/SongEngine (montado en App) y ▶/■ vienen de lib/songTransport: así la
// canción sigue sonando igual desde la vista estándar, la DJ o la DAW.
export function SongTimeline() {
  const steps = useSongStore((s) => s.steps);
  const loop = useSongStore((s) => s.loop);
  const playing = useSongStore((s) => s.playing);
  const index = useSongStore((s) => s.index);
  const addStep = useSongStore((s) => s.addStep);
  const updateStep = useSongStore((s) => s.updateStep);
  const removeStep = useSongStore((s) => s.removeStep);
  const setLoop = useSongStore((s) => s.setLoop);
  const scenes = useScenesStore((s) => s.scenes);
  // V2 — mapa de energía: nº de sources del grafo (no filtrar EN el selector → zustand v5
  // cuelga si devuelve un array nuevo; derivamos aquí) y el flag para gatear el render.
  const nodes = useGraphStore((s) => s.nodes);
  const energyMap = useVizFlagsStore((s) => s.flags.energyMap);
  const sourceIds = useMemo(() => nodes.filter((n) => n.data.kind === 'source').map((n) => n.id), [nodes]);
  // instrumentos cuyo arrange no dura lo que la canción (se desfasan desde la 2.ª vuelta)
  const total = songTotal(steps);
  const mismatches = useMemo(
    () => arrangeMismatches(steps, nodes.filter((n) => n.data.kind === 'source').map((n) => ({ id: n.id, name: n.data.name, code: n.data.code }))),
    [steps, nodes],
  );
  const [open, setOpen] = useState(false);

  // P0.3 ampliado — la canción GENERA/EDITA las secciones (arrange) de los instrumentos:
  // alinea cada source a los compases de estas secciones. Plano → se envuelve sembrado
  // con su patrón (suena igual); mismo nº de secciones → se redimensionan los compases;
  // menos → se completan con silencios; más que la canción → no se toca (se avisa).
  const alignInstruments = async () => {
    const bars = steps.map((st) => Math.max(1, st.bars));
    if (!bars.length) { toast.info('añade secciones a la canción primero'); return; }
    const g = useGraphStore.getState();
    const updates: Record<string, Partial<NodeData>> = {};
    let skipped = 0;
    for (const n of g.nodes) {
      if (n.data.kind !== 'source' || !(n.data.code ?? '').trim()) continue;
      const next = alignArrangeToBars(n.data.code ?? '', bars);
      if (next === null) { if (splitArrange(n.data.code ?? '')) skipped++; continue; }
      if (next !== n.data.code) updates[n.id] = { code: next };
    }
    if (!Object.keys(updates).length) { toast.info(skipped ? 'los instrumentos tienen MÁS secciones que la canción: no se tocan' : 'los instrumentos ya están alineados'); return; }
    const ok = await askConfirm('alinear instrumentos a la canción', {
      message: `Se estructuran ${Object.keys(updates).length} instrumento(s) en ${bars.length} secciones (${bars.join(' · ')} compases). Los patrones se conservan: los planos suenan igual (cada sección arranca con su patrón) y las secciones nuevas quedan en silencio.`,
      confirmLabel: 'alinear',
    });
    if (!ok) return;
    g.applyNodeStates(updates);
    toast.ok(`instrumentos alineados a ${bars.length} secciones${skipped ? ` · ${skipped} con más secciones quedaron como estaban` : ''}`);
  };

  return (
    <div className={`song${open ? ' open' : ''}`}>
      <div className="song-head">
        <button className="song-toggle" onClick={() => setOpen((o) => !o)} title="línea de tiempo (song mode)">
          canción {open ? '▾' : '▸'}
        </button>
        {open && (
          <>
            <button className={`song-play${playing ? ' on' : ''}`} onClick={() => (playing ? stopSong() : void playSong())} title={playing ? 'detener la canción' : 'reproducir la canción (avanza por las secciones)'}>
              {playing ? '■ stop' : '▶ play'}
            </button>
            <button className={`song-loop${loop ? ' on' : ''}`} onClick={() => setLoop(!loop)} title="repetir la canción al terminar">⟳</button>
            <button className="song-add" onClick={addStep} title="añadir sección">+ sección</button>
            <button className="song-add" onClick={() => void alignInstruments()} title="alinear los INSTRUMENTOS a esta estructura: cada source queda arreglado (arrange) con estas secciones y compases — los planos suenan igual y luego editas cada sección en el secuenciador">⇋ instrumentos</button>
            {total > 0 && <span className="song-total" title="compases de la canción (1 compás = 1 ciclo)">{total} c.</span>}
            {mismatches.length > 0 && (
              <span className="song-warn" title={`no duran lo que la canción (${total} compases): ${mismatches.map((m) => `${m.name} ${m.bars}`).join(' · ')}. La primera vuelta cae junta; desde la segunda se desfasan. ⇋ instrumentos los alinea.`}>
                ⚠ {mismatches.length} no cuadra{mismatches.length > 1 ? 'n' : ''}
              </span>
            )}
          </>
        )}
      </div>
      {open && (
        <div className="song-track">
          {steps.length === 0 && <span className="song-empty">añade secciones y asigna a cada una una escena (captura escenas con ⇧+1–9). La canción salta entre ellas.</span>}
          {steps.map((st, i) => {
            const sc = scenes[st.scene];
            return (
              <div className={`song-step${i === index && playing ? ' active' : ''}`} key={st.id} style={{ flexGrow: Math.max(1, st.bars) }}>
                <div className="song-step-top">
                  <select value={st.scene} onChange={(e) => updateStep(st.id, { scene: Number(e.target.value) })} title="escena de esta sección">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}{scenes[n] ? '' : '·'}</option>)}
                  </select>
                  <button className="song-step-x" onClick={() => removeStep(st.id)} title="quitar sección">×</button>
                </div>
                <span className="song-step-name">{sc?.name ?? `escena ${st.scene}`}</span>
                <div className="song-step-bars">
                  <button onClick={() => updateStep(st.id, { bars: Math.max(1, st.bars - 1) })}>−</button>
                  <b>{st.bars}</b>
                  <button onClick={() => updateStep(st.id, { bars: Math.min(64, st.bars + 1) })}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* V2 — mapa de energía: una barra por sección, altura = pistas audibles en su
          escena. De un vistazo: intro con aire (bajo) vs drop saturado (lleno/warn). */}
      {open && energyMap && steps.length > 0 && (
        <div className="song-energy" title="mapa de energía del arreglo: cuántas pistas suenan en cada sección (aire ◄ ► saturación)">
          {steps.map((st) => {
            const e = sectionEnergy(scenes[st.scene], sourceIds);
            const lvl = e.frac >= 0.8 ? ' full' : e.frac >= 0.45 ? ' mid' : ' air';
            return (
              <div
                className="song-energy-seg"
                key={st.id}
                style={{ flexGrow: Math.max(1, st.bars) }}
                title={e.captured ? `${e.active}/${e.total} pistas activas · ${st.bars} compases` : `escena ${st.scene} sin capturar (⇧+${st.scene} para capturar)`}
              >
                {e.captured
                  ? <span className={`song-energy-fill${lvl}`} style={{ height: `${Math.max(3, Math.round(e.frac * 100))}%` }} />
                  : <span className="song-energy-none" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
