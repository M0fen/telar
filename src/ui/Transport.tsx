import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { tapTempo } from '../lib/tapTempo';
import { timelinePos } from '../lib/songClock';
import { playFrom } from '../lib/songTransport';
import { heardCycle } from '../audio/engine';
import { fmtBarPos, fmtClock, parseBarPos } from '../lib/dawGrid';
import { useMetroStore } from '../store/useMetroStore';
import { COUNT_IN_OPTIONS } from '../lib/metronome';
import { ROOT_NAMES, keyLong, keyShort, suggestKey } from '../lib/songKey';
import type { WarpInfo } from '../lib/loopWarp';
import { Knob } from './Knob';

// Nombre de la nota (clave) para mostrar el "tono". 0 = C (sin transposición).
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const keyName = (t: number) => KEYS[(((t % 12) + 12) % 12)];

// TONALIDAD DEL TEMA (Fase 5.1): raíz + modo, sin tonalidad, la sugerida por los loops de Splice
// del proyecto y el tono (transposición) con su «volver a 0».
function KeyPicker({ onClose }: { onClose: () => void }) {
  const songKey = useGraphStore((s) => s.songKey);
  const setSongKey = useGraphStore((s) => s.setSongKey);
  const transpose = useGraphStore((s) => s.transpose);
  const setTranspose = useGraphStore((s) => s.setTranspose);
  const nodes = useGraphStore((s) => s.nodes);
  const files = useMemo(() => nodes.map((n) => (n.data.warp as WarpInfo | undefined)?.file).filter((f): f is string => !!f), [nodes]);
  const sug = useMemo(() => suggestKey(files), [files]);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const minor = songKey?.minor ?? true;
  const showSug = sug && (!songKey || sug.key.root !== songKey.root || sug.key.minor !== songKey.minor);
  return (
    <div className="key-pop" ref={ref}>
      <div className="key-pop-head">tonalidad del tema</div>
      <div className="key-roots">
        {ROOT_NAMES.map((r, i) => (
          <button key={r} className={songKey?.root === i ? 'on' : ''} onClick={() => setSongKey({ root: i, minor })}>{r}</button>
        ))}
      </div>
      <div className="key-modes">
        <button className={songKey && songKey.minor ? 'on' : ''} onClick={() => setSongKey({ root: songKey?.root ?? 9, minor: true })}>menor</button>
        <button className={songKey && !songKey.minor ? 'on' : ''} onClick={() => setSongKey({ root: songKey?.root ?? 0, minor: false })}>mayor</button>
        <button className={!songKey ? 'on' : ''} onClick={() => setSongKey(null)} title="sin tonalidad: la escala vuelve a C y los loops no se transponen">sin tonalidad</button>
      </div>
      {showSug && sug && (
        <button className="key-sug" onClick={() => setSongKey(sug.key)} title="la tonalidad que traen los loops de Splice del proyecto">
          usar {keyLong(sug.key)} · la de {sug.votes} loop{sug.votes === 1 ? '' : 's'}
        </button>
      )}
      {transpose !== 0 && (
        <div className="key-tr">
          tono {transpose > 0 ? '+' : ''}{transpose}{songKey ? <> → suena en <b>{keyLong(songKey, transpose)}</b></> : null}
          <button onClick={() => setTranspose(0)}>volver a 0</button>
        </div>
      )}
      <p className="key-hint">La usan los secuenciadores (escala), el autotune de la voz y el nombre de lo que exportas. Los − + de al lado transponen el tema.</p>
    </div>
  );
}

