import { useMemo } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useLaunchStore } from '../store/useLaunchStore';
import { useSongStore } from '../store/useSongStore';
import { useTrackColorStore } from '../store/useTrackColorStore';
import { trackVariations } from '../lib/launchTake';
import { launch, stopAllClips, backToArrangement, toggleTakeRec } from '../lib/launcher';
import { splitArrange } from '../nodes/stepseqCode';

// LANZADOR DE CLIPS (Fase 12.5): pistas × variaciones. Cada pista tiene en columna sus patrones
// distintos (los de su arreglo); tocar uno lo lanza en el 1 del próximo compás y queda sonando en
// bucle. «▶ fila» lanza la misma variación en todas. ■ para la pista; ↩ la devuelve a su arreglo.
// «● grabar la toma»: lo que lanzas queda en el arreglo al parar.
const MAX_ROWS = 8;

export function Launcher() {
  const nodes = useGraphStore((s) => s.nodes);
  const playing = useGraphStore((s) => s.playing);
  const colors = useTrackColorStore((s) => s.map);
  const launched = useLaunchStore((s) => s.launch);
  const queued = useLaunchStore((s) => s.queued);
  const rec = useLaunchStore((s) => s.rec);
  const recStart = useLaunchStore((s) => s.recStart);
  const steps = useSongStore((s) => s.steps);
  const tracks = nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions));
  const sig = tracks.map((t) => `${t.id}\u0000${t.data.code ?? ''}`).join('\u0001');
  const vars = useMemo(() => Object.fromEntries(tracks.map((t) => [t.id, trackVariations(t.data.code ?? '').slice(0, MAX_ROWS)])), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = Math.max(1, ...Object.values(vars).map((v) => v.length));
  // nombre de la sección donde aparece cada variación (de la canción, si los brazos la siguen)
  const secName = (arm: number) => steps[arm]?.name || (steps[arm] ? `sec. ${arm + 1}` : `${arm + 1}`);
  const anyLaunched = Object.keys(launched).length > 0 || Object.keys(queued).length > 0;
  const launchRow = (r: number) => {
    const ch: Record<string, string | null> = {};
    for (const t of tracks) { const v = vars[t.id]?.[r]; ch[t.id] = v ? v.code : 'silence'; }
    launch(ch);
  };
  return (
    <div className="lch">
      <div className="lch-bar">
        <button className={`daw-btn rec${rec ? ' on' : ''}`} onClick={toggleTakeRec} title="grabar la toma: lo que lances desde el próximo compás queda en el arreglo al parar">
          ● {rec ? `grabando desde ${recStart + 1} · parar` : 'grabar la toma'}
        </button>
        <button className="daw-btn" onClick={stopAllClips} title="parar todas las pistas (en el próximo compás)">■ parar clips</button>
        <button className="daw-btn" disabled={!anyLaunched} onClick={backToArrangement} title="todas las pistas vuelven a su arreglo (en el próximo compás)">↩ todo al arreglo</button>
        <span className="lch-info">{playing ? 'los clips entran en el 1 del próximo compás' : 'lanzar un clip arranca el tema'} · una pista sin lanzar sigue su arreglo</span>
      </div>
      <div className="lch-grid" style={{ gridTemplateColumns: `86px repeat(${tracks.length}, minmax(96px, 1fr))` }}>
        <div className="lch-corner">variación</div>
        {tracks.map((t) => {
          const following = launched[t.id] == null;
          return (
            <div key={t.id} className="lch-head" style={{ ['--tc' as string]: colors[t.id] ?? '#3df0d0' }}>
              <span className="lch-name" title={t.data.name ?? t.id}>{t.data.name || t.id}</span>
              <span className={`lch-mode${following ? '' : ' live'}`}>{following ? 'arreglo' : launched[t.id] === 'silence' ? 'parada' : 'clip'}</span>
            </div>
          );
        })}
        {Array.from({ length: rows }, (_, r) => (
          <div key={`r${r}`} className="lch-row" style={{ display: 'contents' }}>
            <button className="lch-scene" onClick={() => launchRow(r)} title={`lanzar la variación ${r + 1} en todas las pistas (las que no la tienen, se paran)`}>▶ fila {r + 1}</button>
            {tracks.map((t) => {
              const v = vars[t.id]?.[r];
              const isOn = !!v && launched[t.id] === v.code;
              const isQ = !!v && queued[t.id] === v.code;
              const armsAligned = !!splitArrange(t.data.code ?? '');
              return (
                <button key={t.id} className={`lch-cell${v ? '' : ' empty'}${isOn ? ' on' : ''}${isQ ? ' q' : ''}`} style={{ ['--tc' as string]: colors[t.id] ?? '#3df0d0' }}
                  disabled={!v} onClick={() => v && launch({ [t.id]: v.code })}
                  title={v ? `${isOn ? 'sonando en bucle' : isQ ? 'entra en el próximo compás' : 'lanzar'}${armsAligned && v.arms.length ? ` · está en: ${v.arms.map(secName).join(', ')}` : ''}\n${v.code.slice(0, 160)}` : ''}>
                  {v && <><span className="lch-tri">{isOn ? '■' : '▶'}</span><span className="lch-lab">{armsAligned && v.arms.length ? v.arms.slice(0, 3).map(secName).join(' · ') : 'patrón'}</span></>}
                </button>
              );
            })}
          </div>
        ))}
        <div className="lch-corner" />
        {tracks.map((t) => (
          <div key={t.id} className="lch-foot">
            <button onClick={() => launch({ [t.id]: 'silence' })} title="parar esta pista (próximo compás)">■</button>
            <button disabled={launched[t.id] == null && queued[t.id] === undefined} onClick={() => launch({ [t.id]: null })} title="volver a su arreglo (próximo compás)">↩</button>
          </div>
        ))}
      </div>
    </div>
  );
}
