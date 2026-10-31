import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useTrackColorStore } from '../store/useTrackColorStore';
import { useMidiStore } from '../store/useMidiStore';
import { armPadRec, capturePads, padHit, setPadRec, usePadRecStore } from '../audio/padRecorder';
import { getWaveInfo, drawWave } from '../audio/waveformPeaks';
import { mapName, resolveSoundKey, soundAlternatives, type SoundAlt } from '../audio/padSounds';
import { drumPadMap, PADS } from '../lib/padRecord';
import { editLaneEverywhere, laneOf } from '../lib/padEdit';
import { buildPadFx, CUT_GROUPS, DECAY_MAX, hatPair, parsePadFx, type PadFx } from '../lib/padFx';
import { laneOwnBank, parseSeq, withLaneBank } from './stepseqCode';
import { heardPatternTime, type ArmPos } from './patternClock';
import { Knob } from '../ui/Knob';
import { toast } from '../store/useNotifyStore';

// PADS DE BATERÍA (Fase 9.7) — en el panel de detalle, la batería como 16 pads: cada uno con su
// nombre y su onda, se toca (clic o el controlador) y se ilumina cuando suena en el patrón. El pad
// elegido muestra su cadena (nivel, tono, decaimiento, filtro, paneo, reverb y GRUPO DE CORTE) y
// deja CAMBIAR SU SAMPLE escuchándolo dentro del patrón (‹ ›, y ↺ para volver). Lo que tocas con ▶
// sin grabar queda guardado: «guardar lo tocado» lo pasa a la rejilla donde sonó.

function PadWave({ name, color }: { name: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx?.clearRect(0, 0, cv.width, cv.height);
    void getWaveInfo(name, 48).then((w) => { if (alive && w && ref.current) drawWave(ref.current, w.peaks, color); });
    return () => { alive = false; };
  }, [name, color]);
  return <canvas ref={ref} className="dpad-wave" aria-hidden="true" />;
}