// CONTADOR DE POSICIÓN (Fase 8.2): «25.2.3» (compás.pulso.semicorchea) y «0:42.1» de lo que suena,
// el mismo reloj que la línea del DAW (ciclo del scheduler → compás de la canción). Un rAF escribe el
// texto directo en el DOM (no re-renderiza 60×/s). Parado muestra dónde arrancará ▶. Clic = escribir
// un compás («33», «33.3») y Enter = tocar desde ese compás.
function PositionCounter() {
  const playing = useGraphStore((s) => s.playing);
  const beats = useGraphStore((s) => s.beatsPerCycle) || 4;
  const cps = useGraphStore((s) => s.cps) || 0.5;
  const from = useSongStore((s) => s.from);
  const region = useSongStore((s) => s.region);
  const regionOn = useSongStore((s) => s.regionOn);
  const barRef = useRef<HTMLElement>(null);
  const timeRef = useRef<HTMLElement>(null);
  const [edit, setEdit] = useState<string | null>(null);
  useEffect(() => {
    if (edit !== null) return;
    const write = (pos: number) => {
      const a = fmtBarPos(pos, beats);
      const t = pos < 0 ? 'cuenta' : fmtClock(pos / cps);
      if (barRef.current && barRef.current.textContent !== a) barRef.current.textContent = a;
      if (timeRef.current && timeRef.current.textContent !== t) timeRef.current.textContent = t;
      barRef.current?.parentElement?.classList.toggle('counting', pos < 0); // cuenta previa (8.3)
    };
    // parado: dónde arrancará ▶ (el compás elegido o el inicio de la región en bucle)
    if (!playing) { write(timelinePos(0, { from, region, regionOn })); return; }
    let raf = 0;
    const tick = () => {
      write(timelinePos(heardCycle(), useSongStore.getState()));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, beats, cps, from, region, regionOn, edit]);
  const go = () => {
    const bar = edit === null ? null : parseBarPos(edit, beats);
    setEdit(null);
    if (bar !== null) void playFrom(Math.floor(bar));
  };
  if (edit !== null) {
    return (
      <span className="pos-counter editing">
        <input
          autoFocus
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); else if (e.key === 'Escape') setEdit(null); e.stopPropagation(); }}
          onBlur={() => setEdit(null)}
          aria-label="compás desde el que tocar"
          inputMode="decimal"
        />
        <i>Enter: tocar desde aquí</i>
      </span>
    );
  }
  return (
    <button
      className="pos-counter"
      onClick={() => setEdit(String(Math.floor(Number((barRef.current?.textContent ?? '1').split('.')[0]) || 1)))}
      title="posición: compás.pulso.semicorchea · minutos:segundos — clic: escribe un compás para tocar desde ahí"
    >
      <b ref={barRef}>1.1.1</b>
      <i ref={timeRef}>0:00.0</i>
    </button>
  );
}

