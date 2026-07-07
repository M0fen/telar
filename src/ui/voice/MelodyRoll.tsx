import { useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceParams } from '../../graph/types';
import { VOICE_SCALES } from '../../graph/types';
import { MiniSlider } from '../../nodes/MiniSlider';
import { PC_FLAT, ACCIDENTAL, SCALE_STEPS, scaleName, midiToName, noteToMidi, NATURAL_MIDI } from './voiceUtils';

// `note` = nombre de nota que se pasa al motor para audicionar/afinar ese pitch
// (transpone el sample: transpose = midi(note) − 36). Coherente con el compilador.
interface Row { val: string; label: string; sub: string; acc: boolean; root: boolean; nat: boolean; note: string }

// Piano roll monofónico: cada columna = un paso (nota o silencio). En modo escala
// las filas son GRADOS (autotune); sin escala son notas cromáticas (2 octavas).
// `audition(note, force)` suena la voz PROCESADA a ese pitch (idéntica al resultado):
// al poner/dibujar una nota (si `live`) y SIEMPRE al pulsar la tecla (force) para probar.
export function MelodyRoll({ melody, scale, onMelody, onScale, audition, onPlay }: {
  melody: string; scale: string; onMelody: (m: string) => void; onScale: (s: string) => void; audition: (note: string, force?: boolean) => void; onPlay: () => void;
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
        <button className="vs-roll-play" onClick={onPlay} title="reproducir la melodía COMPLETA (la voz cantándola) — preview, no toca el transporte">▶ melodía</button>
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

// Sección "melodía · sampler": el piano roll + armonía + autotune suave (glide/vibrato).
// Presentacional — el estado (voice params) vive en VoiceStudio.
export function MelodySection({ v, melodic, set, audition, onPlayMelody }: {
  v: VoiceParams; melodic: boolean; set: (patch: Partial<VoiceParams>) => void; audition: (note: string, force?: boolean) => void; onPlayMelody: () => void;
}) {
  return (
    <div className="vs-sec">
      <h4>melodía · sampler <span className="vs-h4sub">(la voz canta notas)</span></h4>
      <MelodyRoll
        melody={v.melody ?? ''}
        scale={v.scale ?? ''}
        onMelody={(m) => set({ melody: m })}
        onScale={(s) => set({ scale: s })}
        audition={audition}
        onPlay={onPlayMelody}
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
  );
}