const fmtSt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`;

export function DrumPads({ id, code, headOff, armPos }: { id: string; code: string; headOff?: boolean; armPos?: ArmPos }) {
  const full = useGraphStore((s) => (s.nodes.find((n) => n.id === id)?.data.code ?? '') as string);
  const update = useGraphStore((s) => s.updateNodeData);
  const color = useTrackColorStore((s) => s.map[id]) ?? '#3df0d0';
  const armed = usePadRecStore((s) => s.armed === id);
  const rec = usePadRecStore((s) => s.rec);
  const last = usePadRecStore((s) => s.last);
  const recentN = usePadRecStore((s) => s.recent.filter((r) => r.track === id).length);
  const midiOn = useMidiStore((s) => s.on);
  const [sel, setSel] = useState(0);
  const [lit, setLit] = useState(0); // bits: pads que suenan en este paso del patrón
  // sesión de CAMBIO DE SAMPLE: la lista queda fija mientras pruebas (el actual va cambiando)
  const [swap, setSwap] = useState<{ pad: number; orig: string; idx: number; alts: SoundAlt[] } | null>(null);
  const [tap, setTap] = useState(-1); // pad recién tocado (destello)
  const tapT = useRef<number | undefined>(undefined);
  const flashTap = (pad: number) => { setTap(pad); window.clearTimeout(tapT.current); tapT.current = window.setTimeout(() => setTap(-1), 140); };

  const map = useMemo(() => drumPadMap(full), [full]);
  const parsed = useMemo(() => parseSeq(code), [code]);
  const gridBank = parsed?.bank || '';
  const bankOf = (snd: string) => { const l = laneOf(full, snd); return (l && laneOwnBank(l)) || gridBank || 'RolandTR909'; };
  const soundsInTrack = useMemo(() => map.filter((s): s is string => !!s && !!laneOf(full, s)), [map, full]);
  const hats = hatPair(soundsInTrack);

  // los pads del CONTROLADOR tocan esta pista mientras miras sus pads (si no hay otra armada)
  useEffect(() => {
    if (!usePadRecStore.getState().armed) armPadRec(id, 'drum');
  }, [id]);
  // los pads del controlador también destellan
  useEffect(() => { if (last && armed) flashTap(last.pad); }, [last, armed]);
  // fuera de la sesión de cambio de sample al elegir otro pad
  useEffect(() => { if (swap && swap.pad !== sel) setSwap(null); }, [sel, swap]);

  // pads que suenan AHORA en el patrón (lo que se oye), para iluminarlos
  const bars = parsed?.bars ?? 1;
  useEffect(() => {
    if (!parsed || parsed.complex) return;
    let raf = 0;
    let prev = -2;
    const tick = () => {
      const t = headOff ? NaN : heardPatternTime(armPos, false);
      let mask = 0;
      if (Number.isFinite(t) && t >= 0) {
        const step = Math.floor((t / Math.max(1, bars)) * parsed.steps + 1e-6) % Math.max(1, parsed.steps);
        if (step !== prev) {
          prev = step;
          parsed.lanes.forEach((l) => {
            const idx = l.len && l.len < parsed.steps ? step % l.len : step;
            if ((l.steps[idx] ?? 0) > 0) { const p = map.indexOf(l.sound); if (p >= 0) mask |= 1 << p; }
          });
          setLit(mask);
        }
      } else if (prev !== -1) { prev = -1; setLit(0); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [parsed, map, bars, headOff, armPos?.start, armPos?.bars, armPos?.total]);

  const hit = (pad: number, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setSel(pad);
    // fuerza por la altura del toque: arriba más fuerte
    const r = e.currentTarget.getBoundingClientRect();
    const vel = Math.max(0.35, Math.min(1, 1.05 - (e.clientY - r.top) / Math.max(1, r.height) * 0.7));
    padHit(pad, vel, id);
    flashTap(pad);
  };

  const snd = map[sel];
  const lane = snd ? laneOf(full, snd) : null;
  const fx: PadFx = parsePadFx(lane?.sfx);
  const setFx = (patch: Partial<PadFx>) => {
    if (!snd) return;
    setSwap(null);
    update(id, { code: editLaneEverywhere(full, snd, (l) => ({ ...l, sfx: buildPadFx({ ...parsePadFx(l.sfx), ...patch }) || undefined })) });
  };
  const setLevel = (v: number) => { if (snd) update(id, { code: editLaneEverywhere(full, snd, (l) => ({ ...l, level: Math.round(v * 100) / 100 })) }); };

  // CAMBIAR EL SAMPLE escuchándolo en el patrón
  const fresh: SoundAlt[] = useMemo(() => (snd && !swap ? soundAlternatives(snd, bankOf(snd)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snd, full, swap]);
  const alts = swap?.alts ?? fresh;
  const curAlt = swap ? swap.idx : 0;
  const applyAlt = (a: SoundAlt) => {
    if (!snd) return;
    const next = editLaneEverywhere(full, snd, (l) => withLaneBank({ ...l, sound: a.sound }, a.bank === gridBank ? '' : a.bank));
    update(id, { code: next });
  };
  const stepAlt = (dir: 1 | -1) => {
    if (!alts.length || !lane) return;
    const i = (curAlt + dir + alts.length) % alts.length;
    setSwap(swap ? { ...swap, idx: i } : { pad: sel, orig: full, idx: i, alts });
    applyAlt(alts[i]);
    if (!useGraphStore.getState().playing) padHit(sel, 0.8, id); // parado: que se oiga igual
  };
  const revert = () => { if (swap) { update(id, { code: swap.orig }); setSwap(null); } };

  const chokeHats = () => {
    if (!hats) return;
    let next = editLaneEverywhere(full, hats.closed, (l) => ({ ...l, sfx: buildPadFx({ ...parsePadFx(l.sfx), cut: 1 }) || undefined }));
    next = editLaneEverywhere(next, hats.open, (l) => ({ ...l, sfx: buildPadFx({ ...parsePadFx(l.sfx), cut: 1 }) || undefined }));
    update(id, { code: next });
    toast.ok(`«${hats.closed}» corta a «${hats.open}» (grupo de corte 1).`);
  };
  const hatsChoked = !!hats && parsePadFx(laneOf(full, hats.closed)?.sfx).cut != null && parsePadFx(laneOf(full, hats.closed)?.sfx).cut === parsePadFx(laneOf(full, hats.open)?.sfx).cut;

  if (!parsed || parsed.complex) {
    return <p className="seqs-seedline">Este patrón no es una rejilla de batería: los pads necesitan una (usa la vista ▦ rejilla).</p>;
  }

  return (
    <div className="dpads" style={{ ['--tc' as string]: color }}>
      <div className="dpads-left">
        <div className="dpads-bar">
          <button className={`dpads-btn rec${rec && armed ? ' on' : ''}`} onClick={() => { if (!armed) armPadRec(id, 'drum'); setPadRec(!(rec && armed)); }}
            title="● grabar: con ▶, cada golpe entra en la rejilla donde lo tocas (toda la toma = un paso de deshacer)">
            ● {rec && armed ? 'grabando' : 'grabar'}
          </button>
          <button className={`dpads-btn${recentN ? ' has' : ''}`} disabled={!recentN} onClick={() => capturePads(id)}
            title="lo que tocaste con ▶ SIN grabar: lo pasa a la rejilla donde sonó (un paso de deshacer)">
            ⟲ guardar lo tocado{recentN ? ` (${recentN})` : ''}
          </button>
          <button className={`dpads-btn${armed ? ' on' : ''}`} onClick={() => armPadRec(armed ? null : id, 'drum')}
            title={armed ? 'los pads del controlador tocan esta pista (clic: soltar)' : 'que los pads del controlador toquen esta pista'}>
            🎛 {armed ? 'controlador aquí' : 'usar controlador'}{!midiOn && armed ? ' (conecta MIDI)' : ''}
          </button>
          {hats && (
            <button className={`dpads-btn${hatsChoked ? ' on' : ''}`} onClick={chokeHats} disabled={hatsChoked}
              title={`grupo de corte: «${hats.closed}» calla a «${hats.open}» como en una caja de ritmos`}>
              {hatsChoked ? '✓ ' : ''}{hats.closed} corta a {hats.open}
            </button>
          )}
        </div>
        <div className="dpads-grid" role="group" aria-label="pads de batería">
          {Array.from({ length: PADS }, (_, i) => {
            const s = map[i];
            const inPat = !!s && soundsInTrack.includes(s);
            const flash = ((lit >> i) & 1) === 1 || tap === i;
            const cut = s && inPat ? parsePadFx(laneOf(full, s)?.sfx).cut : null;
            return (
              <button key={i} className={`dpad${inPat ? ' in' : ''}${sel === i ? ' sel' : ''}${flash ? ' lit' : ''}`} disabled={!s}
                onPointerDown={(e) => s && hit(i, e)}
                onKeyDown={(e) => { if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSel(i); padHit(i, 0.8, id); } }}
                title={s ? `${s}${inPat ? '' : ' (aún no está en el patrón)'} · clic: tocar y elegir · arriba más fuerte` : 'pad libre'}>
                {s && <PadWave name={resolveSoundKey(mapName(s, bankOf(s)))} color={color} />}
                <span className="dpad-n">{s ?? '—'}</span>
                <span className="dpad-i">{i + 1}{cut ? ` · ✂${cut}` : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="dpads-insp">
        {!snd ? <p className="dpi-note">Pad libre.</p> : (
          <>
            <div className="dpi-head">
              <span className="dpi-pad">pad {sel + 1}</span>
              <b className="dpi-snd">{snd}</b>
              <span className="dpi-bank">{bankOf(snd)}</span>
              <button className="dpads-btn" onClick={() => padHit(sel, 0.85, id)} title="escuchar el pad con su cadena">▶</button>
            </div>
            {!lane ? (
              <p className="dpi-note">Este pad aún no está en el patrón. Tócalo con <b>● grabar</b> (o tócalo con ▶ y luego <b>⟲ guardar lo tocado</b>) y aquí aparece su cadena.</p>
            ) : (
              <>
                <div className="dpi-swap">
                  <span className="dpi-lbl">sample</span>
                  <button className="dpads-btn" onClick={() => stepAlt(-1)} disabled={alts.length < 2} title="sample anterior (suena ya en el patrón)">‹</button>
                  <span className="dpi-alt" title={alts[curAlt]?.label}>{alts[curAlt]?.label ?? snd}</span>
                  <button className="dpads-btn" onClick={() => stepAlt(1)} disabled={alts.length < 2} title="sample siguiente (suena ya en el patrón)">›</button>
                  {swap && <button className="dpads-btn" onClick={revert} title="volver al sample de antes">↺</button>}
                  <span className="dpi-count">{alts.length > 1 ? `${curAlt + 1}/${alts.length}` : ''}</span>
                </div>
                <div className="dpi-knobs">
                  <label><Knob value={lane.level ?? 1} min={0} max={1.5} step={0.01} size={30} defaultValue={1} label="nivel del pad" hideValue onChange={setLevel} /><span>nivel</span><i>{Math.round((lane.level ?? 1) * 100)}%</i></label>
                  <label><Knob value={fx.semis} min={-12} max={12} step={0.5} size={30} defaultValue={0} label="tono (semitonos)" hideValue onChange={(v) => setFx({ semis: v })} /><span>tono</span><i>{fmtSt(fx.semis)}</i></label>
                  <label><Knob value={fx.decay ?? DECAY_MAX} min={0.03} max={DECAY_MAX} step={0.01} size={30} defaultValue={DECAY_MAX} label="decaimiento (s)" hideValue onChange={(v) => setFx({ decay: v >= DECAY_MAX - 0.01 ? null : v })} /><span>decae</span><i>{fx.decay == null ? 'entero' : `${fx.decay.toFixed(2)} s`}</i></label>
                  <label><Knob value={fx.filter} min={-1} max={1} step={0.01} size={30} defaultValue={0} label="filtro (pasa-bajos ◄► pasa-altos)" hideValue onChange={(v) => setFx({ filter: Math.abs(v) < 0.02 ? 0 : v })} /><span>filtro</span><i>{fx.filter < -0.02 ? 'graves' : fx.filter > 0.02 ? 'agudos' : 'abierto'}</i></label>
                  <label><Knob value={fx.pan} min={0} max={1} step={0.01} size={30} defaultValue={0.5} label="paneo" hideValue onChange={(v) => setFx({ pan: v })} /><span>paneo</span><i>{Math.abs(fx.pan - 0.5) < 0.01 ? 'C' : fx.pan < 0.5 ? `I ${Math.round((0.5 - fx.pan) * 200)}` : `D ${Math.round((fx.pan - 0.5) * 200)}`}</i></label>
                  <label><Knob value={fx.room} min={0} max={1} step={0.01} size={30} defaultValue={0} label="reverb" hideValue onChange={(v) => setFx({ room: v })} /><span>reverb</span><i>{Math.round(fx.room * 100)}%</i></label>
                </div>
                <div className="dpi-cut" role="radiogroup" aria-label="grupo de corte">
                  <span className="dpi-lbl" title="los pads del mismo grupo se cortan entre sí (el hat cerrado calla al abierto)">corte</span>
                  <button role="radio" aria-checked={fx.cut == null} className={fx.cut == null ? 'on' : ''} onClick={() => setFx({ cut: null })}>—</button>
                  {CUT_GROUPS.map((g) => (
                    <button key={g} role="radio" aria-checked={fx.cut === g} className={fx.cut === g ? 'on' : ''} onClick={() => setFx({ cut: g })}>{g}</button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
