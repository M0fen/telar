import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { getScheduler } from '../audio/engine';
import { playDrumHit } from '../audio/playNote';
import { midiToName, noteToMidi } from '../ui/pianoRollHelpers';
import { LiveScope } from './LiveScope';
import { MiniSlider } from './MiniSlider';
import { DRUM_MACHINES } from '../docs/catalog';
import { ACCENT, DEFAULT_NOTE, GHOST, NORMAL, NUDGE_MAX, addSilentArm, bankExempt, buildSeq, duplicateArm, fmt, isMelodicCode, laneGroove, laneOwnBank, lanePitched, parseSeq, removeArm, seedSilent, setArmBars, splitArrange, spliceArm, withLaneBank, wrapAsArrange, type Lane } from './stepseqCode';
import { MelodicSeq } from './MelodicSeq';

// SECUENCIADOR por source (unificado): edita el patrón como una rejilla multi-sonido,
// tipo drum-machine/LFO. Permite AÑADIR golpes y AÑADIR OTROS SONIDOS (el "tu" y el
// "pa") por paso, ver cómo se desarrolla el sonido y previsualizar al instante (clic en
// celda = suena ese golpe; ▶/espacio = aísla y reproduce el patrón en bucle). Absorbe la
// idea de la rejilla de silencios (celda apagada = silencio) y la amplía.
//
// VELOCITY por paso: clic derecho en una celda encendida cicla su nivel — normal →
// acento (más fuerte) → ghost (más flojo). Mientras todo esté a nivel normal se emite el
// patrón simple `s("a ~, ~ b")`; en cuanto hay un acento se emite `stack(s("…").gain("…"),
// …)` con un `.gain` por pista (se multiplica con el del canal, así que compone bien).
//
// PITCH por paso (A2): una pista puede volverse MELÓDICA (toggle ♪). Entonces se emite
// como `note("c3 ~ eb3 ~").s("cb")` (note() re-afina el sample: 808 afinado, cowbell
// melódico). Cada paso encendido lleva su nota (arrastre vertical en la sub-fila de
// pitch). Sin pitch la pista queda IDÉNTICA a hoy.

// La lógica de parse/build vive en stepseqCode.ts (módulo puro, testeable en Node).
const nextLevel = (v: number) => (Math.abs(v - NORMAL) < 0.01 ? ACCENT : Math.abs(v - ACCENT) < 0.01 ? GHOST : NORMAL);
const PITCH_LO = 36, PITCH_RANGE = 36; // rango de afinación de la sub-fila: c2..c5
const PX_PER_SEMI = 6; // píxeles de arrastre vertical por semitono (afinado fluido/orgánico)
// SCALE-LOCK: al afinar, el arrastre se ENGANCHA a una tonalidad (los bajos/808/stabs no
// se desafinan). 'libre' = sin bloqueo.
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES: Record<string, number[]> = {
  menor: [0, 2, 3, 5, 7, 8, 10], mayor: [0, 2, 4, 5, 7, 9, 11],
  'menor pent': [0, 3, 5, 7, 10], 'mayor pent': [0, 2, 4, 7, 9],
  dórica: [0, 2, 3, 5, 7, 9, 10], frigia: [0, 1, 3, 5, 7, 8, 10], 'menor arm': [0, 2, 3, 5, 7, 8, 11],
};
function snapToScale(midi: number, root: number, name: string): number {
  const iv = SCALES[name];
  if (!iv) return midi;
  const set = iv.map((i) => (root + i) % 12);
  for (let d = 0; d < 12; d++) {
    if (set.includes((((midi + d) % 12) + 12) % 12)) return midi + d;
    if (set.includes((((midi - d) % 12) + 12) % 12)) return midi - d;
  }
  return midi;
}
// ACORDES por paso: cada nota afinada puede sonar como acorde (stabs/pads de EBM/post-punk).
const CHORDS = ['nota', '5ª', 'octava', 'tríada'];
function chordRoot(tok: string): string {
  const t = (tok || '').replace(/^\[/, '');
  return (t.split(',')[0] || '').replace(/\].*$/, '').trim();
}
// sube `steps` GRADOS de la escala desde midi (para tríadas diatónicas: 3ª = 2, 5ª = 4).
function diatonicStep(midi: number, steps: number, root: number, name: string): number {
  const iv = SCALES[name];
  if (!iv) return midi + steps * 2;
  const set = iv.map((i) => (root + i) % 12);
  let m = midi, count = 0;
  while (count < steps && m < midi + 24) { m++; if (set.includes((((m % 12) + 12) % 12))) count++; }
  return m;
}
function buildChord(rootMidi: number, chord: string, scaleRoot: number, scaleName: string): string {
  const ns: number[] = [rootMidi];
  if (chord === '5ª') ns.push(rootMidi + 7);
  else if (chord === 'octava') ns.push(rootMidi + 12);
  else if (chord === 'tríada') {
    if (scaleName !== 'off') ns.push(diatonicStep(rootMidi, 2, scaleRoot, scaleName), diatonicStep(rootMidi, 4, scaleRoot, scaleName));
    else ns.push(rootMidi + 3, rootMidi + 7); // tríada menor por defecto (géneros oscuros)
  }
  const names = ns.map((m) => midiToName(m));
  return names.length > 1 ? `[${names.join(',')}]` : names[0];
}

