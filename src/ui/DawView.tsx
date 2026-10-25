import { useEffect, useMemo, useRef, useState } from 'react';
import './DawView.css';
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { useScenesStore } from '../store/useScenesStore';
import { buildDawModel, playheadAt, toggleBlockCode, type DawBlock, type DawTrack } from '../lib/dawModel';
import { playSong, playFrom } from '../lib/songTransport';
import { getScheduler } from '../audio/engine';

// VISTA DAW (Fase 1.1 vista + 1.2 línea de reproducción): la canción entera de un vistazo. Pistas en filas,
// compases en columnas, secciones arriba. Cada bloque ES un brazo del `arrange([n, patrón])`
// de esa pista (el código manda: buildDawModel lo reconstruye en cada cambio), así que lo
// que ves es lo que suena. Las pistas sin arrange suenan igual en todos los compases.

const ZOOM_KEY = 'telar.daw.zoom';
const ZOOM_MIN = 10;
const ZOOM_MAX = 96;
const ZOOM_DEF = 28; // px por compás

function readZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v >= ZOOM_MIN && v <= ZOOM_MAX ? v : ZOOM_DEF;
  } catch {
    return ZOOM_DEF;
  }
}

const STATE_TXT: Record<DawBlock['state'], string> = { on: 'suena', off: 'apagada (conserva su patrón)', empty: 'vacía' };

// ¿se puede encender/apagar con un clic? (Fase 1.3) — las pistas planas se parten en la Fase 2.
const clickable = (t: DawTrack, b: DawBlock) => !t.plain && b.arm >= 0 && (b.state !== 'empty' || t.seed >= 0);

function blockTitle(t: DawTrack, b: DawBlock): string {
  if (t.plain) return `${t.name} · sin secciones: suena igual en todos los compases\n${b.code.slice(0, 160)}`;
  const rep = b.ghost ? ` · repetición (su arrange dura ${t.bars} compases y vuelve a empezar)` : '';
  const act =
    b.state === 'on' ? 'clic: apagar esta sección (su patrón se conserva)'
    : b.state === 'off' ? 'clic: encender (vuelve tal cual)'
    : t.seed >= 0 ? `clic: entra con el patrón de la sección ${t.seed + 1}`
    : 'vacía y sin patrón en esta pista para sembrarla';
  const also = b.ghost && clickable(t, b) ? ' (cambia también sus repeticiones)' : '';
  return `${t.name} · sección ${b.arm + 1} · ${b.bars} compases · ${STATE_TXT[b.state]}${rep}\n${act}${also}\n${b.code.slice(0, 160)}`;
}

