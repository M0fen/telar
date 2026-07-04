import { useScenesStore } from '../store/useScenesStore';

// Lanzador de escenas (Fase A). 9 ranuras = teclas 1–9. Clic en una llena la
// dispara; clic en una vacía captura el estado actual; Mayús+clic (o ✎) recaptura;
// × la borra. El estado "tocable" (mute/solo/gain/filtro/params) salta al instante.
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function Scenes() {
  const scenes = useScenesStore((s) => s.scenes);
  const active = useScenesStore((s) => s.active);
  const capture = useScenesStore((s) => s.capture);
  const trigger = useScenesStore((s) => s.trigger);
  const clear = useScenesStore((s) => s.clear);

  return (
    <div className="scenes">
      <div className="scenes-head">
        <span>escenas</span>
        <span className="scenes-hint">teclas 1–9 · ⇧ captura</span>
      </div>
      <div className="scenes-grid">
        {SLOTS.map((slot) => {
          const sc = scenes[slot];
          const isActive = active === slot;
          return (
            <div
              key={slot}
              className={`scene-slot${sc ? ' filled' : ' empty'}${isActive ? ' on' : ''}`}
              title={
                sc
                  ? `${sc.name} — clic: disparar · ⇧clic: recapturar`
                  : 'vacía — clic: capturar el estado actual'
              }
              onClick={(e) => {
                if (!sc || e.shiftKey) capture(slot);
                else trigger(slot);
              }}
            >
              <span className="scene-num">{slot}</span>
              <span className="scene-name">{sc ? sc.name : '+'}</span>
              {sc && (
                <button
                  className="scene-x"
                  title="borrar escena"
                  onClick={(e) => {
                    e.stopPropagation();
                    clear(slot);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
