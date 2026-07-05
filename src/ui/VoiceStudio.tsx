import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useDownloadsStore } from '../store/useDownloadsStore';
import { getAudioCtx, registerSample } from '../audio/engine';
import type { NodeData, VoiceParams } from '../graph/types';
import { VOICE_VOWELS, VOICE_SCALES, DEFAULT_VOICE } from '../graph/types';
import { MiniSlider } from '../nodes/MiniSlider';
import { getVoiceUrl } from '../lib/voiceUrls';
import { playVoiceSample, playVoiceNote } from '../audio/playNote';

// Estudio de voz DEDICADO (área propia, sustituye al mini-panel del nodo). Pro:
//   • vista previa REPRODUCIBLE de la onda con cabezal (play/loop, clic = scrub),
//     recorte por manijas (begin/end en vivo) para editar el audio de un vistazo;
//   • PIANO ROLL para acomodar las notas de melodía/autotune (clic = poner nota,
//     arrastrar = dibujar la línea; con escala = autotune por grados);
//   • modos natural/granular, formante y controles finos.
// Edita node.data.voice / begin / end del Source seleccionado.

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// extrae la región [b,e] (fracciones 0..1) de un AudioBuffer como buffer nuevo, para
// warpear solo lo recortado (más rápido y coincide con lo que se oye). HILO B / B1.
function sliceBuffer(buf: AudioBuffer, b: number, e: number): AudioBuffer {
  const n = buf.length;
  const s = Math.max(0, Math.min(n - 1, Math.floor(clamp01(b) * n)));
  const en = Math.max(s + 1, Math.min(n, Math.floor(clamp01(e) * n)));
  const out = new AudioBuffer({ length: en - s, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(s, en));
  return out;
}

// --- notas <-> midi (notación con bemoles, como el placeholder y Strudel) ------
const PC_FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const ACCIDENTAL = new Set([1, 3, 6, 8, 10]); // teclas negras
const NAME_TO_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function midiToName(m: number): string {
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  return PC_FLAT[pc] + oct;
}
function noteToMidi(tok: string): number | null {
  const m = /^([a-gA-G])([#sb]?)(-?\d+)?$/.exec(tok.trim());
  if (!m) return null;
  let semi = NAME_TO_SEMI[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === 's') semi += 1;
  else if (m[2] === 'b') semi -= 1;
  const oct = m[3] != null ? parseInt(m[3], 10) : 4;
  return semi + (oct + 1) * 12;
}

// intervalos (semitonos) de cada escala del autotune — raíz C
const SCALE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};
function scaleName(scale: string): string {
  const i = scale.indexOf(':');
  return (i >= 0 ? scale.slice(i + 1) : scale).trim();
}

// pitch natural de un sample sin metadatos = midi 36 ("c2") → transpose 0 en
// superdough. El piano roll se ancla ahí para que la voz suene (no octavas arriba).
const NATURAL_MIDI = 36;
// `note` = nombre de nota que se pasa al motor para audicionar/afinar ese pitch
// (transpone el sample: transpose = midi(note) − 36). Coherente con el compilador.
interface Row { val: string; label: string; sub: string; acc: boolean; root: boolean; nat: boolean; note: string }

// Piano roll monofónico: cada columna = un paso (nota o silencio). En modo escala
// las filas son GRADOS (autotune); sin escala son notas cromáticas (2 octavas).
// `audition(note, force)` suena la voz PROCESADA a ese pitch (idéntica al resultado):
// al poner/dibujar una nota (si `live`) y SIEMPRE al pulsar la tecla (force) para probar.
function MelodyRoll({ melody, scale, onMelody, onScale, audition }: {
  melody: string; scale: string; onMelody: (m: string) => void; onScale: (s: string) => void; audition: (note: string, force?: boolean) => void;
}) {
  const tokens = useMemo(() => (melody.trim() ? melody.trim().split(/\s+/) : []), [melody]);
  const [steps, setSteps] = useState(() => Math.max(1, Math.min(16, tokens.length || 8)));
  const [oct, setOct] = useState(2); // octava base (modo cromático) — c2 = pitch natural
  const drawing = useRef(false);
  const scaleMode = !!scale.trim();

  // crecer los pasos si la melodía cargada trae más notas (no ocultarlas)
  useEffect(() => { setSteps((s) => Math.max(s, Math.min(16, tokens.length))); }, [tokens.length]);
  useEffect(() => {
    const up = () => { drawing.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // celdas efectivas: la melodía recortada/rellenada a `steps` (silencios = '~')
  const cells = useMemo(() => {
    const arr = tokens.slice(0, steps);
    while (arr.length < steps) arr.push('~');
    return arr;
  }, [tokens, steps]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (scaleMode) {
      const st = SCALE_STEPS[scaleName(scale)] ?? SCALE_STEPS.minor;
      const len = st.length;
      for (let d = len * 2; d >= 0; d--) {
        const pc = st[d % len];
        const semi = st[d % len] + 12 * Math.floor(d / len); // semitonos sobre la raíz (c2)
        out.push({
          val: String(d), label: String(d),
          sub: PC_FLAT[pc] + "'".repeat(Math.floor(d / len)),
          acc: ACCIDENTAL.has(pc), root: d % len === 0, nat: d === 0, // grado 0 = pitch natural
          note: midiToName(NATURAL_MIDI + semi),
        });
      }
    } else {
      const lo = (oct + 1) * 12; // c(oct)
      for (let m = lo + 23; m >= lo; m--) {
        const pc = ((m % 12) + 12) % 12;
        out.push({ val: midiToName(m), label: midiToName(m), sub: '', acc: ACCIDENTAL.has(pc), root: pc === 0, nat: m === NATURAL_MIDI, note: midiToName(m) });
      }
    }
    return out;
  }, [scaleMode, scale, oct]);

  const matches = (cell: string, row: Row) => {
    if (cell === '~') return false;
    if (scaleMode) return parseInt(cell, 10) === parseInt(row.val, 10);
    const a = noteToMidi(cell), b = noteToMidi(row.val);
    return a != null && a === b;
  };
  const commit = (next: string[]) => onMelody(next.every((c) => c === '~') ? '' : next.join(' '));
  const lastDrawn = useRef<string | null>(null); // evita re-audicionar la misma fila al arrastrar
  const toggle = (col: number, row: Row) => {
    const next = cells.slice();
    const on = matches(next[col], row);
    next[col] = on ? '~' : row.val;
    if (!on) { audition(row.note); lastDrawn.current = row.val; } // audición al poner la nota (si live)
    commit(next);
  };
  const setActive = (col: number, row: Row) => {
    const next = cells.slice();
    next[col] = row.val;
    if (lastDrawn.current !== row.val) { audition(row.note); lastDrawn.current = row.val; } // audición al cambiar de fila dibujando
    commit(next);
  };

  return (
    <div className="vs-roll">
      <div className="vs-roll-ctl">
        <select className="vs-scale" value={scale} onChange={(e) => onScale(e.target.value)} title="autotune: cuantiza a la escala (raíz C)">
          <option value="">cromático</option>
          {VOICE_SCALES.map((s) => <option key={s} value={s}>{s.replace('C:', '')}</option>)}
        </select>
        <div className="vs-stepper" title="nº de pasos">
          <button onClick={() => { const n = Math.max(1, steps - 1); setSteps(n); commit(cells.slice(0, n)); }}>−</button>
          <b>{steps}<i>pasos</i></b>
          <button onClick={() => setSteps((s) => Math.min(16, s + 1))}>+</button>
        </div>
        {!scaleMode && (
          <div className="vs-stepper" title="octava base">
            <button onClick={() => setOct((o) => Math.max(1, o - 1))}>−</button>
            <b>C{oct}<i>8va</i></b>
            <button onClick={() => setOct((o) => Math.min(7, o + 1))}>+</button>
          </div>
        )}
        <button className="vs-roll-clear" onClick={() => onMelody('')} title="borrar la melodía (voz a su pitch real)">limpiar</button>
      </div>

      <div className="vs-roll-grid">
        {rows.map((row) => (
          <div className={`vs-roll-row${row.root ? ' root' : ''}${row.acc ? ' acc' : ''}${row.nat ? ' nat' : ''}`} key={row.val}>
            <button
              className="vs-roll-lbl"
              onClick={() => audition(row.note, true)}
              title={`probar ${row.label}${row.sub ? ' (' + row.sub + ')' : ''} — suena con los efectos actuales`}
            ><b>{row.label}</b>{row.nat ? <i className="natmark">nat</i> : row.sub && <i>{row.sub}</i>}<span className="vs-key-spk">♪</span></button>
            <div className="vs-roll-cells" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
              {cells.map((c, col) => (
                <button
                  key={col}
                  className={`vs-cell${matches(c, row) ? ' on' : ''}${col % 4 === 0 ? ' beat' : ''}`}
                  onPointerDown={() => { drawing.current = true; lastDrawn.current = null; toggle(col, row); }}
                  onPointerEnter={() => { if (drawing.current) setActive(col, row); }}
                  title={`paso ${col + 1} · ${row.label}${row.sub ? ' (' + row.sub + ')' : ''}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="vs-roll-steps" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
        {cells.map((c, col) => <span key={col} className={c === '~' ? 'rest' : ''}>{c === '~' ? '·' : c}</span>)}
      </div>

      <details className="vs-adv">
        <summary>texto (avanzado)</summary>
        <input
          className="vs-melin"
          value={melody}
          placeholder={scaleMode ? 'grados: 0 2 4 3' : 'notas: c4 eb4 g4  (~ = silencio)'}
          onChange={(e) => onMelody(e.target.value)}
        />
      </details>
    </div>
  );
}

export function VoiceStudio() {
  const voiceEditId = useGraphStore((s) => s.voiceEditId);
  const setVoiceEdit = useGraphStore((s) => s.setVoiceEdit);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === s.voiceEditId));
  const update = useGraphStore((s) => s.updateNodeData);
  const tracks = useDownloadsStore((s) => s.tracks);

  const code = (node?.data as NodeData | undefined)?.code ?? '';
  const name = useMemo(() => {
    const m = /s\(\s*["'`]([^"'`]+)/.exec(code);
    if (!m) return null;
    const tok = /[A-Za-z0-9_]+/.exec(m[1]);
    return tok ? tok[0] : null;
  }, [code]);
  // URL del audio de la voz: registro propio (voiceUrls, funciona en prod para voz IA
  // y demo) con fallback a downloadsStore (grabaciones dev/servidor). De aquí sale la
  // ONDA y el preview — ya NO dependemos de que la voz esté en downloadsStore.
  const audioUrl = useMemo(
    () => getVoiceUrl(name) ?? tracks.find((t) => t.name === name)?.file ?? null,
    [tracks, name],
  );

  const [peaks, setPeaks] = useState<number[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // preview reproducible
  const bufRef = useRef<AudioBuffer | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef(0);
  const loopRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loopPrev, setLoopPrev] = useState(false);
  const [head, setHead] = useState<number | null>(null); // cabezal (fracción 0..1)
  const [live, setLive] = useState(true); // audición en vivo: oye cada ajuste al instante
  const auditionTimer = useRef(0);
  useEffect(() => () => clearTimeout(auditionTimer.current), []);
  // B1 — warp Rubber Band (offline): reproductor + estado + diagnóstico + semitonos propios
  const warpSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const [warpBusy, setWarpBusy] = useState(false);
  const [warpMsg, setWarpMsg] = useState('');
  const [warpSemi, setWarpSemi] = useState(5); // control de afinado propio del warp (autónomo)

  // decodifica el audio → ~360 picos para el trazo + guarda el buffer para el preview
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    bufRef.current = null;
    if (!audioUrl) return;
    (async () => {
      try {
        const ab = await (await fetch(audioUrl)).arrayBuffer();
        const buf = await getAudioCtx().decodeAudioData(ab);
        if (!alive) return;
        bufRef.current = buf;
        const dch = buf.getChannelData(0);
        const N = 360;
        const step = Math.max(1, Math.floor(dch.length / N));
        const p: number[] = [];
        for (let i = 0; i < N; i++) {
          let mx = 0;
          for (let j = 0; j < step; j++) {
            const a = Math.abs(dch[i * step + j] || 0);
            if (a > mx) mx = a;
          }
          p.push(mx);
        }
        if (alive) { setPeaks(p); setHead(bufRef.current ? (node?.data.begin ?? 0) : null); }
      } catch {
        if (alive) setPeaks(null);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // asegura que la voz esté registrada como sample del motor (s(name)) para que la
  // audición CON FX (piano roll / escucha viva) suene aunque no se haya reproducido el
  // grafo. Idempotente. Sin esto, una voz recién descargada tenía onda pero no audición.
  useEffect(() => {
    if (name && audioUrl) void registerSample(name, audioUrl).catch(() => {});
  }, [name, audioUrl]);

  const stopPreview = () => {
    if (srcRef.current) { try { srcRef.current.onended = null; srcRef.current.stop(); } catch { /* ya parado */ } srcRef.current = null; }
    if (warpSrcRef.current) { try { warpSrcRef.current.stop(); } catch { /* ya parado */ } warpSrcRef.current = null; }
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  };
  // B1 — precarga el WASM de Rubber Band al haber audio, para que el 1er warp no espere.
  useEffect(() => {
    if (audioUrl) void import('../audio/rubberband').then((m) => m.preloadRubberband()).catch(() => {});
  }, [audioUrl]);
  // detener el preview al cerrar / cambiar de voz
  useEffect(() => stopPreview, [voiceEditId]);
  useEffect(() => { loopRef.current = loopPrev; }, [loopPrev]);

  const playPreview = (from?: number) => {
    const buf = bufRef.current;
    if (!buf) return;
    stopPreview();
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    // valores en vivo del nodo (recorte/velocidad/gain pueden haber cambiado)
    const d = useGraphStore.getState().nodes.find((n) => n.id === voiceEditId)?.data as NodeData | undefined;
    const b = clamp01(d?.begin ?? 0);
    const e = Math.max(b + 0.01, clamp01(d?.end ?? 1));
    const speed = Number(d?.voice?.speed ?? 1) || 1;
    const gain = Number(d?.voice?.gain ?? 1);
    const dur = buf.duration;
    const start = Math.min(Math.max(from ?? b, b), e);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ctx.destination);
    const offsetSec = start * dur;
    const playSec = Math.max(0.02, e * dur - offsetSec);
    try { src.start(0, offsetSec, playSec); } catch { return; }
    srcRef.current = src;
    setPlaying(true);
    const t0 = ctx.currentTime;
    const tick = () => {
      const frac = start + ((ctx.currentTime - t0) * speed) / dur;
      if (frac >= e) {
        if (loopRef.current) { playPreview(b); return; }
        setHead(e); stopPreview(); return;
      }
      setHead(frac);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  if (!voiceEditId || !node) return null;
  const data = node.data as NodeData;
  const v: VoiceParams = { ...DEFAULT_VOICE, ...(data.voice ?? {}) };
  const melodic = !!(v.melody ?? '').trim();
  const b = data.begin ?? 0;
  const e = data.end ?? 1;
  // set con AUDICIÓN EN VIVO: al cambiar un control, oyes el resultado procesado (con
  // sus FX) al instante — un fragmento corto desde el recorte, sin esperar el ciclo. Es
  // lo que hace que editar la voz se sienta orgánico. Debounce para no solapar al arrastrar.
  const set = (patch: Partial<VoiceParams>) => {
    const nv: VoiceParams = { ...v, ...patch };
    update(voiceEditId, { voice: nv });
    // La audición (playVoiceSample) es un DISPARO ESTÁTICO del recorte con FX: refleja
    // afinar/room/delay/shape/vowel/pulir/vibrato/speed/gain. NO puede reflejar cosas
    // que dependen del patrón/tiempo o de varias notas → para esas NO re-disparamos una
    // preview idéntica (confundía: "se repite sin cambio"). Se oyen al reproducir el grafo.
    const noPreview = ['melody', 'scale', 'harmony', 'glide', 'spread', 'granular', 'grain', 'tempo', 'tempoCycles', 'loop']
      .some((k) => k in patch);
    if (live && name && !noPreview) {
      clearTimeout(auditionTimer.current);
      auditionTimer.current = window.setTimeout(() => {
        const dur = bufRef.current?.duration ?? 3;
        const endSnip = Math.min(e, b + Math.max(0.3, 1.9 / dur)); // ~1.9s audibles
        void playVoiceSample(name, nv, b, endSnip, 2.2);
      }, 220);
    }
  };

  const dragHandle = (which: 'b' | 'e') => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = wrapRef.current!.getBoundingClientRect();
    const move = (m: PointerEvent) => {
      const f = clamp01((m.clientX - rect.left) / rect.width);
      if (which === 'b') update(voiceEditId, { begin: Math.min(f, (data.end ?? 1) - 0.02) });
      else update(voiceEditId, { end: Math.max(f, (data.begin ?? 0) + 0.02) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // audición del piano roll: suena la voz PROCESADA (con sus FX) a una nota concreta,
  // por el MISMO motor que produce el resultado final → el preview es idéntico a lo que
  // se oirá. `force` = pulsar la tecla (siempre suena, para probar); sin force respeta
  // el toggle «escucha viva». Fragmento corto desde el recorte para respuesta inmediata.
  const audition = (note: string, force = false) => {
    if (!name || (!force && !live)) return;
    const d = useGraphStore.getState().nodes.find((n) => n.id === voiceEditId)?.data as NodeData | undefined;
    const vv: VoiceParams = { ...DEFAULT_VOICE, ...(d?.voice ?? {}) };
    const bb = clamp01(d?.begin ?? 0);
    const dur = bufRef.current?.duration ?? 3;
    const ee = Math.min(Math.max(bb + 0.02, clamp01(d?.end ?? 1)), bb + Math.max(0.35, 1.6 / dur));
    void playVoiceNote(name, vv, note, bb, ee, 1.5);
  };
  // clic sobre la onda (no en una manija) = mover el cabezal (scrub)
  const scrub = (ev: React.PointerEvent) => {
    if (!bufRef.current) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    setHead(clamp01((ev.clientX - rect.left) / rect.width));
  };
  // reproduce un AudioBuffer arbitrario (el resultado del warp) directo a la salida.
  const playAudioBuffer = (buf: AudioBuffer) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    if (warpSrcRef.current) { try { warpSrcRef.current.stop(); } catch { /* ya parado */ } }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Number(v.gain ?? 1);
    src.connect(g).connect(ctx.destination);
    try { src.start(); } catch { /* noop */ }
    warpSrcRef.current = src;
  };
  // B1 — prueba del warp Rubber Band: afina el fragmento recortado por «afinar» semitonos
  // SIN cambiar la duración (formantes preservados) y lo reproduce. A/B contra «con FX»
  // (que usa el .stretch crudo del motor) para oír la diferencia de calidad.
  const warpTest = async () => {
    const buf = bufRef.current;
    if (!buf || warpBusy) return;
    const semi = warpSemi;
    if (Math.abs(semi) < 0.001) { setWarpMsg('pon los semitonos ≠ 0 (usa −/+ al lado del botón).'); return; }
    setWarpBusy(true);
    setWarpMsg('warpeando…');
    try {
      const { warpBuffer } = await import('../audio/rubberband');
      const region = sliceBuffer(buf, b, e);
      const warped = await warpBuffer(region, { semitones: semi, timeRatio: 1, formant: true });
      // warpBuffer devuelve el MISMO buffer si no procesó (no-op o fallo del WASM).
      if (warped === region) setWarpMsg('⚠ el WASM no procesó (¿no cargó?) — abre la consola (F12) y busca [rubberband]');
      else setWarpMsg(`✓ warp OK · ${semi > 0 ? '+' : ''}${semi} semis · ${(warped.length / warped.sampleRate).toFixed(2)}s (misma duración)`);
      playAudioBuffer(warped);
    } catch (err) {
      setWarpMsg('✗ error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setWarpBusy(false);
    }
  };

  return (
    <>
      <div className="vs-backdrop" onClick={() => setVoiceEdit(null)} />
      <div className="vs-panel">
        <header className="vs-head">
          <input
            className="vs-name"
            value={data.name ?? ''}
            placeholder="voz…"
            onChange={(ev) => update(voiceEditId, { name: ev.target.value })}
          />
          <span className="vs-title">estudio de voz</span>
          <button
            className={`vs-live${live ? ' on' : ''}`}
            onClick={() => setLive((x) => !x)}
            title="escucha viva: al mover cualquier control, oyes el resultado al instante (con sus efectos)"
          >{live ? '◉ escucha viva' : '○ escucha viva'}</button>
          <button
            className="vs-reset"
            onClick={() => { update(voiceEditId, { voice: { ...DEFAULT_VOICE }, begin: undefined, end: undefined }); setHead(0); stopPreview(); }}
            title="restablecer la voz a valores por defecto (melodía, recorte y controles)"
          >restablecer</button>
          <button className="vs-x" onClick={() => setVoiceEdit(null)} title="cerrar">×</button>
        </header>

        {/* onda grande + preview reproducible + recorte por manijas */}
        <div className="vs-wave" ref={wrapRef} onPointerDown={scrub}>
          {!audioUrl ? (
            <div className="vs-wave-none">graba una voz (● grabar) o descarga un audio para editarlo aquí</div>
          ) : !peaks ? (
            <div className="vs-wave-none">decodificando…</div>
          ) : (
            <>
              <div className="vs-wave-bars">
                {peaks.map((p, i) => {
                  const frac = i / peaks.length;
                  const inRange = frac >= b && frac <= e;
                  return <span key={i} className={inRange ? 'on' : ''} style={{ height: `${Math.max(3, p * 100)}%` }} />;
                })}
              </div>
              <div className="vs-mask" style={{ left: 0, width: `${b * 100}%` }} />
              <div className="vs-mask" style={{ left: `${e * 100}%`, right: 0 }} />
              {head != null && <div className="vs-playhead" style={{ left: `${head * 100}%` }} />}
              <div className="vs-handle" style={{ left: `${b * 100}%` }} onPointerDown={dragHandle('b')} />
              <div className="vs-handle" style={{ left: `${e * 100}%` }} onPointerDown={dragHandle('e')} />
            </>
          )}
        </div>
        {audioUrl && (
          <div className="vs-wave-foot">
            <div className="vs-transport">
              <button
                className={`vs-play${playing ? ' on' : ''}`}
                onClick={() => (playing ? stopPreview() : playPreview(head ?? b))}
                title={playing ? 'detener' : 'reproducir la región recortada (crudo, sin efectos)'}
              >{playing ? '■' : '▶'}</button>
              <button
                className={`vs-loopbtn${loopPrev ? ' on' : ''}`}
                onClick={() => setLoopPrev((x) => !x)}
                title="repetir el preview en bucle"
              >⟳</button>
              <button
                className="vs-fxbtn"
                onClick={() => { if (name) void playVoiceSample(name, v, b, e, bufRef.current?.duration ?? 6); }}
                title="escuchar la voz CON sus efectos (formante, espacio, afinar, pulir) — al instante, sin esperar su entrada por el ciclo"
              >◈ con FX</button>
              <span className="vs-warpgrp" title="B1 · warp Rubber Band (alta calidad): afina el recorte estos semitonos SIN cambiar la duración y preservando formantes (voz natural, no ardilla). Autónomo: no depende de otros controles. Compara con «con FX».">
                <button className="vs-warpstep" onClick={() => setWarpSemi((s) => Math.max(-12, s - 1))} title="menos semitonos">−</button>
                <b className="vs-warpsemi">{warpSemi > 0 ? '+' : ''}{warpSemi}</b>
                <button className="vs-warpstep" onClick={() => setWarpSemi((s) => Math.min(12, s + 1))} title="más semitonos">+</button>
                <button
                  className={`vs-fxbtn${warpBusy ? ' on' : ''}`}
                  disabled={warpBusy}
                  onClick={() => void warpTest()}
                >{warpBusy ? '⋯ warp' : '◆ warp RB'}</button>
              </span>
              <span className="vs-region">recorte {(b * 100).toFixed(0)}%–{(e * 100).toFixed(0)}%</span>
            </div>
            <button onClick={() => { update(voiceEditId, { begin: 0, end: 1 }); setHead(0); }}>reset recorte</button>
          </div>
        )}
        {audioUrl && warpMsg && (
          <div className="vs-warpmsg" title="resultado del warp Rubber Band (B1)">{warpMsg}</div>
        )}

        {/* melodía / autotune con piano roll */}
        <div className="vs-sec">
          <h4>melodía · autotune</h4>
          <MelodyRoll
            melody={v.melody ?? ''}
            scale={v.scale ?? ''}
            onMelody={(m) => set({ melody: m })}
            onScale={(s) => set({ scale: s })}
            audition={audition}
          />
          <p className="vs-hint">{melodic
            ? 'clic en la TECLA (izq. ♪) = probar esa nota con tus FX · clic en la reja = poner nota · arrastrar = dibujar la línea · fila «nat» = pitch natural'
            : 'clic en la TECLA (izq. ♪) prueba cada nota con tus FX · pinta la reja para que la voz cante (la fila «nat» = pitch real)'}</p>
          <div className="vs-harm" title="doblaje/armonía: añade una segunda voz a un intervalo (solo con melodía)">
            <span>armonía</span>
            {[[0, '—'], [3, '3m'], [4, '3M'], [7, '5ª'], [12, '8ª'], [-12, '8↓']].map(([h, lbl]) => (
              <button key={h} className={(v.harmony ?? 0) === h ? 'on' : ''} disabled={!melodic} onClick={() => set({ harmony: h as number })}>{lbl}</button>
            ))}
          </div>
          {/* autotune "suave": glide entre notas (portamento) + vibrato vocal */}
          <div className="vs-grid vs-autotune">
            <MiniSlider label="glide" value={Number(v.glide ?? 0)} min={0} max={1} step={0.02} disabled={!melodic} onChange={(x) => set({ glide: x })} />
            <MiniSlider label="vibrato" value={Number(v.vibrato ?? 0)} min={0} max={8} step={0.2} onChange={(x) => set({ vibrato: x })} />
            <MiniSlider label="vib prof" value={Number(v.vibratoDepth ?? 0.3)} min={0} max={2} step={0.05} disabled={!(Number(v.vibrato ?? 0) > 0)} onChange={(x) => set({ vibratoDepth: x })} />
          </div>
          <p className="vs-hint">glide = deslizamiento de pitch entre notas (autotune suave) · vibrato = vida en notas largas</p>
        </div>

        {/* modo de reproducción + formante */}
        <div className="vs-sec">
          <h4>reproducción</h4>
          <div className="vs-row">
            <div className="vs-modes">
              <button className={!melodic && !v.granular && !v.tempo ? 'on' : ''} disabled={melodic} onClick={() => set({ granular: false, tempo: false })} title="pitch real (recomendado)">natural</button>
              <button className={!melodic && !!v.tempo ? 'on' : ''} disabled={melodic} onClick={() => set({ tempo: true, granular: false })} title="al tempo: encaja la voz en N ciclos siguiendo el BPM (el tono acompaña a la velocidad; usa «afinar» para recuperar la altura)">al tempo</button>
              <button className={!melodic && v.granular && !v.tempo ? 'on' : ''} disabled={melodic} onClick={() => set({ granular: true, tempo: false })} title="granular: loopAt + chop">granular</button>
            </div>
            {!melodic && v.tempo && (
              <div className="vs-stepper" title="ciclos que ocupa la voz al encajar en el grid">
                <button onClick={() => set({ tempoCycles: Math.max(1, Math.round(Number(v.tempoCycles ?? 1)) - 1) })}>−</button>
                <b>{Math.max(1, Math.round(Number(v.tempoCycles ?? 1)))}<i>ciclos</i></b>
                <button onClick={() => set({ tempoCycles: Math.min(16, Math.round(Number(v.tempoCycles ?? 1)) + 1) })}>+</button>
              </div>
            )}
            <div className="vs-vowels">
              <button className={!v.vowel ? 'on' : ''} onClick={() => set({ vowel: '' })} title="sin formante">—</button>
              {VOICE_VOWELS.map((w) => (
                <button key={w} className={v.vowel === w ? 'on' : ''} onClick={() => set({ vowel: w })} title={`vocal ${w}`}>{w}</button>
              ))}
            </div>
            <button
              className={`vs-polish${v.polish ? ' on' : ''}`}
              onClick={() => set({ polish: !v.polish })}
              title="pulir: paso-alto (quita retumbe) + compresor (nivela la dinámica) → voz más pro"
            >{v.polish ? '✓ pulida' : 'pulir voz'}</button>
          </div>
        </div>

        {/* diseño de sonido — agrupado por función para una edición coherente */}
        <div className="vs-sec">
          <h4>diseño de sonido</h4>
          <div className="vs-group">
            <span className="vs-subcap">afinación & tiempo</span>
            <div className="vs-grid">
              <MiniSlider label="afinar" value={Number(v.pitchShift ?? 0)} min={-12} max={12} step={1} onChange={(x) => set({ pitchShift: x })} />
              <MiniSlider label="speed" value={Number(v.speed ?? 1)} min={0.25} max={4} step={0.05} onChange={(x) => set({ speed: x })} />
              <MiniSlider label="grain" value={Number(v.grain ?? 8)} min={1} max={32} step={1} disabled={melodic || !v.granular} onChange={(x) => set({ grain: x })} />
            </div>
          </div>
          <div className="vs-group">
            <span className="vs-subcap">carácter</span>
            <div className="vs-grid">
              <MiniSlider label="shape" value={Number(v.shape ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ shape: x })} />
              <MiniSlider label="pos" value={Number(v.position ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ position: x })} />
              <MiniSlider label="gain" value={Number(v.gain ?? 1)} min={0} max={1.5} step={0.01} onChange={(x) => set({ gain: x })} />
            </div>
          </div>
          <div className="vs-group">
            <span className="vs-subcap">espacio & anchura</span>
            <div className="vs-grid">
              <MiniSlider label="room" value={Number(v.room ?? 0)} min={0} max={0.8} step={0.02} onChange={(x) => set({ room: x })} />
              <MiniSlider label="delay" value={Number(v.delay ?? 0)} min={0} max={1} step={0.02} onChange={(x) => set({ delay: x })} />
              <MiniSlider label="spread" value={Number(v.spread ?? 0)} min={0} max={1} step={0.01} onChange={(x) => set({ spread: x })} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