export function DawView() {
  const nodes = useGraphStore((s) => s.nodes);
  const update = useGraphStore((s) => s.updateNodeData);
  const stop = useGraphStore((s) => s.stop);
  const steps = useSongStore((s) => s.steps);
  const loop = useSongStore((s) => s.loop);
  const songPlaying = useSongStore((s) => s.playing);
  const setLoop = useSongStore((s) => s.setLoop);
  const scenes = useScenesStore((s) => s.scenes);
  const playing = useGraphStore((s) => s.playing);
  const [px, setPx] = useState<number>(readZoom);
  const [secNow, setSecNow] = useState(-1); // sección que suena (resaltada)
  const bodyRef = useRef<HTMLDivElement>(null);
  const phRulerRef = useRef<HTMLDivElement>(null);
  const phRowsRef = useRef<HTMLDivElement>(null);

  const zoom = (dir: 1 | -1) =>
    setPx((p) => {
      const v = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(p * (dir > 0 ? 1.25 : 0.8))));
      try { localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* sin almacenamiento: solo esta sesión */ }
      return v;
    });

  // Solo lo que cambia el modelo: id, nombre, código, mute y solo de cada pista (mover una
  // perilla de ganancia o un nodo en el lienzo no lo recalcula).
  const sources = nodes.filter((n) => n.data.kind === 'source');
  const srcSig = sources.map((n) => `${n.id}\u0000${n.data.name ?? ''}\u0000${n.data.code ?? ''}\u0000${n.data.mute ? 1 : 0}${n.data.solo ? 1 : 0}`).join('\u0001');
  const model = useMemo(
    () =>
      buildDawModel(
        sources.map((n) => ({ id: n.id, name: n.data.name, code: n.data.code, mute: n.data.mute, solo: n.data.solo })),
        steps,
        (sc) => scenes[sc]?.name ?? `escena ${sc}`,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [srcSig, steps, scenes],
  );

  const { sections, total, tracks, fromSong } = model;

  // ENCENDER / APAGAR (Fase 1.3): un empalme en el brazo vía updateNodeData → Ctrl+Z lo deshace.
  // Se lee el código del store en el momento del clic (no el del render) para no pisar un
  // cambio que haya llegado entre medias.
  const toggleBlock = (t: DawTrack, b: DawBlock) => {
    if (!clickable(t, b)) return;
    const code = useGraphStore.getState().nodes.find((n) => n.id === t.id)?.data.code ?? '';
    const next = toggleBlockCode(code, b.arm);
    if (next !== null && next !== code) update(t.id, { code: next });
  };

  // TOCAR DESDE UN COMPÁS (Fase 1.4): clic en los números = desde ese compás; clic en una
  // sección = desde su primer compás. Reinicia el transporte (como un DAW).
  const barAt = (e: { clientX: number; currentTarget: Element }) =>
    Math.max(0, Math.min(total - 1, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / px)));

  // LÍNEA DE REPRODUCCIÓN: rAF que lee el ciclo del scheduler y mueve DOS elementos (marca en la
  // regla + línea sobre las pistas) con `transform`, sin re-renderizar la rejilla 60×/s. Solo
  // la sección resaltada pasa por React, y solo cuando cambia. Si la línea sale de la vista,
  // el scroll salta para dejarla al 10 % del borde izquierdo (no pelea con tu scroll mientras
  // la tengas a la vista).
  useEffect(() => {
    const marks = [phRulerRef.current, phRowsRef.current];
    if (!playing) {
      for (const m of marks) if (m) m.style.display = 'none';
      setSecNow(-1);
      return;
    }
    for (const m of marks) if (m) m.style.display = '';
    let raf = 0;
    let lastSec = -2;
    const tick = () => {
      // + from: tras «tocar desde aquí» el reloj arrancó en 0 pero suena el compás from + 1
      const { pos, section } = playheadAt(Number(getScheduler()?.now?.() ?? 0) + useSongStore.getState().from, total, sections);
      const x = pos * px;
      const t = `translateX(${x}px)`;
      for (const m of marks) if (m) m.style.transform = t;
      if (section !== lastSec) { lastSec = section; setSecNow(section); }
      const body = bodyRef.current;
      if (body) {
        const nameW = parseFloat(getComputedStyle(body).getPropertyValue('--daw-name-w')) || 168;
        const vis = body.clientWidth - nameW;
        if (vis > 40 && (x < body.scrollLeft || x > body.scrollLeft + vis * 0.92)) body.scrollLeft = Math.max(0, x - vis * 0.1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, px, sections]);
  const width = total * px;
  const mism = tracks.filter((t) => t.mismatch);
  const every = px >= 22 ? 1 : px >= 12 ? 4 : 8; // números de compás legibles con poco zoom
  const gridBg = {
    backgroundImage: 'linear-gradient(to right, var(--line-soft, #161f28) 1px, transparent 1px), linear-gradient(to right, var(--line, #202c38) 1px, transparent 1px)',
    backgroundSize: `${px}px 100%, ${px * 4}px 100%`,
  };

  return (
    <div className="daw">
      <div className="daw-head">
        {steps.length > 0 ? (
          songPlaying ? (
            <button className="daw-btn on" onClick={() => void stop()} title="detener la canción y el transporte">■ canción</button>
          ) : (
            <button className="daw-btn" onClick={() => void playSong()} title="reproducir la canción desde el compás 1 (escenas e instrumentos juntos)">▶ canción</button>
          )
        ) : null}
        {steps.length > 0 && (
          <button className={`daw-btn${loop ? ' on' : ''}`} onClick={() => setLoop(!loop)} title="repetir la canción al terminar">⟳</button>
        )}
        <span className="daw-info">
          {total} compases
          {fromSong ? ' · secciones de la canción' : sections.length ? ' · sin canción: secciones del primer arrange' : ''}
        </span>
        {mism.length > 0 && (
          <span
            className="daw-warn"
            title={`no duran lo que la línea de tiempo (${total} compases): ${mism.map((t) => `${t.name} ${t.bars}`).join(' · ')}. Sus bloques se repiten desfasados (los ves en la fila). ⇋ instrumentos, en la canción, los alinea.`}
          >
            ⚠ {mism.length} no cuadra{mism.length > 1 ? 'n' : ''}
          </span>
        )}
        <span className="daw-zoom">
          <button className="daw-btn" onClick={() => zoom(-1)} disabled={px <= ZOOM_MIN} title="alejar">−</button>
          <button className="daw-btn" onClick={() => zoom(1)} disabled={px >= ZOOM_MAX} title="acercar">+</button>
        </span>
      </div>

      {tracks.length === 0 ? (
        <div className="daw-empty">No hay pistas. Crea sources en la vista standard o carga un ejemplo desde «proyecto».</div>
      ) : (
        <div className="daw-body" ref={bodyRef}>
          <div className="daw-grid" style={{ width: `calc(var(--daw-name-w) + ${width}px)` }}>
            <div className="daw-ruler">
              <div className="daw-corner">{sections.length === 0 ? 'sin secciones' : 'secciones'}</div>
              <div className="daw-ruler-lane" style={{ width }}>
                <div className="daw-ph-mark" ref={phRulerRef} style={{ display: 'none' }} />
                <div
                  className="daw-bars"
                  style={gridBg}
                  onClick={(e) => void playFrom(barAt(e))}
                  title="clic: tocar desde este compás (reinicia el transporte; ■ vuelve al compás 1)"
                >
                  {Array.from({ length: total }, (_, i) =>
                    i % every === 0 ? (
                      <span key={i} className="daw-barn" style={{ left: i * px }}>{i + 1}</span>
                    ) : null,
                  )}
                </div>
                <div className="daw-secs">
                  {sections.map((s, i) => (
                    <div
                      key={i}
                      className={`daw-sec${i % 2 ? ' alt' : ''}${i === secNow ? ' now' : ''}`}
                      style={{ left: s.start * px, width: Math.max(2, s.bars * px - 1) }}
                      title={`${s.label} · compases ${s.start + 1}–${s.start + s.bars} (${s.bars})\nclic: tocar desde el inicio de esta sección`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void playFrom(s.start)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void playFrom(s.start); } }}
                    >
                      {s.bars * px >= 36 && <span>{s.label}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="daw-rows">
            <div className="daw-ph" ref={phRowsRef} style={{ display: 'none' }} />
            {tracks.map((t) => (
              <div className={`daw-row${t.audible ? '' : ' muted'}`} key={t.id}>
                <div className="daw-tname">
                  <span className="daw-tn" title={t.name}>{t.name}</span>
                  {t.mismatch && <span className="daw-tw" title={`su arrange dura ${t.bars} compases (la línea de tiempo ${total})`}>⚠{t.bars}</span>}
                  <button className={`daw-ms${t.mute ? ' on mute' : ''}`} onClick={() => update(t.id, { mute: !t.mute })} title="mute de la pista">M</button>
                  <button className={`daw-ms${t.solo ? ' on solo' : ''}`} onClick={() => update(t.id, { solo: !t.solo })} title="solo de la pista">S</button>
                </div>
                <div className="daw-lane" style={{ width, ...gridBg }}>
                  {t.blocks.map((b, i) => (
                    <div
                      key={i}
                      className={`daw-blk ${b.state}${b.ghost ? ' ghost' : ''}${t.plain ? ' plain' : ''}${clickable(t, b) ? ' click' : ''}`}
                      style={{ left: b.start * px, width: Math.max(2, b.bars * px - 2) }}
                      title={blockTitle(t, b)}
                      {...(clickable(t, b)
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            'aria-pressed': b.state === 'on',
                            onClick: () => toggleBlock(t, b),
                            onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBlock(t, b); }
                            },
                          }
                        : {})}
                    >
                      {b.bars * px >= 30 && (
                        <span className="daw-blk-l">{t.plain ? 'suena siempre' : b.state === 'empty' ? 'vacía' : b.state === 'off' ? 'apagada' : `${b.arm + 1}`}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            </div>
          </div>
          {sections.length === 0 && (
            <div className="daw-hint">Sin secciones: los instrumentos suenan en bucle. Crea la canción en la vista standard (máster › canción) y usa «⇋ instrumentos».</div>
          )}
        </div>
      )}
    </div>
  );
}
