import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useSynthPresetsStore } from '../store/useSynthPresetsStore';
import { AnalyserScope } from './AnalyserScope';
import type { NodeData, SynthParams } from '../graph/types';
import { SYNTH_WAVES, DEFAULT_SYNTH } from '../graph/types';
import { SYNTH_PRESETS, PRESET_GENRES, presetByName, macroPatch } from '../graph/synthPresets';
import { WAVETABLES } from '../audio/wavetables';
import { MiniSlider } from '../nodes/MiniSlider';
import { playSynthNote, playSourceSound } from '../audio/playNote';
import { midiToName, noteToMidi } from './pianoRollHelpers';
import { firstSampleName, resolveSampleUrl } from '../lib/sampleResolve';
import { sampleDuration } from '../lib/audioMeta';
import { WaveTrim } from './WaveTrim';

const WAVE_GLYPH: Record<string, string> = { sawtooth: '⊿', square: '⊓', triangle: '△', sine: '∿', supersaw: '≣' };

// --- teclado tocable ---------------------------------------------------------
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11]; // semitonos de las teclas blancas
const BLACK_AFTER: Record<number, number> = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 }; // negra tras cada blanca
// tecla del PC → semitono desde la octava base (fila estilo tracker/piano)
const KEY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15,
};

// Teclado tocable: dispara notas con el timbre ACTUAL del synth (superdough en vivo)
// vía ratón o teclado del PC. Al tocar una tecla FIJA la nota base (tonalidad) que el
// nodo reproduce, y la guarda (persistente) vía onPick.
function SynthKeyboard({ syn, nodeId, baseNote, onPick }: { syn: SynthParams; nodeId: string; baseNote: string; onPick: (name: string) => void }) {
  const baseMidi = noteToMidi(baseNote) ?? 48;
  const [oct, setOct] = useState(() => Math.max(0, Math.min(6, Math.floor(baseMidi / 12) - 1)));
  const [hold, setHold] = useState(0.6);
  const [active, setActive] = useState<Set<number>>(new Set());
  const octRef = useRef(oct); octRef.current = oct;
  const synRef = useRef(syn); synRef.current = syn;
  const holdRef = useRef(hold); holdRef.current = hold;
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const pressed = useRef<Set<string>>(new Set());

  // clic/tecla = AUDICIONAR (probar libremente, sin tocar el sonido del source).
  // shift+clic = FIJAR el tono base. Antes cada toque fijaba el tono → el source se
  // re-pitcheaba al vuelo ("pitchea la nota y no deja ubicarla"). Ahora es no-destructivo.
  const trigger = (semi: number, setBase = false) => {
    const midi = (octRef.current + 1) * 12 + semi; // c(oct) = (oct+1)*12 en MIDI
    void playSynthNote(synRef.current, midi, holdRef.current, nodeId);
    if (setBase) pickRef.current(midiToName(midi));
    setActive((a) => new Set(a).add(semi));
    window.setTimeout(() => setActive((a) => { const n = new Set(a); n.delete(semi); return n; }), 170);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const k = e.key.toLowerCase();
      const semi = KEY_MAP[k];
      if (semi === undefined || pressed.current.has(k)) return;
      pressed.current.add(k);
      e.preventDefault();
      trigger(semi, e.shiftKey);
    };
    const up = (e: KeyboardEvent) => pressed.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBase = (semi: number) => (oct + 1) * 12 + semi === baseMidi;
  return (
    <div className="skb">
      <div className="skb-ctl">
        <div className="vs-stepper" title="octava base del teclado">
          <button onClick={() => setOct((o) => Math.max(0, o - 1))}>−</button>
          <b>C{oct}<i>8va</i></b>
          <button onClick={() => setOct((o) => Math.min(6, o + 1))}>+</button>
        </div>
        <div className="skb-tono" title="tonalidad/nota base que toca el sonido">
          <span>tono</span>
          <button onClick={() => pickRef.current(midiToName((noteToMidi(baseNote) ?? 48) - 1))} title="−1 semitono">−</button>
          <b>{baseNote}</b>
          <button onClick={() => pickRef.current(midiToName((noteToMidi(baseNote) ?? 48) + 1))} title="+1 semitono">+</button>
        </div>
        <label className="skb-hold" title="duración de cada nota">sostener
          <input type="range" min={0.1} max={2.5} step={0.05} value={hold} onChange={(e) => setHold(parseFloat(e.target.value))} />
        </label>
        <span className="skb-hint">clic = probar la nota · shift+clic = fijar el tono · (A W S E D F T G Y H U J…)</span>
      </div>
      <div className="skb-keys">
        {[0, 1].map((o) =>
          WHITE_OFFSETS.map((wo) => {
            const semi = o * 12 + wo;
            const black = BLACK_AFTER[wo] !== undefined ? o * 12 + BLACK_AFTER[wo] : null;
            return (
              <div className="skb-wkey-wrap" key={semi}>
                <button className={`skb-wkey${active.has(semi) ? ' on' : ''}${isBase(semi) ? ' base' : ''}`} onPointerDown={(e) => trigger(semi, e.shiftKey)} />
                {black !== null && (
                  <button className={`skb-bkey${active.has(black) ? ' on' : ''}${isBase(black) ? ' base' : ''}`} onPointerDown={(e) => { e.stopPropagation(); trigger(black, e.shiftKey); }} />
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

// Envolvente ADSR INTERACTIVA (estilo Vital): tres nodos arrastrables (ataque, decay/
// sostén, release) sobre una curva con relleno degradado (cian→violeta) y glow. Arrastrar
// horizontal = tiempo; el nodo de sostén también se arrastra en vertical = nivel de sostén.
const A_MAX = 2, D_MAX = 1, R_MAX = 4;
function AdsrEnv({ syn, onChange }: { syn: SynthParams; onChange: (patch: Partial<SynthParams>) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const a = Math.max(0, Math.min(A_MAX, Number(syn.attack ?? 0.01)));
  const d = Math.max(0, Math.min(D_MAX, Number(syn.decay ?? 0.12)));
  const s = Math.max(0, Math.min(1, Number(syn.sustain ?? 0.6)));
  const r = Math.max(0, Math.min(R_MAX, Number(syn.release ?? 0.2)));
  const paramsRef = useRef({ a, d, s, r }); paramsRef.current = { a, d, s, r };
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const drag = useRef<'a' | 'ds' | 'r' | null>(null);

  // Geometría en píxeles CSS (para hit-test y dibujo, con dpr aparte).
  const layout = (W: number, H: number) => {
    const pad = 9;
    const x0 = pad, y0 = H - pad, top = pad;
    const wSeg = W - pad * 2;
    const wA = wSeg * 0.3, wD = wSeg * 0.26, wH = wSeg * 0.16, wR = wSeg * 0.28;
    const p = paramsRef.current;
    const attackX = x0 + (p.a / A_MAX) * wA;
    const sustainY = y0 - p.s * (y0 - top);
    const decayX = attackX + (p.d / D_MAX) * wD;
    const sustainEndX = decayX + wH;
    const releaseX = sustainEndX + (p.r / R_MAX) * wR;
    return { pad, x0, y0, top, wA, wD, wR, attackX, sustainY, decayX, sustainEndX, releaseX };
  };

  const draw = () => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const Wc = c.clientWidth, Hc = c.clientHeight;
    c.width = Math.floor(Wc * dpr); c.height = Math.floor(Hc * dpr);
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, Wc, Hc);
    const L = layout(Wc, Hc);
    // relleno degradado bajo la curva
    ctx.beginPath();
    ctx.moveTo(L.x0, L.y0);
    ctx.lineTo(L.attackX, L.top);
    ctx.lineTo(L.decayX, L.sustainY);
    ctx.lineTo(L.sustainEndX, L.sustainY);
    ctx.lineTo(L.releaseX, L.y0);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, L.top, 0, L.y0);
    grad.addColorStop(0, 'rgba(150,120,255,0.30)');
    grad.addColorStop(1, 'rgba(61,240,208,0.05)');
    ctx.fillStyle = grad; ctx.fill();
    // curva con glow
    ctx.beginPath();
    ctx.moveTo(L.x0, L.y0);
    ctx.lineTo(L.attackX, L.top);
    ctx.lineTo(L.decayX, L.sustainY);
    ctx.lineTo(L.sustainEndX, L.sustainY);
    ctx.lineTo(L.releaseX, L.y0);
    ctx.strokeStyle = 'rgba(120,255,238,0.95)';
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(61,240,208,0.8)'; ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // nodos arrastrables
    const dot = (x: number, y: number, active: boolean) => {
      ctx.beginPath(); ctx.arc(x, y, active ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#fff' : 'rgba(160,255,240,0.95)';
      ctx.shadowColor = 'rgba(61,240,208,0.9)'; ctx.shadowBlur = active ? 12 : 7;
      ctx.fill(); ctx.shadowBlur = 0;
    };
    dot(L.attackX, L.top, drag.current === 'a');
    dot(L.decayX, L.sustainY, drag.current === 'ds');
    dot(L.releaseX, L.y0, drag.current === 'r');
  };

  useEffect(() => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [a, d, s, r]);

  const onDown = (ev: React.PointerEvent) => {
    const c = ref.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const L = layout(rect.width, rect.height);
    const near = (x: number, y: number) => Math.hypot(mx - x, my - y) < 18;
    drag.current = near(L.attackX, L.top) ? 'a' : near(L.decayX, L.sustainY) ? 'ds' : near(L.releaseX, L.y0) ? 'r' : null;
    if (!drag.current) return;
    ev.preventDefault();
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    draw();
  };
  const onMove = (ev: React.PointerEvent) => {
    if (!drag.current) return;
    const c = ref.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const L = layout(rect.width, rect.height);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (drag.current === 'a') {
      onChangeRef.current({ attack: +clamp(((mx - L.x0) / L.wA) * A_MAX, 0, A_MAX).toFixed(3) });
    } else if (drag.current === 'ds') {
      const d2 = clamp(((mx - L.attackX) / L.wD) * D_MAX, 0, D_MAX);
      const s2 = clamp((L.y0 - my) / (L.y0 - L.top), 0, 1);
      onChangeRef.current({ decay: +d2.toFixed(3), sustain: +s2.toFixed(3) });
    } else {
      onChangeRef.current({ release: +clamp(((mx - L.sustainEndX) / L.wR) * R_MAX, 0, R_MAX).toFixed(3) });
    }
  };
  const onUp = () => { if (drag.current) { drag.current = null; draw(); } };

  return (
    <canvas
      ref={ref}
      className="ss-adsr"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}

// Visor de ONDA estático (estilo Vital): dibuja la forma del oscilador seleccionado
// con glow y degradado. Vive detrás del osciloscopio en vivo (que solo pinta al sonar),
// así el panel siempre muestra la "wavetable". Solo para sintes (los samples tienen su
// propia onda en el recorte de arriba).
function WaveShape({ wave }: { wave: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth, H = c.clientHeight;
    c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr);
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    const mid = H / 2, amp = H * 0.32, cycles = 2;
    const fn = (t: number): number => {
      const ph = t * cycles * Math.PI * 2;
      switch (wave) {
        case 'sine': return Math.sin(ph);
        case 'square': return Math.sin(ph) >= 0 ? 1 : -1;
        case 'triangle': return Math.asin(Math.sin(ph)) * (2 / Math.PI);
        case 'sawtooth': { const x = (t * cycles) % 1; return 1 - 2 * x; }
        case 'supersaw': { const x = (t * cycles) % 1; return (1 - 2 * x) * 0.7 + Math.sin(ph * 1.01) * 0.3; }
        default: return Math.sin(ph) * 0.7 + Math.sin(ph * 2 + 0.6) * 0.3; // wavetable genérica
      }
    };
    ctx.beginPath();
    for (let i = 0; i <= W; i++) { const y = mid - fn(i / W) * amp; i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y); }
    ctx.strokeStyle = 'rgba(150,120,255,0.55)';
    ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(120,90,255,0.6)'; ctx.shadowBlur = 7;
    ctx.stroke(); ctx.shadowBlur = 0;
  }, [wave]);
  return <canvas ref={ref} className="ss-waveshape" />;
}

export function SynthStudio() {
  const synthEditId = useGraphStore((s) => s.synthEditId);
  const setSynthEdit = useGraphStore((s) => s.setSynthEdit);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === s.synthEditId));
  const update = useGraphStore((s) => s.updateNodeData);
  const addPattern = useGraphStore((s) => s.addPattern);
  const userPresets = useSynthPresetsStore((s) => s.presets);
  const savePreset = useSynthPresetsStore((s) => s.save);
  const removePreset = useSynthPresetsStore((s) => s.remove);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const canUndo = useGraphStore((s) => s.past.length > 0);
  const canRedo = useGraphStore((s) => s.future.length > 0);
  const [saveName, setSaveName] = useState('');
  const [ab, setAb] = useState<SynthParams | null>(null); // slot B para comparar A/B
  const [fitMsg, setFitMsg] = useState(''); // "encajar" — DEBE ir antes del return (los hooks no van tras un return condicional)

  if (!synthEditId || !node) return null;
  const data = node.data as NodeData;
  const syn: SynthParams = { ...DEFAULT_SYNTH, ...(data.synth ?? {}) };
  const on = !!data.synthOn;
  const num = (x: number | undefined) => Number(x ?? 0);
  // cualquier ajuste activa el synth (como en el mini-panel).
  const baseNote = data.synthNote ?? 'c3';
  // ADAPTATIVO: ¿la fuente es un SAMPLE (s("kick")) o un OSCILADOR? El estudio muestra
  // controles de sample (velocidad/reversa/recorte/troceo/loop) u oscilador según el caso.
  const sampleName = firstSampleName(data.code ?? '');
  const isSample = !!sampleName && !(SYNTH_WAVES as readonly string[]).includes(sampleName);
  const begin = typeof data.begin === 'number' ? data.begin : 0;
  const end = typeof data.end === 'number' ? data.end : 1;
  const reverse = !!syn.reverse;
  const loopMode = syn.loopMode ?? 'natural';
  const set = (patch: Partial<SynthParams>) => update(synthEditId, { synthOn: true, synth: { ...syn, ...patch } });
  const applyPreset = (i: number) => {
    if (i < 0) return;
    const p = SYNTH_PRESETS[i];
    // macroPreset se fija solo si el preset trae macro → así aparece el mando; macro=0
    // deja el timbre en su valor base (sin morfear todavía).
    update(synthEditId, { synthOn: true, synth: { ...DEFAULT_SYNTH, ...p.params, macro: 0, macroPreset: p.macro ? p.name : undefined } });
  };
  const activePreset = presetByName(syn.macroPreset);
  const applyUser = (p: { params: SynthParams; note?: string }) =>
    update(synthEditId, { synthOn: true, synth: { ...DEFAULT_SYNTH, ...p.params }, ...(p.note ? { synthNote: p.note } : {}) });
  // init: sonido base limpio. random: explora un timbre nuevo (rangos musicales).
  const initSynth = () => update(synthEditId, { synthOn: true, synth: { ...DEFAULT_SYNTH } });
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pickOne = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const randomize = () =>
    update(synthEditId, {
      synthOn: true,
      synth: {
        ...DEFAULT_SYNTH,
        wave: pickOne(SYNTH_WAVES),
        attack: +rnd(0, 0.35).toFixed(3), decay: +rnd(0.05, 0.5).toFixed(3), sustain: +rnd(0.2, 0.9).toFixed(2), release: +rnd(0.05, 1.2).toFixed(2),
        cutoff: Math.round(rnd(400, 6000)), lpq: +rnd(0, 14).toFixed(1), lpenv: +rnd(0, 2.5).toFixed(2), ftype: pickOne([0, 1, 2]),
        fm: Math.random() < 0.5 ? 0 : +rnd(0.4, 5).toFixed(2), fmh: pickOne([0.5, 1, 2, 3, 4]),
        detune: +rnd(0, 0.3).toFixed(2), pw: +rnd(0.25, 0.75).toFixed(2),
        room: Math.random() < 0.5 ? 0 : +rnd(0.1, 0.5).toFixed(2), drive: Math.random() < 0.6 ? 0 : +rnd(0.1, 0.5).toFixed(2),
        octave: pickOne([-1, 0, 0, 1]),
      },
    });
  // A/B: 1er clic captura el sonido actual en B; siguientes clics alternan A↔B.
  const swapAB = () => {
    if (!ab) { setAb({ ...syn }); return; }
    const cur = { ...syn };
    update(synthEditId, { synthOn: true, synth: ab });
    setAb(cur);
  };
  const doSave = () => { savePreset(saveName || data.name || 'sonido', syn, baseNote); setSaveName(''); };
  const setBaseNote = (name: string) => update(synthEditId, { synthOn: true, synthNote: name });
  // crea un NUEVO Source que toca este sonido en su nota base (para reutilizarlo rápido).
  const soundToSource = (name: string, params: SynthParams, note?: string) => {
    const nm = note || 'c3';
    addPattern(`note("${nm}")`, name || 'synth', { synthOn: true, synth: { ...DEFAULT_SYNTH, ...params }, synthNote: nm });
  };
  // ENCAJAR: mide la duración del sample y pone loop = ciclos que dura, para que loopee
  // continuo SIN solaparse (arregla un sample largo que se re-dispara y se asolapa).
  const fitLoop = async () => {
    const url = resolveSampleUrl(sampleName);
    if (!url) { setFitMsg('no pude medir la duración'); setTimeout(() => setFitMsg(''), 2000); return; }
    const dur = await sampleDuration(url).catch(() => 0);
    if (!dur) { setFitMsg('no pude medir la duración'); setTimeout(() => setFitMsg(''), 2000); return; }
    // repetir cada N ciclos = su duración. natural = N exacto (fraccionario) a tempo real;
    // 'al beat' = N redondeado a compás entero (encaja a la rejilla, varispeed).
    const raw = dur * useGraphStore.getState().cps;
    const n = loopMode === 'beat' ? Math.max(1, Math.round(raw)) : Math.max(1, Math.round(raw * 100) / 100);
    if (synthEditId) update(synthEditId, { synthOn: true, synth: { ...syn, loop: n } });
    setFitMsg(loopMode === 'beat' ? `encajado a ${n} compases (al beat)` : `repite cada ${n} ciclos · tempo natural`);
    setTimeout(() => setFitMsg(''), 2200);
  };

  return (
    <>
      <div className="vs-backdrop" onClick={() => setSynthEdit(null)} />
      <div className="ss-panel">
        <header className="vs-head">
          <input className="vs-name" value={data.name ?? ''} placeholder={isSample ? 'sample…' : 'synth…'} onChange={(e) => update(synthEditId, { name: e.target.value })} />
          <span className="vs-title">estudio de sonido{isSample && sampleName ? <i className="ss-kind">sample · {sampleName}</i> : <i className="ss-kind">synth</i>}</span>
          <div className="ss-tools">
            <button onClick={undo} disabled={!canUndo} title="deshacer (Ctrl+Z)">↶</button>
            <button onClick={redo} disabled={!canRedo} title="rehacer (Ctrl+⇧Z)">↷</button>
            {!isSample && <button onClick={initSynth} title="init: sonido base limpio">init</button>}
            {!isSample && <button onClick={randomize} title="aleatorio: explora un timbre nuevo">rnd</button>}
            {!isSample && <button className={ab ? 'on' : ''} onClick={swapAB} title="A/B: compara dos versiones (1er clic captura B, luego alterna)">A/B</button>}
          </div>
          <button
            className="vs-reset"
            onClick={() => update(synthEditId, { synth: { ...DEFAULT_SYNTH }, begin: 0, end: 1 })}
            title="restablecer a valores por defecto (incluye el recorte)"
          >restablecer</button>
          <button className="vs-x" onClick={() => setSynthEdit(null)} title="cerrar">×</button>
        </header>

        <div className="ss-top">
          <button
            className={`tn-syn-power${on ? ' on' : ''}`}
            onClick={() => update(synthEditId, { synthOn: !on })}
            title={isSample
              ? (on ? 'procesado ACTIVO · clic = sonar el sample crudo' : 'aplicar el procesado (filtro/envolvente/fx/velocidad…) al sample')
              : (on ? 'synth activo · clic = bypass' : 'activar synth')}
          >
            {isSample ? (on ? '● procesando' : '○ crudo') : (on ? '● on' : '○ bypass')}
          </button>
          <button
            className="ss-play"
            onPointerDown={() => void playSourceSound(data.code ?? '', syn, on, baseNote, synthEditId, isSample ? 2.4 : 1.4, begin, end)}
            title={on ? 'escuchar el sonido procesado — al instante' : 'escuchar el sonido ORIGINAL (sin modificar) — al instante'}
          >▶ escuchar</button>
          {!isSample && (
            <>
              <select className="tn-syn-preset" value="" onChange={(e) => applyPreset(Number(e.target.value))} title="presets de fábrica, por género">
                <option value="">preset…</option>
                {PRESET_GENRES.map((g) => (
                  <optgroup key={g} label={g}>
                    {SYNTH_PRESETS.map((p, i) => (p.genre === g ? <option key={p.name} value={i}>{p.name}</option> : null))}
                  </optgroup>
                ))}
              </select>
              {activePreset?.macro && (
                <div className="ss-macro" title={`macro de un mando — morfea el timbre con un solo control (${activePreset.macro.label})`}>
                  <MiniSlider label={`◉ ${activePreset.macro.label}`} value={num(syn.macro ?? 0)} min={0} max={1} step={0.01} onChange={(v) => set(macroPatch(activePreset, v))} />
                </div>
              )}
              <span className="ss-save">
                <input
                  value={saveName}
                  placeholder="nombre del sonido"
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSave(); }}
                />
                <button onClick={doSave} title="guardar el timbre actual como sonido propio (con su nota)">guardar</button>
                <button className="ss-tosrc" onClick={() => soundToSource(saveName || data.name || 'synth', syn, baseNote)} title="crear un nuevo Source con este sonido y su nota base">→ source</button>
              </span>
            </>
          )}
        </div>

        {/* SAMPLE: recorte visual + reproducción (velocidad/reversa/troceo/loop). Solo cuando
            la fuente es una muestra; sustituye al teclado del oscilador. */}
        {isSample ? (
          <div className="vs-sec ss-sample">
            <h4>sample <i>{sampleName}</i></h4>
            <WaveTrim nodeId={synthEditId} name={sampleName} begin={data.begin} end={data.end} />
            <div className="ss-sample-ctl">
              <div className="vs-grid ss-sample-grid">
                <MiniSlider label="pitch/vel" value={num(syn.speed ?? 1)} min={0.25} max={4} step={0.01} onChange={(v) => set({ speed: v })} />
                <MiniSlider label="chop" value={Math.round(num(syn.chop ?? 0))} min={0} max={32} step={1} onChange={(v) => set({ chop: Math.round(v) })} />
                <MiniSlider label="repetir (ciclos)" value={Math.round(num(syn.loop ?? 0))} min={0} max={16} step={1} onChange={(v) => set({ loop: Math.round(v) })} />
              </div>
              <div className="ss-sample-btns">
                <div className="ss-loopmode seg" title="cómo repite el sample largo">
                  <button className={loopMode === 'natural' ? 'on' : ''} onClick={() => set({ loopMode: 'natural' })} title="a su tempo real — manda el BPM del sample (sin varispeed)">natural</button>
                  <button className={loopMode === 'beat' ? 'on' : ''} onClick={() => set({ loopMode: 'beat' })} title="encaja al tempo del proyecto (varispeed: cambia el pitch)">al beat</button>
                </div>
                <button
                  className={`ss-rev${reverse ? ' on' : ''}`}
                  onClick={() => set({ reverse: !reverse })}
                  title="reproducir el sample al revés"
                >◁ reversa</button>
                <button
                  className="ss-fit"
                  onClick={() => void fitLoop()}
                  title="mide la duración y ajusta la repetición para que loopee sin solaparse"
                >⧉ encajar</button>
              </div>
            </div>
            <span className="ss-sample-hint">{fitMsg || 'recorta arrastrando · pitch = tono y velocidad · chop trocea · repetir/encajar loopea a su tempo natural sin solaparse'}</span>
          </div>
        ) : (
          /* teclado tocable: prueba/afina el sonido y toca melodías en vivo */
          <SynthKeyboard syn={syn} nodeId={synthEditId} baseNote={baseNote} onPick={setBaseNote} />
        )}

        {!isSample && userPresets.length > 0 && (
          <div className="ss-userpresets">
            <span className="ss-up-lbl">mis sonidos</span>
            {userPresets.map((p) => (
              <span className="ss-up" key={p.id}>
                <button className="ss-up-apply" onClick={() => applyUser(p)} title="cargar este sonido en el synth">
                  {p.name}{p.note && <i className="ss-up-note">{p.note}</i>}
                </button>
                <button className="ss-up-src" onClick={() => soundToSource(p.name, p.params, p.note)} title="crear un Source con este sonido">→src</button>
                <button className="ss-up-x" onClick={() => removePreset(p.id)} title="borrar">×</button>
              </span>
            ))}
          </div>
        )}

        {/* panorama: onda en vivo + envolvente ADSR */}
        <div className="ss-viz">
          <div className="ss-viz-cell hero"><span className="ss-viz-lbl">onda</span>{!isSample && <WaveShape wave={syn.wave ?? 'sawtooth'} />}<AnalyserScope nodeId={synthEditId} className="ss-scope" /></div>
          <div className="ss-viz-cell"><span className="ss-viz-lbl">envolvente · arrastra</span><AdsrEnv syn={syn} onChange={set} /></div>
        </div>

        {/* oscilador (solo synth) */}
        {!isSample && (
        <div className="vs-sec">
          <h4>oscilador</h4>
          <div className="ss-waves">
            {SYNTH_WAVES.map((w) => (
              <button key={w} className={syn.wave === w ? 'on' : ''} onClick={() => set({ wave: w })} title={w}>{WAVE_GLYPH[w] ?? w}</button>
            ))}
            <span className="ss-wt-sep">wt</span>
            {WAVETABLES.map((wt) => (
              <button key={wt.name} className={`ss-wt${syn.wave === wt.name ? ' on' : ''}`} onClick={() => set({ wave: wt.name })} title={`wavetable · ${wt.label}`}>{wt.label}</button>
            ))}
          </div>
        </div>
        )}

        <div className="ss-cols">
          <div className="vs-sec">
            <h4>amplitud (adsr)</h4>
            <div className="vs-grid">
              <MiniSlider label="attack" value={num(syn.attack)} min={0} max={2} step={0.005} onChange={(v) => set({ attack: v })} />
              <MiniSlider label="decay" value={num(syn.decay)} min={0} max={1} step={0.005} onChange={(v) => set({ decay: v })} />
              <MiniSlider label="sustain" value={num(syn.sustain)} min={0} max={1} step={0.01} onChange={(v) => set({ sustain: v })} />
              <MiniSlider label="release" value={num(syn.release)} min={0} max={4} step={0.01} onChange={(v) => set({ release: v })} />
            </div>
          </div>
          <div className="vs-sec">
            <h4>filtro (paso-bajo + paso-alto)</h4>
            <div className="ss-ftype seg" title="tipo/pendiente del filtro paso-bajo">
              {(['12db', 'ladder', '24db'] as const).map((lbl, i) => (
                <button key={lbl} className={Math.round(num(syn.ftype)) === i ? 'on' : ''} onClick={() => set({ ftype: i })}>{lbl}</button>
              ))}
            </div>
            <div className="vs-grid">
              <MiniSlider label="cutoff" value={num(syn.cutoff)} min={0} max={12000} step={50} onChange={(v) => set({ cutoff: v })} />
              <MiniSlider label="reso" value={num(syn.lpq)} min={0} max={20} step={0.5} onChange={(v) => set({ lpq: v })} />
              <MiniSlider label="env" value={num(syn.lpenv)} min={0} max={4} step={0.05} onChange={(v) => set({ lpenv: v })} />
              <MiniSlider label="envA" value={num(syn.lpa)} min={0} max={1} step={0.005} onChange={(v) => set({ lpa: v })} />
              <MiniSlider label="hpf" value={num(syn.hcutoff)} min={0} max={8000} step={50} onChange={(v) => set({ hcutoff: v })} />
              <MiniSlider label="hpf reso" value={num(syn.hpq)} min={0} max={20} step={0.5} onChange={(v) => set({ hpq: v })} />
            </div>
          </div>
          {!isSample && (
          <div className="vs-sec">
            <h4>oscilador · unísono</h4>
            <div className="vs-grid">
              <MiniSlider label="unison" value={Number(syn.unison ?? 5)} min={1} max={9} step={1} disabled={syn.wave !== 'supersaw'} onChange={(v) => set({ unison: v })} />
              <MiniSlider label="detune" value={num(syn.detune)} min={0} max={0.5} step={0.01} disabled={syn.wave !== 'supersaw'} onChange={(v) => set({ detune: v })} />
              <MiniSlider label="spread" value={num(syn.spread)} min={0} max={1} step={0.02} disabled={syn.wave !== 'supersaw'} onChange={(v) => set({ spread: v })} />
              <MiniSlider label="noise" value={num(syn.noise)} min={0} max={1} step={0.02} onChange={(v) => set({ noise: v })} />
            </div>
          </div>
          )}
          {!isSample && (
          <div className="vs-sec">
            <h4>afinación</h4>
            <div className="vs-grid">
              <MiniSlider label="octava" value={Number(syn.octave ?? 0)} min={-3} max={3} step={1} onChange={(v) => set({ octave: Math.round(v) })} />
              <MiniSlider label="semitonos" value={Number(syn.semi ?? 0)} min={-12} max={12} step={1} onChange={(v) => set({ semi: Math.round(v) })} />
              <MiniSlider label="fino (cents)" value={Number(syn.fine ?? 0)} min={-50} max={50} step={1} onChange={(v) => set({ fine: Math.round(v) })} />
            </div>
          </div>
          )}
          <div className="vs-sec">
            <h4>modulación ({isSample ? 'vibrato · phaser' : 'fm · vibrato · phaser'})</h4>
            {!isSample && (
              <div className="ss-fmwave seg" title="forma de onda del modulador FM">
                {(['sine', 'triangle', 'square', 'sawtooth'] as const).map((w) => (
                  <button key={w} className={(syn.fmwave ?? 'sine') === w ? 'on' : ''} onClick={() => set({ fmwave: w })}>{WAVE_GLYPH[w] ?? w}</button>
                ))}
              </div>
            )}
            <div className="vs-grid">
              {!isSample && <MiniSlider label="fm idx" value={num(syn.fm)} min={0} max={8} step={0.1} onChange={(v) => set({ fm: v })} />}
              {!isSample && <MiniSlider label="fm ratio" value={Number(syn.fmh ?? 1)} min={0.5} max={8} step={0.5} onChange={(v) => set({ fmh: v })} />}
              {!isSample && <MiniSlider label="fm atk" value={num(syn.fmattack)} min={0} max={1} step={0.005} onChange={(v) => set({ fmattack: v })} />}
              {!isSample && <MiniSlider label="fm dec" value={num(syn.fmdecay)} min={0} max={1} step={0.005} onChange={(v) => set({ fmdecay: v })} />}
              {!isSample && <MiniSlider label="fm sus" value={Number(syn.fmsustain ?? 1)} min={0} max={1} step={0.01} onChange={(v) => set({ fmsustain: v })} />}
              <MiniSlider label="vib" value={num(syn.vib)} min={0} max={12} step={0.1} onChange={(v) => set({ vib: v })} />
              <MiniSlider label="vib dep" value={num(syn.vibmod)} min={0} max={2} step={0.05} onChange={(v) => set({ vibmod: v })} />
              <MiniSlider label="phaser" value={num(syn.phaser)} min={0} max={2} step={0.05} onChange={(v) => set({ phaser: v })} />
              <MiniSlider label="ph dep" value={Number(syn.phaserdepth ?? 0.6)} min={0} max={1} step={0.02} onChange={(v) => set({ phaserdepth: v })} />
            </div>
          </div>
          <div className="vs-sec">
            <h4>espacio (reverb · eco)</h4>
            <div className="vs-grid">
              <MiniSlider label="room" value={num(syn.room)} min={0} max={1} step={0.02} onChange={(v) => set({ room: v })} />
              <MiniSlider label="size" value={Number(syn.roomsize ?? 2)} min={0} max={10} step={0.5} onChange={(v) => set({ roomsize: v })} />
              <MiniSlider label="delay" value={num(syn.delay)} min={0} max={1} step={0.02} onChange={(v) => set({ delay: v })} />
              <MiniSlider label="dly fb" value={Number(syn.delayfb ?? 0.4)} min={0} max={0.9} step={0.02} onChange={(v) => set({ delayfb: v })} />
            </div>
            <label className="tn-syn-dsync" title="tiempo del eco, sincronizado al tempo (fracción del compás). Puntillo 3/16 = el dub delay clásico del dancehall/reggae — cae en el grid a cualquier BPM.">
              <span>tiempo eco</span>
              <select
                value={String(Number((syn.delaysync ?? 3 / 16).toFixed(4)))}
                onChange={(e) => set({ delaysync: Number(e.target.value) })}
              >
                <option value={String(Number((1 / 16).toFixed(4)))}>1/16 semicorchea</option>
                <option value={String(Number((1 / 8).toFixed(4)))}>1/8 corchea</option>
                <option value={String(Number((1 / 6).toFixed(4)))}>1/6 tresillo</option>
                <option value={String(Number((3 / 16).toFixed(4)))}>3/16 puntillo (dub)</option>
                <option value={String(Number((1 / 4).toFixed(4)))}>1/4 negra</option>
              </select>
            </label>
          </div>
          <div className="vs-sec">
            <h4>pitch env · salida</h4>
            <div className="vs-grid">
              <MiniSlider label="pitch env" value={num(syn.penv)} min={-12} max={12} step={1} onChange={(v) => set({ penv: v })} />
              <MiniSlider label="p decay" value={Number(syn.pdecay ?? 0.1)} min={0} max={1} step={0.01} onChange={(v) => set({ pdecay: v })} />
              <MiniSlider label="drive" value={num(syn.drive)} min={0} max={1} step={0.02} onChange={(v) => set({ drive: v })} />
              <MiniSlider label="crush" value={Number(syn.coarse ?? 1)} min={1} max={16} step={1} onChange={(v) => set({ coarse: v })} />
              <MiniSlider label="pan" value={Number(syn.pan ?? 0.5)} min={0} max={1} step={0.02} onChange={(v) => set({ pan: v })} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