// paleta de sonidos para añadir pistas (nombres del banco de batería).
const PALETTE: { s: string; label: string }[] = [
  { s: 'bd', label: 'bombo' }, { s: 'sd', label: 'caja' }, { s: 'rim', label: 'rim' },
  { s: 'cp', label: 'clap' }, { s: 'hh', label: 'hat' }, { s: 'oh', label: 'open' },
  { s: 'lt', label: 'tom-b' }, { s: 'mt', label: 'tom-m' }, { s: 'ht', label: 'tom-a' },
  { s: 'cb', label: 'cowbell' }, { s: 'cr', label: 'crash' }, { s: 'rd', label: 'ride' },
];
// PERCUSIÓN VIVA de los packs cargados (crate/vcsl, prebake) — la capa latina que
// separa amateur de pro en dancehall/dembow. Son nombres ABSOLUTOS: quedan exentos
// del banco de la rejilla (bankExempt) para que el prefijo no los silencie.
const PERC_PALETTE: { s: string; label: string }[] = [
  { s: 'crate_conga', label: 'conga' }, { s: 'crate_bongo', label: 'bongo' },
  { s: 'crate_sh', label: 'shaker' }, { s: 'crate_clave', label: 'clave' },
  { s: 'crate_block', label: 'block' }, { s: 'crate_djembe', label: 'djembe' },
  { s: 'crate_bell', label: 'campana' }, { s: 'crate_stick', label: 'stick' },
  { s: 'conga', label: 'conga vcsl' }, { s: 'bongo', label: 'bongo vcsl' },
  { s: 'darbuka', label: 'darbuka' }, { s: 'sh', label: 'shaker 808' },
];