// METRÓNOMO (Fase 8.3): ♩ enciende el clic (acento en el 1); ▾ elige la cuenta previa al grabar el
// jam o los pads (0, 1 o 2 compases) y el volumen. El clic no pasa por el máster ni se graba.
function MetroControl() {
  const on = useMetroStore((s) => s.on);
  const countIn = useMetroStore((s) => s.countIn);
  const level = useMetroStore((s) => s.level);
  const { setOn, setCountIn, setLevel } = useMetroStore.getState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="metro" ref={ref}>
      <button className={`metro-btn${on ? ' on' : ''}`} onClick={() => setOn(!on)} aria-pressed={on} title={on ? 'metrónomo encendido: clic en cada pulso (clic para apagarlo)' : 'metrónomo: clic en cada pulso, acento en el 1'}>
        ♩
      </button>
      <button className={`metro-more${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={`cuenta previa al grabar: ${countIn ? `${countIn} compás${countIn > 1 ? 'es' : ''}` : 'no'} · volumen del clic`}>
        {countIn ? countIn : '▾'}
      </button>
      {open && (
        <div className="metro-pop" role="dialog" aria-label="metrónomo">
          <div className="metro-pop-h">metrónomo</div>
          <div className="metro-row">
            <span>cuenta previa al grabar</span>
            <div className="metro-seg" role="group" aria-label="compases de cuenta previa">
              {COUNT_IN_OPTIONS.map((n) => (
                <button key={n} className={countIn === n ? 'on' : ''} onClick={() => setCountIn(n)} aria-pressed={countIn === n}>
                  {n === 0 ? 'no' : `${n} c.`}
                </button>
              ))}
            </div>
          </div>
          <div className="metro-row">
            <span>volumen del clic</span>
            <input type="range" min={0} max={1} step={0.05} value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="volumen del clic" />
          </div>
          <p className="metro-hint">La cuenta suena antes de grabar el jam o los pads con el transporte parado; lo que tocas en ella no entra en la toma. El clic sale directo a los altavoces: no se graba ni se exporta.</p>
        </div>
      )}
    </div>
  );
}

// Transporte: Play/Stop + posición + tempo (perilla + BPM editable + tap) + compás + tono. setcps
// controla la velocidad del scheduler. BPM = cps · 60 · tiempos_por_compás (1 ciclo = 1 compás).
// El compás del tema se ve como «4/4» (8.2): el pulso es la negra; cambiarlo conserva el BPM.
export function Transport() {
  const playing = useGraphStore((s) => s.playing);
  const initializing = useGraphStore((s) => s.initializing);
  const cps = useGraphStore((s) => s.cps);
  const beatsPerCycle = useGraphStore((s) => s.beatsPerCycle);
  const setBeatsPerCycle = useGraphStore((s) => s.setBeatsPerCycle);
  const transpose = useGraphStore((s) => s.transpose);
  const setTranspose = useGraphStore((s) => s.setTranspose);
  const songKey = useGraphStore((s) => s.songKey);
  const [keyOpen, setKeyOpen] = useState(false);
  const compileError = useGraphStore((s) => s.compileError);
  const runtimeError = useGraphStore((s) => s.runtimeError);
  const play = useGraphStore((s) => s.play);
  const stop = useGraphStore((s) => s.stop);
  const setCpsValue = useGraphStore((s) => s.setCpsValue);

  const error = compileError ?? runtimeError;
  const bpm = Math.round(cps * 60 * beatsPerCycle);
  const setBpm = (b: number) => setCpsValue(Math.max(40, Math.min(300, b)) / (60 * beatsPerCycle));

  return (
    <div className="transport">
      <button className={`play ${playing ? 'on' : ''}`} onClick={() => (playing ? stop() : play())}>
        {playing ? '■ stop' : '▶ play'}
      </button>
      <PositionCounter />
      <div className="tempo">
        <Knob
          value={bpm}
          min={40}
          max={300}
          step={1}
          size={40}
          defaultValue={120}
          hideValue
          label="tempo (bpm)"
          onChange={(v) => setBpm(v)}
        />
        <div className="tempo-read">
          <div className="tempo-bpm" title={`tempo · ${cps.toFixed(3)} ciclos por segundo (1 ciclo = 1 compás)`}>
            <input
              type="number"
              value={bpm}
              min={40}
              max={300}
              onChange={(e) => setBpm(Number(e.target.value))}
              aria-label="tempo en BPM"
            />
            <span>bpm</span>
          </div>
          <select
            className="tsig"
            value={beatsPerCycle}
            onChange={(e) => setBeatsPerCycle(Number(e.target.value))}
            title="compás del tema: tiempos por compás (el pulso es la negra). Cambiarlo conserva el BPM."
            aria-label="compás del tema"
          >
            {Array.from({ length: 15 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}/4</option>)}
          </select>
        </div>
        <button
          className="tap"
          title="tap tempo: pulsa al ritmo (tecla T)"
          onClick={() => {
            const c = tapTempo();
            if (c) setCpsValue(c);
          }}
        >
          tap
        </button>
        <MetroControl />
      </div>
      {/* Tonalidad + tono: con tonalidad (5.1) muestra la que SUENA (raíz + tono); − + transponen
          en semitonos (note(…)); clic en el centro = elegir la tonalidad o volver el tono a 0. */}
      <div className="tono-wrap">
        <div className="tono" title={`${songKey ? `tonalidad ${keyLong(songKey)} · ` : ''}tono: ${transpose >= 0 ? '+' : ''}${transpose} semitonos`}>
          <button className="tono-step" onClick={() => setTranspose(transpose - 1)} title="bajar semitono">−</button>
          <button className={`tono-key${songKey ? ' has-key' : ''}`} onClick={() => setKeyOpen(!keyOpen)} title="tonalidad del tema (clic = elegir)">
            {songKey ? keyShort(songKey, transpose) : keyName(transpose)}
            <span className="tono-semi">{transpose === 0 ? (songKey ? 'tonalidad' : 'tono') : `${transpose > 0 ? '+' : ''}${transpose}`}</span>
          </button>
          <button className="tono-step" onClick={() => setTranspose(transpose + 1)} title="subir semitono">+</button>
        </div>
        {keyOpen && <KeyPicker onClose={() => setKeyOpen(false)} />}
      </div>
      <div className={`status ${error ? 'err' : 'ok'}`} title={error ?? (initializing ? 'iniciando el audio' : playing ? 'sonando' : 'en pausa')}>
        {error ? `⚠ ${error}` : (
          <>
            {initializing ? '◌' : playing ? '●' : '○'}
            <span className="status-txt"> {initializing ? 'init audio…' : playing ? 'live' : 'idle'}</span>
          </>
        )}
      </div>
    </div>
  );
}