// Rejilla sobre UN patrón plano. `wrap` (opcional) re-envuelve el código emitido antes
// de guardarlo en el nodo — lo usa el modo SECCIONES para empalmar el brazo editado
// dentro del arrange sin tocar el resto. `seedFrom` (opcional): si el código no tiene
// pistas (sección en silencio), la rejilla SIEMBRA las pistas de esa referencia con
// cero pasos — ves la instrumentación de siempre y pintar entra al instante.
// `previewCode` (opcional, modo secciones): al activar ▶, este patrón (el brazo que se
// edita) suena EN LOOP al instante — sin esperar a que el arreglo llegue a la sección.
// `headOff`: apaga el playhead cuando la sección editada no es la que está sonando.
function StepGrid({ id, code, wrap, seedFrom, previewCode, headOff }: { id: string; code: string; wrap?: (c: string) => string; seedFrom?: string; previewCode?: string; headOff?: boolean }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const cps = useGraphStore((s) => s.cps); // para mostrar el timing por paso en ms
  const emit = (c: string) => update(id, { code: wrap ? wrap(c) : c });
  const parsed = useMemo(() => parseSeq(code), [code]);
  const seeded = useMemo(() => {
    if (!seedFrom) return null;
    const p = parseSeq(seedFrom);
    if (!p || p.complex || !p.lanes.length) return null;
    return { lanes: p.lanes.map((l) => ({ ...l, steps: l.steps.map(() => 0) })), steps: p.steps };
  }, [seedFrom]);
  // sin pasos activos en el código pero con referencia → arranca sembrado (cubre la
  // rejilla vacía s("~") y la melodía toda en silencio: las notas vienen de la ref).
  const useSeed = () => !!(seeded && parsed && !parsed.complex && parsed.lanes.every((l) => l.steps.every((v) => v <= 0)));
  const [steps, setSteps] = useState(() => (useSeed() ? seeded!.steps : parsed?.steps || 8));
  const [lanes, setLanes] = useState<Lane[]>(() => (useSeed() ? seeded!.lanes : parsed?.lanes ?? []));
  const [head, setHead] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState(false);
  const [pitchOpen, setPitchOpen] = useState<Record<string, boolean>>({});
  const [grooveOpen, setGrooveOpen] = useState<Record<string, boolean>>({}); // groove abierto por pista (A5)
  const [scaleName, setScaleName] = useState('off'); // escala para el scale-lock ('off' = libre)
  const [scaleRoot, setScaleRoot] = useState(0); // tónica de la escala (0 = C)
  const [chord, setChord] = useState('nota'); // acorde por paso al afinar ('nota' = sin acorde)
  const drawing = useRef<number | null>(null); // valor que se está pintando (0 o NORMAL)
  const dragPitch = useRef<{ li: number; si: number; startY: number; startMidi: number } | null>(null); // arrastre de pitch activo
  const dragBar = useRef<'vel' | 'nudge' | null>(null); // arrastre en las sub-filas del panel ≋ (DEBE ir aquí: lo usa el useEffect de pointerup de abajo — antes se declaraba más tarde y crasheaba con TDZ)
  const [saved, setSaved] = useState(false); // pulso "en vivo": cada cambio se guarda y suena al instante
  const savedT = useRef<number | undefined>(undefined);
  const pulseSaved = () => { setSaved(true); clearTimeout(savedT.current); savedT.current = window.setTimeout(() => setSaved(false), 700); };
  const bank = parsed?.bank || '';
  // audición: los sonidos exentos (packs) NO llevan el banco de la rejilla (el prefijo
  // apuntaría a un sample inexistente y no sonaría nada al probarlos); una pista con
  // caja PROPIA (P2.2) se audiciona con ella.
  const hitBank = (snd: string) => {
    if (bankExempt(snd)) return '';
    const lane = lanes.find((x) => x.sound === snd);
    return (lane && laneOwnBank(lane)) || bank;
  };

  // resincroniza el estado local si el código cambia por fuera (no en complejo);
  // sin pasos activos + referencia de siembra → mantiene la instrumentación sembrada.
  useEffect(() => {
    if (parsed && !parsed.complex) {
      if (useSeed()) { setLanes(seeded!.lanes); setSteps(seeded!.steps); }
      else { setLanes(parsed.lanes); setSteps(parsed.steps); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, seeded]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = getScheduler()?.now?.();
      // headOff: la sección que se edita NO es la que suena → sin playhead (marcaría
      // pasos que no corresponden a lo que se oye). En preview (loop de la sección) sí.
      setHead(typeof now === 'number' && !(headOff && !preview) ? Math.floor((((now % 1) + 1) % 1) * steps) % steps : -1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [steps, headOff, preview]);
  useEffect(() => {
    const up = () => { drawing.current = null; dragPitch.current = null; dragBar.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // preview: aísla este source (solo) y reproduce. El ESPACIO global reproduce/para
  // el transporte, así que con el source aislado el espacio ya previsualiza sin conflicto.
  // En modo SECCIONES (previewCode) además el compilador toca ESE brazo en loop →
  // escuchas la sección editada al instante, sin esperar a que el arreglo la alcance.
  const togglePreview = () => {
    const s = useGraphStore.getState();
    const next = !preview;
    setPreview(next);
    s.updateNodeData(id, { solo: next, seqPreviewCode: next && previewCode ? previewCode : undefined });
    if (next && !s.playing) void s.play();
  };
  // con ▶ activo, cambiar de sección (o editarla) refresca la audición al brazo actual.
  useEffect(() => {
    if (preview && previewCode) useGraphStore.getState().updateNodeData(id, { seqPreviewCode: previewCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCode]);
  // al cerrar el panel, quita el aislado (solo) y la audición de sección del preview.
  useEffect(() => () => { if (preview) useGraphStore.getState().updateNodeData(id, { solo: false, seqPreviewCode: undefined }); }, [id, preview]);

  if (!parsed) return <p className="seqs-none nodrag">este source no tiene un patrón <code>s("…")</code> editable en rejilla</p>;
  if (parsed.complex) {
    return (
      <div className="seqs nodrag" onPointerDown={(e) => e.stopPropagation()}>
        <p className="seqs-none">patrón avanzado: usa secciones <code>arrange(…)</code>, melodía <code>note(…)</code>, alternancia <code>&lt;a b&gt;</code>, euclídeo <code>(3,8)</code> u otra estructura que no cabe en una rejilla fija. Tu patrón <b>sigue sonando igual</b> (la rejilla no lo toca). Para editarlo aquí puedes empezar una rejilla nueva:</p>
        <button className="seqs-norm" onClick={() => { const base = parsed.lanes[0]?.sound || 'bd'; emit(buildSeq(parsed, [{ sound: base, steps: Array(8).fill(0), notes: Array(8).fill(null), ratchet: Array(8).fill(1), prob: Array(8).fill(1) }], 8)); }}>empezar rejilla de 8 pasos (reemplaza el patrón)</button>
      </div>
    );
  }

  const commit = (nl: Lane[], ns = steps) => { emit(buildSeq(parsed, nl, ns)); pulseSaved(); };
  // A8 — cambia la caja de ritmos (.bank) de TODA la rejilla; re-emite con el banco nuevo.
  const setBank = (b: string) => { emit(buildSeq({ ...parsed, bank: b }, lanes, steps)); pulseSaved(); };
  const paint = (li: number, si: number, val: number) => {
    const nl = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((v, j) => (j === si ? val : v)) } : l));
    setLanes(nl); commit(nl);
    if (val > 0) void playDrumHit(lanes[li].sound, hitBank(lanes[li].sound), lanes[li].notes[si] ?? undefined, 0.5, 0.9 * val);
  };
  // clic derecho en celda ENCENDIDA: cicla el nivel de velocity (normal→acento→ghost).
  const cycleLevel = (li: number, si: number) => {
    const cur = lanes[li].steps[si];
    if (cur <= 0) return;
    const nv = nextLevel(cur);
    const nl = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((v, j) => (j === si ? nv : v)) } : l));
    setLanes(nl); commit(nl);
    void playDrumHit(lanes[li].sound, hitBank(lanes[li].sound), lanes[li].notes[si] ?? undefined, 0.5, 0.9 * nv);
  };
  // shift+clic en celda encendida: cicla el RATCHET (roll/tresillo) 1→2→3→4 → hh*n.
  const cycleRatchet = (li: number, si: number) => {
    if (lanes[li].steps[si] <= 0) return;
    const cur = lanes[li].ratchet[si] || 1;
    const RATCHETS = [1, 2, 3, 4];
    const nv = RATCHETS[(RATCHETS.indexOf(cur) + 1) % RATCHETS.length] ?? 1;
    const nl = lanes.map((l, i) => (i === li ? { ...l, ratchet: l.ratchet.map((v, j) => (j === si ? nv : v)) } : l));
    setLanes(nl); commit(nl);
    void playDrumHit(lanes[li].sound, hitBank(lanes[li].sound), lanes[li].notes[si] ?? undefined, 0.5, 0.85);
  };
  // alt+clic en celda encendida: cicla la PROBABILIDAD 100→75→50→25% → hh?p (variación viva).
  const cycleProb = (li: number, si: number) => {
    if (lanes[li].steps[si] <= 0) return;
    const cur = lanes[li].prob?.[si] ?? 1;
    const PROBS = [1, 0.75, 0.5, 0.25];
    const idx = PROBS.findIndex((p) => Math.abs(p - cur) < 0.01);
    const nv = PROBS[(idx + 1) % PROBS.length];
    const nl = lanes.map((l, i) => (i === li ? { ...l, prob: l.prob.map((v, j) => (j === si ? nv : v)) } : l));
    setLanes(nl); commit(nl);
    void playDrumHit(lanes[li].sound, hitBank(lanes[li].sound), lanes[li].notes[si] ?? undefined, 0.5, 0.9);
  };
  const addLane = (snd: string) => {
    setAdding(false);
    if (lanes.some((l) => l.sound === snd)) return;
    const nl = [...lanes, { sound: snd, steps: Array(steps).fill(0), notes: Array(steps).fill(null), ratchet: Array(steps).fill(1), prob: Array(steps).fill(1) }];
    setLanes(nl);
    void playDrumHit(snd, hitBank(snd));
  };
  const removeLane = (li: number) => { const nl = lanes.filter((_, i) => i !== li); setLanes(nl); commit(nl); };
  const setStepCount = (n: number) => {
    const c = Math.max(2, Math.min(32, n));
    const nl = lanes.map((l) => {
      const s = l.steps.slice(0, c); while (s.length < c) s.push(0);
      const nt = l.notes.slice(0, c); while (nt.length < c) nt.push(null);
      const rt = l.ratchet.slice(0, c); while (rt.length < c) rt.push(1);
      const pr = (l.prob ?? []).slice(0, c); while (pr.length < c) pr.push(1);
      const nu = l.nudge ? l.nudge.slice(0, c) : undefined; if (nu) while (nu.length < c) nu.push(0);
      return { ...l, steps: s, notes: nt, ratchet: rt, prob: pr, nudge: nu };
    });
    setLanes(nl); setSteps(c); commit(nl, c);
  };
  // afinar/desafinar una pista: al activar, cada paso encendido toma DEFAULT_NOTE (y se
  // abre la sub-fila de pitch); al desactivar, se limpian las notas → idéntico a hoy.
  const togglePitch = (li: number) => {
    const l = lanes[li];
    const pitched = lanePitched(l, steps);
    const nl = lanes.map((x, i) => (i === li
      ? { ...x, notes: x.steps.map((v, j) => (pitched ? null : (v > 0 ? (x.notes[j] || DEFAULT_NOTE) : null))) }
      : x));
    setLanes(nl); commit(nl);
    setPitchOpen((o) => ({ ...o, [l.sound]: !pitched }));
  };
  // "afinar todo": iguala TODOS los pasos activos de la pista a una MISMA nota (la del
  // primer paso afinado, o c3). Rápido para un bajo/instrumento a un solo tono.
  const tuneAll = (li: number) => {
    const l = lanes[li];
    const ref = l.notes.find((v, j) => l.steps[j] > 0 && !!v) || DEFAULT_NOTE;
    const nl = lanes.map((x, i) => (i === li ? { ...x, notes: x.steps.map((v) => (v > 0 ? ref : null)) } : x));
    setLanes(nl); commit(nl);
  };
  // groove por pista (A5): swing y humanize 0..1. Cambia con throttle del store (arrastre = 1 swap).
  const setGroove = (li: number, key: 'swing' | 'human', v: number) => {
    const nl = lanes.map((l, i) => (i === li ? { ...l, [key]: v } : l));
    setLanes(nl); commit(nl);
  };
  const clearGroove = (li: number) => {
    const nl = lanes.map((l, i) => (i === li ? { ...l, swing: 0, human: 0, nudge: undefined } : l));
    setLanes(nl); commit(nl);
  };
  // P1.5 — VELOCITY CONTINUA por paso (arrastre vertical en el panel ≋): escribe el
  // valor exacto en el .gain("…") de la pista (la percusión viva no tiene 3 niveles).
  const setVelAt = (li: number, si: number, clientY: number, el: HTMLElement) => {
    if (lanes[li].steps[si] <= 0) return; // solo pasos activos
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    const v = Math.round(Math.max(0.05, t * 1.5) * 100) / 100;
    const nl = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((x, j) => (j === si ? v : x)) } : l));
    setLanes(nl); commit(nl);
  };
  // P1.2 — MICRO-TIMING por paso (push/pull del pocket): arrastre vertical centrado —
  // abajo = atrás (late +), arriba = adelanta (−). Snap a 0 cerca del centro.
  const setNudgeAt = (li: number, si: number, clientY: number, el: HTMLElement) => {
    if (lanes[li].steps[si] <= 0) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientY - r.top) / r.height)); // 0 arriba .. 1 abajo
    let v = (t - 0.5) * 2 * NUDGE_MAX;
    if (Math.abs(v) < 0.0015) v = 0; // imán al grid
    v = Math.round(v * 1000) / 1000;
    const nl = lanes.map((l, i) => (i === li ? { ...l, nudge: (l.nudge ?? Array(steps).fill(0)).map((x, j) => (j === si ? v : x)) } : l));
    setLanes(nl); commit(nl);
  };
  // afinar por paso: CLIC + ARRASTRE VERTICAL relativo (tipo perilla). Con captura de
  // puntero se arrastra libremente arriba/abajo y el pitch sube/baja fluido. scale-lock engancha.
  const setNoteAt = (li: number, si: number, nn: string) => {
    if (lanes[li].notes[si] === nn) return;
    const nl = lanes.map((l, i) => (i === li ? { ...l, notes: l.notes.map((v, j) => (j === si ? nn : v)) } : l));
    setLanes(nl); commit(nl);
  };
  const clampMidi = (m: number) => Math.max(PITCH_LO, Math.min(PITCH_LO + PITCH_RANGE, m));
  const startPitchDrag = (li: number, si: number, e: React.PointerEvent) => {
    if (lanes[li].steps[si] <= 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragPitch.current = { li, si, startY: e.clientY, startMidi: noteToMidi(chordRoot(lanes[li].notes[si] || DEFAULT_NOTE)) ?? PITCH_LO + 12 };
    void playDrumHit(lanes[li].sound, hitBank(lanes[li].sound), lanes[li].notes[si] ?? DEFAULT_NOTE, 0.35, 0.7);
  };
  const movePitchDrag = (clientY: number) => {
    const d = dragPitch.current; if (!d) return;
    let midi = clampMidi(d.startMidi + Math.round((d.startY - clientY) / PX_PER_SEMI));
    if (scaleName !== 'off') midi = snapToScale(midi, scaleRoot, scaleName);
    setNoteAt(d.li, d.si, buildChord(midi, chord, scaleRoot, scaleName));
  };

  const laneLabel = (snd: string) => PALETTE.find((p) => p.s === snd)?.label ?? PERC_PALETTE.find((p) => p.s === snd)?.label ?? snd;
  const lvlClass = (v: number) => (v <= 0 ? '' : Math.abs(v - ACCENT) < 0.01 ? ' on accent' : Math.abs(v - GHOST) < 0.01 ? ' on ghost' : ' on');

  return (
    <div className="seqs nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seqs-ctl">
        <button className={`seqs-play${preview ? ' on' : ''}`} onClick={togglePreview} title="aislar y previsualizar este source (luego ESPACIO reproduce/para)">{preview ? '◉' : '▶'}</button>
        <span className="seqs-tag">secuenciador</span>
        <span className={`seqs-saved${saved ? ' on' : ''}`} title="edición en vivo: cada cambio se guarda en el source y suena al instante — no hay que guardar aparte">● en vivo</span>
        <label className="seqs-bank" title="caja de ritmos: cambia el banco de samples de toda la rejilla (808/909/LinnDrum… — 30 de las 71 disponibles). «defecto» = banco base.">
          <span>caja</span>
          <select className="nodrag" value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">defecto</option>
            {bank && !DRUM_MACHINES.includes(bank) && <option value={bank}>{bank}</option>}
            {DRUM_MACHINES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <div className="seqs-steps">
          <button onClick={() => setStepCount(steps - 1)} title="menos pasos">−</button>
          <b>{steps}<i>pasos</i></b>
          <button onClick={() => setStepCount(steps + 1)} title="más pasos">+</button>
        </div>
        {lanes.some((l) => lanePitched(l, steps)) && (
          <div className="seqs-scale" title="scale-lock: al arrastrar ↕ para afinar, las notas se quedan en esta tonalidad (no se desafinan). «libre» = sin bloqueo.">
            <span>escala</span>
            <select className="nodrag" value={scaleRoot} onChange={(e) => setScaleRoot(Number(e.target.value))}>{ROOTS.map((r, i) => <option key={i} value={i}>{r}</option>)}</select>
            <select className="nodrag" value={scaleName} onChange={(e) => setScaleName(e.target.value)}><option value="off">libre</option>{Object.keys(SCALES).map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <span>acorde</span>
            <select className="nodrag" value={chord} onChange={(e) => setChord(e.target.value)} title="acorde por paso: al afinar arrastrando, cada nota suena como este acorde (5ª/octava/tríada, para stabs y pads)">{CHORDS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </div>
        )}
      </div>

      <LiveScope nodeId={id} height={36} />

      <div className="seqs-lanes">
        {lanes.map((l, li) => {
          const pitched = lanePitched(l, steps);
          const open = pitched || pitchOpen[l.sound];
          return (
            <div className="seqs-lane" key={l.sound}>
              <button className="seqs-name" onClick={() => void playDrumHit(l.sound, hitBank(l.sound))} title={`escuchar ${laneLabel(l.sound)}`}>
                <span className="seqs-nl">{laneLabel(l.sound)}</span>
                <span className={`seqs-pitchtog${pitched ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); togglePitch(li); }} title="afinar por paso (pista melódica): 808 afinado, cowbell melódico">♪</span>
                <span className={`seqs-pitchtog${laneGroove(l) ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); setGrooveOpen((o) => ({ ...o, [l.sound]: !o[l.sound] })); }} title="groove: swing (balanceo) + humanize (micro-timing) de esta pista">≋</span>
                <span className="seqs-rm" onClick={(e) => { e.stopPropagation(); removeLane(li); }} title="quitar pista">×</span>
              </button>
              <div className="seqs-lane-body">
                <div className="seqs-row" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
                  {l.steps.slice(0, steps).map((v, si) => (
                    <button
                      key={si}
                      className={`seqs-cell${lvlClass(v)}${si === head ? ' play' : ''}${si % 4 === 0 ? ' beat' : ''}${v > 0 && (l.prob?.[si] ?? 1) < 0.999 ? ' prob' : ''}`}
                      onPointerDown={(e) => { if (e.shiftKey && v > 0) { cycleRatchet(li, si); return; } if (e.altKey && v > 0) { cycleProb(li, si); return; } const nv = v > 0 ? 0 : NORMAL; drawing.current = nv; paint(li, si, nv); }}
                      onPointerEnter={() => { if (drawing.current != null) paint(li, si, drawing.current); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); cycleLevel(li, si); }}
                      title={`${laneLabel(l.sound)} · paso ${si + 1}${v > 0 ? ` · ${Math.abs(v - ACCENT) < 0.01 ? 'acento' : Math.abs(v - GHOST) < 0.01 ? 'ghost' : 'normal'}${l.ratchet[si] > 1 ? ` · roll x${l.ratchet[si]}` : ''}${(l.prob?.[si] ?? 1) < 0.999 ? ` · ${Math.round(l.prob[si] * 100)}%` : ''} (clic der. = vel · shift+clic = roll · alt+clic = probabilidad)` : ''}`}
                    >
                      {v > 0 && l.ratchet[si] > 1 && <span className="seqs-ratch">{l.ratchet[si]}</span>}
                      {v > 0 && (l.prob?.[si] ?? 1) < 0.999 && <span className="seqs-prob">{Math.round(l.prob[si] * 100)}</span>}
                    </button>
                  ))}
                </div>
                {open && (
                  <>
                  <div className="seqs-pitch-h"><span>↕ afinar cada paso</span><span className="seqs-pitch-btns"><button className="seqs-pitch-x" onClick={() => tuneAll(li)} title="afinar TODO el instrumento en la misma nota (la del primer paso afinado)">afinar todo</button><button className="seqs-pitch-x" onClick={() => togglePitch(li)} title="salir del afinador (volver a percusión)">✕ salir</button></span></div>
                  <div className="seqs-pitch" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
                    {l.steps.slice(0, steps).map((v, si) => {
                      const on = v > 0;
                      const nn = l.notes[si] || DEFAULT_NOTE;
                      const midi = on ? (noteToMidi(chordRoot(nn)) ?? PITCH_LO) : PITCH_LO;
                      const t = Math.max(0, Math.min(1, (midi - PITCH_LO) / PITCH_RANGE));
                      return (
                        <div
                          key={si}
                          className={`seqs-pcell${on ? '' : ' rest'}${si % 4 === 0 ? ' beat' : ''}`}
                          onPointerDown={(e) => startPitchDrag(li, si, e)}
                          onPointerMove={(e) => movePitchDrag(e.clientY)}
                          onPointerUp={() => { dragPitch.current = null; }}
                          title={on ? `nota paso ${si + 1}: ${nn} · clic y arrastra ↕ para afinar` : ''}
                        >
                          {on && <><span className="seqs-pfill" style={{ height: `${Math.max(8, t * 100)}%` }} /><span className="seqs-pname">{chordRoot(nn)}{nn.startsWith('[') ? '▴' : ''}</span></>}
                        </div>
                      );
                    })}
                  </div>
                  </>
                )}
                {grooveOpen[l.sound] && (
                  <>
                  <div className="seqs-groove">
                    <MiniSlider label="swing" value={l.swing ?? 0} min={0} max={1} step={0.02} onChange={(v) => setGroove(li, 'swing', v)} />
                    <MiniSlider label="human" value={l.human ?? 0} min={0} max={1} step={0.02} onChange={(v) => setGroove(li, 'human', v)} />
                    {/* P2.2 — caja PROPIA de esta pista: kick 808 + caja LinnDrum en la misma rejilla */}
                    <label className="seqs-lanebank" title={bankExempt(l.sound) ? 'sonido de pack: no usa cajas de ritmos (el prefijo lo silenciaría)' : 'caja SOLO de esta pista (override): mezcla máquinas en la misma rejilla. «rejilla» = hereda el banco general.'}>
                      <span>caja</span>
                      <select
                        className="nodrag"
                        value={laneOwnBank(l)}
                        disabled={bankExempt(l.sound)}
                        onChange={(e) => { const nl = lanes.map((x, i) => (i === li ? withLaneBank(x, e.target.value) : x)); setLanes(nl); commit(nl); }}
                      >
                        <option value="">rejilla{bank ? ` (${bank})` : ''}</option>
                        {DRUM_MACHINES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </label>
                    <button className="seqs-pitch-x" onClick={() => clearGroove(li)} title="quitar groove, vel y timing de esta pista">✕</button>
                  </div>
                  {/* P1.5 — velocity CONTINUA por paso (arrastra ↕; escribe el valor exacto) */}
                  <div className="seqs-bars" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }} title="vel: volumen exacto por paso — arrastra ↕ (la percusión viva no tiene 3 niveles)">
                    <span className="seqs-bars-tag">vel</span>
                    {l.steps.slice(0, steps).map((v, si) => (
                      <div
                        key={si}
                        className={`seqs-bar${v > 0 ? '' : ' rest'}${si % 4 === 0 ? ' beat' : ''}`}
                        onPointerDown={(e) => { dragBar.current = 'vel'; setVelAt(li, si, e.clientY, e.currentTarget); }}
                        onPointerEnter={(e) => { if (dragBar.current === 'vel') setVelAt(li, si, e.clientY, e.currentTarget); }}
                        title={v > 0 ? `vel paso ${si + 1}: ${v}` : ''}
                      >
                        {v > 0 && <span className="seqs-bar-fill" style={{ height: `${Math.max(6, Math.min(100, (v / 1.5) * 100))}%` }} />}
                      </div>
                    ))}
                  </div>
                  {/* P1.2 — micro-timing por paso: el pocket (abajo = atrás · arriba = adelanta) */}
                  <div className="seqs-bars nudge" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }} title="timing: empuja/arrastra cada golpe — abajo = atrás (late), arriba = adelanta. El pocket determinista.">
                    <span className="seqs-bars-tag">timing</span>
                    {l.steps.slice(0, steps).map((v, si) => {
                      const nu = l.nudge?.[si] ?? 0;
                      const ms = Math.round((nu / Math.max(0.05, cps)) * 1000);
                      return (
                        <div
                          key={si}
                          className={`seqs-bar${v > 0 ? '' : ' rest'}${si % 4 === 0 ? ' beat' : ''}`}
                          onPointerDown={(e) => { dragBar.current = 'nudge'; setNudgeAt(li, si, e.clientY, e.currentTarget); }}
                          onPointerEnter={(e) => { if (dragBar.current === 'nudge') setNudgeAt(li, si, e.clientY, e.currentTarget); }}
                          title={v > 0 ? `timing paso ${si + 1}: ${ms > 0 ? `+${ms} ms (atrás)` : ms < 0 ? `${ms} ms (adelanta)` : 'en el grid'}` : ''}
                        >
                          {v > 0 && <span className={`seqs-bar-dot${Math.abs(nu) > 0.0005 ? ' on' : ''}`} style={{ top: `${Math.max(4, Math.min(92, ((nu + NUDGE_MAX) / (2 * NUDGE_MAX)) * 100 - 4))}%` }} />}
                        </div>
                      );
                    })}
                  </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="seqs-add">
        <button className="seqs-addbtn" onClick={() => setAdding((a) => !a)}>+ añadir sonido</button>
        {adding && (
          <div className="seqs-palette">
            {PALETTE.filter((p) => !lanes.some((l) => l.sound === p.s)).map((p) => (
              <button key={p.s} onClick={() => addLane(p.s)} title={`añadir ${p.label}`}>{p.label}</button>
            ))}
            <span className="seqs-pal-sep" title="percusión viva de los packs (crate/vcsl): la capa latina del riddim. No usan el banco de la rejilla.">percusión</span>
            {PERC_PALETTE.filter((p) => !lanes.some((l) => l.sound === p.s)).map((p) => (
              <button key={p.s} className="perc" onClick={() => addLane(p.s)} title={`añadir ${p.label} (${p.s})`}>{p.label}</button>
            ))}
            <input
              className="seqs-pal-input nodrag"
              placeholder="otro sample… ⏎"
              title="añade CUALQUIER sample por nombre (packs cargados, importados, descargados). Enter para añadir; el botón de la pista lo pre-escucha."
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const el = e.target as HTMLInputElement;
                const v = el.value.trim().replace(/[^\w:]/g, '');
                if (v) { addLane(v); el.value = ''; }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// SECUENCIADOR por source (P0.3 — secciones): si el código es un
// arrange([compases, patrón], …) — las demos arregladas, el copiloto IA — muestra
// PESTAÑAS de sección y edita el brazo elegido con la rejilla o el piano roll
// normales. El guardado es un empalme textual por spans (spliceArm): solo cambian
// los bytes del brazo editado — las demás secciones quedan intactas. Sin arrange,
// rejilla directa como siempre.
export function StepSeq({ id, code }: { id: string; code: string }) {
  const arms = useMemo(() => splitArrange(code), [code]);
  // arranca en la primera sección CON contenido (no en un silencio inicial: abrir el
  // editor debe mostrar el instrumento "de la forma habitual", listo para tocar).
  const [sec, setSec] = useState(() => {
    const i = arms ? arms.findIndex((a) => a.code.trim() !== 'silence') : 0;
    return i >= 0 ? i : 0;
  });
  // VISTA para melodías: la REJILLA (pasos + afinar arrastrando + «afinar todo») es la
  // por defecto — el flujo preferido del usuario en todas partes; el piano roll queda
  // como disposición alternativa del MISMO código (toggle).
  const [view, setView] = useState<'grid' | 'roll'>('grid');
  // qué sección está SONANDO ahora en el arreglo (punto en la pestaña): posición del
  // reloj módulo el total de compases del arrange → el "entra después" se VE.
  const [live, setLive] = useState(-1);
  useEffect(() => {
    if (!arms) return;
    const total = arms.reduce((s, a) => s + Math.max(1, a.bars), 0) || 1;
    let raf = 0;
    const tick = () => {
      const now = getScheduler()?.now?.();
      if (typeof now === 'number') {
        const pos = ((now % total) + total) % total;
        let acc = 0, idx = arms.length - 1;
        for (let i = 0; i < arms.length; i++) { acc += Math.max(1, arms[i].bars); if (pos < acc) { idx = i; break; } }
        setLive(idx);
      } else setLive(-1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [arms]);
  // editor de un código dado: toggle rejilla/piano roll cuando es melódico. SIN key
  // por sección: cambiar de pestaña NO remonta el editor → el ▶ (audición de sección)
  // sigue activo y salta a oír la sección elegida al instante.
  const editorFor = (c: string, wrapFn?: (x: string) => string, seedFrom?: string, previewCode?: string, headOff?: boolean) => {
    const melodic = isMelodicCode(c);
    return (
      <>
        {melodic && (
          <div className="seqs-sectabs seqs-viewtabs">
            <span className="seqs-sectag" title="misma melodía, dos disposiciones: la rejilla afina cada paso arrastrando ↕ (con «afinar todo», escala y acorde); el piano roll coloca notas sobre el teclado.">vista</span>
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title="rejilla de pasos: afinar arrastrando ↕ · afinar todo · escala/acorde · rolls · probabilidad">▦ rejilla</button>
            <button className={view === 'roll' ? 'on' : ''} onClick={() => setView('roll')} title="piano roll: notas sobre el teclado · vel/dur · slide 808">🎹 piano roll</button>
          </div>
        )}
        {melodic && view === 'roll'
          ? <MelodicSeq id={id} code={c} wrap={wrapFn} previewCode={previewCode} headOff={headOff} />
          : <StepGrid id={id} code={c} wrap={wrapFn} seedFrom={seedFrom} previewCode={previewCode} headOff={headOff} />}
      </>
    );
  };
  // ediciones ESTRUCTURALES del arrange (compases/duplicar/añadir/quitar): van al
  // código completo del nodo, no a un brazo.
  const emitFull = (c: string) => useGraphStore.getState().updateNodeData(id, { code: c });
  if (!arms) {
    // patrón plano: chip para CONVERTIRLO en secciones (2×4 compases sembradas con el
    // patrón actual → suena idéntico; luego editas cada sección en pestañas).
    const convert = (
      <div className="seqs-sectabs seqs-viewtabs">
        <span className="seqs-sectag" title="arregla este instrumento por SECCIONES (intro/verso/drop): se crean 2 secciones de 4 compases con el patrón actual — suena igual — y editas cada una en su pestaña.">secciones</span>
        <button onClick={() => { emitFull(wrapAsArrange(code, [4, 4])); setSec(1); }} title="crear 2 secciones de 4 compases con este patrón (suena igual; edita la 2ª como variación)">＋ crear</button>
      </div>
    );
    return (
      <div className="seqs-secs nodrag" onPointerDown={(e) => e.stopPropagation()}>
        {convert}
        {editorFor(code)}
      </div>
    );
  }
  const k = Math.min(sec, arms.length - 1);
  const arm = arms[k];
  const wrap = (c: string) => spliceArm(code, arm, c);
  const silent = arm.code.trim() === 'silence';
  const headOff = live >= 0 && live !== k; // lo que suena no es lo que editas → sin playhead
  // sección en silencio → se SIEMBRA con la instrumentación de la sección de
  // referencia (primer brazo con patrón): mismas pistas / mismo instrumento, pasos
  // vacíos. Pre-escuchas al instante y pintar hace entrar el instrumento aquí.
  const ref = silent ? arms.find((a) => a.code.trim() !== 'silence') : undefined;
  const seed = ref ? seedSilent(ref.code) : null;
  return (
    <div className="seqs-secs nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seqs-sectabs">
        <span className="seqs-sectag" title="este instrumento está ARREGLADO por secciones (arrange): cada pestaña es una sección de N compases. Editas la sección activa (las demás no se tocan); el punto marca la que SUENA ahora. Con ▶ escuchas la sección editada en loop, al instante.">secciones</span>
        {arms.map((a, i) => (
          <button
            key={i}
            className={`${i === k ? 'on' : ''}${i === live ? ' live' : ''}`}
            onClick={() => setSec(i)}
            title={`sección ${i + 1}: ${fmt(a.bars)} compases${a.code.trim() === 'silence' ? ' · en silencio (pinta pasos y el instrumento entra aquí)' : ''}${i === live ? ' · SONANDO ahora en el arreglo' : ''}`}
          >
            {i + 1}<i>·{fmt(a.bars)}c</i>
          </button>
        ))}
        {/* gestión de la sección activa: compases ± · duplicar · añadir silencio · quitar */}
        <span className="seqs-secops">
          <button onClick={() => emitFull(setArmBars(code, arm, arm.bars - 1))} title="menos compases en esta sección">−</button>
          <b>{fmt(arm.bars)}<i>c</i></b>
          <button onClick={() => emitFull(setArmBars(code, arm, arm.bars + 1))} title="más compases en esta sección">＋</button>
          <button onClick={() => { emitFull(duplicateArm(code, arm)); setSec(k + 1); }} title="duplicar esta sección justo después (edita la copia como variación)">⧉</button>
          <button onClick={() => { emitFull(addSilentArm(code, arms[arms.length - 1])); setSec(arms.length); }} title="añadir una sección EN SILENCIO al final (4 compases)">✚</button>
          <button
            disabled={arms.length <= 1}
            onClick={() => { const c2 = removeArm(code, arms, k); if (c2) { emitFull(c2); setSec(Math.max(0, k - 1)); } }}
            title={arms.length <= 1 ? 'es la única sección' : 'quitar esta sección (su patrón se pierde)'}
          >
            ×
          </button>
        </span>
      </div>
      {silent && !seed ? (
        <p className="seqs-none">todas las secciones están en silencio (o la referencia no es editable): edita el patrón de otra sección primero.</p>
      ) : silent && seed ? (
        <>
          <p className="seqs-seedline">sección en silencio — pinta pasos o notas y el instrumento <b>entra aquí</b> (instrumentación de la sección con patrón)</p>
          {editorFor(seed.code, wrap, seed.seedFrom, arm.code, headOff)}
        </>
      ) : (
        editorFor(arm.code, wrap, undefined, arm.code, headOff)
      )}
    </div>
  );
}
