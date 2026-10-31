import { useEffect, useRef } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useMidiStore, midiKeyLabel } from '../store/useMidiStore';
import { deckSlot } from '../audio/djMidi';
import {
  deckCueDown, deckCueUp, deckHot, deckJump, deckLoop, deckLoopRegion, deckPhase, deckPos, deckPrepare, deckRate, deckSeek,
  deckSync, deckToggle, deckWave, sessionToTrack, useSongDecks, WAVE_RATE, deckNudge,
} from '../audio/songDeck';
import { barLen, beatAt, camelot, fmtTime, gridOf, posOfBeat, type DjTrack } from '../lib/djDeck';
import { keyShort } from '../lib/songKey';
import type { NodeData } from '../graph/types';

// DECK DE TEMA (modo DJ, DJ-1): lo propio de un deck que trae un tema completo — su tonalidad y su
// tempo, la ONDA ENTERA (clic = ir ahí) y la que CORRE con la rejilla, el transporte (CUE como un CDJ,
// ▶/⏸, saltos de compases), 4 cues rápidos y loops de 1/2/4/8 compases. El volumen, el EQ, el filtro,
// el cue de audífonos y el crossfader son los de la tira, como en cualquier deck.

export const HOT_COLORS = ['#e46a6a', '#e7b84a', '#3df0d0', '#b197fc'];
const ZOOM_BARS = 2; // la onda que corre muestra ±2 compases

// etiqueta del control MIDI asignado a un slot (como en el resto de la mesa)
function MK({ slot }: { slot: string }) {
  const key = useMidiStore((s) => Object.keys(s.map).find((k) => s.map[k] === slot) ?? '');
  return key ? <i className="mk">{midiKeyLabel(key)}</i> : null;
}

const fit = (c: HTMLCanvasElement) => {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = c.clientWidth || 300, H = c.clientHeight || 40;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  return { g, W, H };
};

// una columna de onda por bandas: graves (color del deck), medios (más claro) y agudos (blanco)
function column(g: CanvasRenderingContext2D, x: number, w: number, mid: number, H: number, lo: number, md: number, hi: number, color: string, alpha: number) {
  const h = H / 2 - 1;
  g.globalAlpha = alpha;
  g.fillStyle = color;
  const a = Math.max(0.5, lo * h);
  g.fillRect(x, mid - a, w, 2 * a);
  g.globalAlpha = alpha * 0.75;
  g.fillStyle = '#9fe9da';
  const b = Math.max(0.3, md * h * 0.85);
  g.fillRect(x, mid - b, w, 2 * b);
  g.globalAlpha = alpha * 0.85;
  g.fillStyle = '#eef6f8';
  const c = Math.max(0, hi * h * 0.7);
  g.fillRect(x, mid - c, w, 2 * c);
  g.globalAlpha = 1;
}

export function SongDeckBody({ id, data, index, color }: { id: string; data: NodeData; index: number; color: string }) {
  const t = data.djTrack as DjTrack;
  const ui = useSongDecks((s) => s.d[id]);
  const cps = useGraphStore((s) => s.cps) || 0.5;
  const bpc = useGraphStore((s) => s.beatsPerCycle) || 4;
  const sessionBpm = cps * 60 * bpc;
  const ovRef = useRef<HTMLCanvasElement>(null);
  const dtRef = useRef<HTMLCanvasElement>(null);
  const elRef = useRef<HTMLSpanElement>(null);
  const remRef = useRef<HTMLSpanElement>(null);
  const phRef = useRef<HTMLSpanElement>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const slot = (w: string) => deckSlot(index, w);

  useEffect(() => { if (t?.id) deckPrepare(id); }, [id, t?.id]);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const tt = tRef.current;
      if (!tt || !(tt.dur > 0)) return;
      const pos = deckPos(id);
      const g = gridOf(tt);
      const loop = deckLoopRegion(id);
      if (elRef.current) elRef.current.textContent = fmtTime(pos);
      if (remRef.current) remRef.current.textContent = `−${fmtTime(tt.dur - pos)}`;
      // fase (DJ-2): una barra que se corre si el tema va adelantado o atrasado respecto de la sesión
      const ph = deckPhase(id);
      if (phRef.current) {
        phRef.current.style.left = ph == null ? '50%' : `${50 + ph * 100}%`;
        phRef.current.className = `sd-phase-dot${ph == null ? ' off' : Math.abs(ph) < 0.02 ? ' ok' : ''}`;
      }
      // ONDA ENTERA
      const oc = ovRef.current;
      if (oc) {
        const { g: x, W, H } = fit(oc);
        const wave = deckWave(id);
        const cols = Math.max(1, Math.floor(W));
        const mid = H / 2;
        for (let c = 0; c < cols; c++) {
          const sec = (c / cols) * tt.dur;
          const played = sec < pos;
          if (wave) {
            const k0 = Math.floor(sec * WAVE_RATE), k1 = Math.max(k0 + 1, Math.floor(((c + 1) / cols) * tt.dur * WAVE_RATE));
            let lo = 0, md = 0, hi = 0;
            for (let k = k0; k < k1 && k < wave.lo.length; k++) { if (wave.lo[k] > lo) lo = wave.lo[k]; if (wave.mid[k] > md) md = wave.mid[k]; if (wave.hi[k] > hi) hi = wave.hi[k]; }
            column(x, c, 1, mid, H, lo, md, hi, color, played ? 0.38 : 0.95);
          }
        }
        const X = (s: number) => (s / tt.dur) * W;
        if (loop) { x.fillStyle = 'rgba(61,240,208,0.16)'; x.fillRect(X(loop.a), 0, Math.max(1, X(loop.b) - X(loop.a)), H); }
        x.fillStyle = '#ff9a3d';
        x.beginPath(); x.moveTo(X(tt.cue) - 4, 0); x.lineTo(X(tt.cue) + 4, 0); x.lineTo(X(tt.cue), 6); x.fill();
        (tt.hot ?? []).forEach((h, k) => { if (h == null) return; x.fillStyle = HOT_COLORS[k]; x.fillRect(X(h) - 1, H - 6, 3, 6); });
        x.fillStyle = '#ffffff';
        x.fillRect(Math.round(X(pos)), 0, 1.5, H);
      }
      // ONDA QUE CORRE (±2 compases) con la rejilla
      const dc = dtRef.current;
      if (dc) {
        const { g: x, W, H } = fit(dc);
        const wave = deckWave(id);
        const half = ZOOM_BARS * barLen(g);
        const spp = (2 * half) / W; // segundos por píxel
        const from = pos - half;
        const mid = H / 2;
        if (loop) { x.fillStyle = 'rgba(61,240,208,0.14)'; x.fillRect((loop.a - from) / spp, 0, (loop.b - loop.a) / spp, H); }
        if (wave) {
          for (let c = 0; c < W; c++) {
            const s0 = from + c * spp;
            if (s0 < 0 || s0 > tt.dur) continue;
            const k0 = Math.floor(s0 * WAVE_RATE), k1 = Math.max(k0 + 1, Math.floor((s0 + spp) * WAVE_RATE));
            let lo = 0, md = 0, hi = 0;
            for (let k = k0; k < k1 && k < wave.lo.length; k++) { if (wave.lo[k] > lo) lo = wave.lo[k]; if (wave.mid[k] > md) md = wave.mid[k]; if (wave.hi[k] > hi) hi = wave.hi[k]; }
            column(x, c, 1, mid, H, lo, md, hi, color, s0 < pos ? 0.7 : 0.95);
          }
        }
        // rejilla: tiempos finos, compases marcados (el 1 de cada 4 compases, más)
        const b0 = Math.ceil(beatAt(g, from)), b1 = Math.floor(beatAt(g, pos + half));
        for (let b = b0; b <= b1; b++) {
          const px = (posOfBeat(g, b) - from) / spp;
          const bar = ((b % g.beats) + g.beats) % g.beats === 0;
          const phrase = ((b % (g.beats * 4)) + g.beats * 4) % (g.beats * 4) === 0;
          x.fillStyle = phrase ? 'rgba(231,184,74,0.9)' : bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.16)';
          x.fillRect(Math.round(px), bar ? 0 : H - 6, 1, bar ? H : 6);
        }
        const line = (s: number, col: string) => { const px = (s - from) / spp; if (px >= 0 && px <= W) { x.fillStyle = col; x.fillRect(Math.round(px) - 1, 0, 2, H); } };
        line(tt.cue, '#ff9a3d');
        (tt.hot ?? []).forEach((h, k) => { if (h != null) line(h, HOT_COLORS[k]); });
        x.fillStyle = '#ffffff';
        x.fillRect(Math.round(W / 2), 0, 2, H); // el cabezal, al centro
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [id, color, data.djTrack]);

  if (!t) return null;
  const playing = !!ui?.playing && !ui?.preview;
  const sync = t.sync !== false;
  const eff = sync ? sessionBpm : t.bpm * (1 + (t.pitch ?? 0));
  const pct = ((eff / t.bpm - 1) * 100);
  const hot = [0, 1, 2, 3].map((k) => t.hot?.[k] ?? null);
  const ovClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    void deckSeek(id, ((e.clientX - r.left) / r.width) * t.dur);
  };
  const dtClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const half = ZOOM_BARS * barLen(gridOf(t));
    void deckSeek(id, deckPos(id) - half + ((e.clientX - r.left) / r.width) * 2 * half);
  };
  const rate = deckRate(id);

  return (
    <div className="sd">
      <div className="sd-info">
        <span className="sd-key" title={t.key ? `tonalidad ${keyShort(t.key)} · Camelot ${camelot(t.key)} (mezcla armónica: misma clave, ±1 o la otra letra)` : 'sin tonalidad detectada'}>
          {t.key ? <><b>{camelot(t.key)}</b> {keyShort(t.key)}</> : '—'}
        </span>
        <span className="sd-bpm" title={`tempo original ${t.bpm.toFixed(2)} BPM${sync ? ` · con SYNC suena a ${eff.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %)` : ''}`}>
          <b>{eff.toFixed(1)}</b> <i>{t.bpm.toFixed(1)}{Math.abs(pct) > 0.05 ? ` ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : ''}</i>
        </span>
        <span className="sd-time"><span ref={elRef}>0:00</span> <i ref={remRef}>−0:00</i></span>
        <button className={`sd-btn sd-sync${sync ? ' on' : ''}`} data-midi={slot('sync')} onClick={() => void deckSync(id, !sync)}
          title={sync ? 'SYNC: el tema va al tempo de la sesión y con su fase fija (toca para soltarlo a su tempo)' : 'sin SYNC: el tema va a su tempo (toca para sincronizarlo)'}>
          sync<MK slot={slot('sync')} />
        </button>
        <button className="sd-btn" onClick={() => sessionToTrack(id)} title={`que la sesión vaya al tempo de este tema (${t.bpm.toFixed(1)} BPM): los demás decks lo siguen`}>♩=</button>
      </div>
      <canvas ref={ovRef} className="sd-ov" onClick={ovClick} title="el tema entero: clic = ir ahí (sonando, salta en fase al próximo tiempo)" />
      <div className="sd-dtwrap">
        <canvas ref={dtRef} className="sd-dt" onClick={dtClick} title="la onda que corre (±2 compases) con su rejilla: las líneas son los tiempos; las claras, los compases; las doradas, cada 4 compases" />
        {ui?.loading && <span className="sd-loading">cargando…</span>}
        {ui?.missing && <span className="sd-loading warn">falta el audio: suéltalo otra vez aquí</span>}
      </div>
      <div className="sd-phase" title="fase: el punto al centro = el tema cae justo en los tiempos de la sesión; corrido = adelantado o atrasado">
        <span ref={phRef} className="sd-phase-dot off" />
      </div>
      <div className="sd-row">
        <button className={`sd-cue${ui?.preview ? ' on' : ''}`} data-midi={slot('cuebtn')}
          onPointerDown={() => void deckCueDown(id)} onPointerUp={() => deckCueUp(id)} onPointerLeave={() => deckCueUp(id)}
          title="CUE: sonando, vuelve al cue y para · parado, pone el cue aquí · parado en el cue, suena mientras lo mantienes">
          cue<MK slot={slot('cuebtn')} />
        </button>
        <button className={`sd-play${playing ? ' on' : ''}`} data-midi={slot('play')} onClick={() => deckToggle(id)}
          title={playing ? 'pausa' : sync ? 'tocar: entra en el 1 del próximo compás de la sesión, en fase («♩ al compás»)' : 'tocar a su tempo'}>
          {playing ? '⏸' : '▶'}<MK slot={slot('play')} />
        </button>
        <span className="sd-jumps" role="group" aria-label="saltar compases">
          {[-16, -4, -1, 1, 4, 16].map((b) => (
            <button key={b} className="sd-btn" data-midi={b === -4 ? slot('jumpb') : b === 4 ? slot('jumpf') : undefined} onClick={() => void deckJump(id, b)}
              title={`saltar ${Math.abs(b)} ${Math.abs(b) === 1 ? 'compás' : 'compases'} ${b < 0 ? 'atrás' : 'adelante'} (en fase)`}>
              {b < 0 ? `◂${-b}` : `${b}▸`}
            </button>
          ))}
        </span>
      </div>
      <div className="sd-row">
        <span className="sd-hots" role="group" aria-label="cues rápidos">
          {hot.map((h, k) => (
            <button key={k} className={`sd-hot${h != null ? ' set' : ''}`} style={{ ['--hc' as string]: HOT_COLORS[k] }} data-midi={slot(`hot${k + 1}`)}
              onClick={(e) => void deckHot(id, k, e.shiftKey)} onContextMenu={(e) => { e.preventDefault(); void deckHot(id, k, true); }}
              title={h == null ? `cue rápido ${k + 1}: guarda aquí el tiempo que suena` : `cue rápido ${k + 1} en ${fmtTime(h)}: salta ahí (en fase) · clic derecho o Mayús+clic: borrarlo`}>
              {k + 1}<MK slot={slot(`hot${k + 1}`)} />
            </button>
          ))}
        </span>
        <span className="sd-loops" role="group" aria-label="loops">
          {[1, 2, 4, 8].map((b) => (
            <button key={b} className={`sd-btn${ui?.loop === b ? ' on' : ''}`} data-midi={b === 4 ? slot('loop') : undefined} onClick={() => void deckLoop(id, b)}
              title={ui?.loop === b ? 'salir del loop (sigue de largo)' : `loop de ${b} ${b === 1 ? 'compás' : 'compases'} desde el tiempo que suena`}>
              {b}
            </button>
          ))}
          <span className="sd-loops-tag">loop</span>
        </span>
        <span className="sd-nudge" role="group" aria-label="empujar">
          <button className={`sd-btn${ui?.nudging === -1 ? ' on' : ''}`} data-midi={slot('nudgeb')} onPointerDown={() => deckNudge(id, -1)} onPointerUp={() => deckNudge(id, 0)} onPointerLeave={() => { if (ui?.nudging) deckNudge(id, 0); }} title="frenar un poco mientras lo mantienes (corre la fase atrás)">‹</button>
          <button className={`sd-btn${ui?.nudging === 1 ? ' on' : ''}`} data-midi={slot('nudgef')} onPointerDown={() => deckNudge(id, 1)} onPointerUp={() => deckNudge(id, 0)} onPointerLeave={() => { if (ui?.nudging) deckNudge(id, 0); }} title="apurar un poco mientras lo mantienes (corre la fase adelante)">›</button>
        </span>
      </div>
      {rate > 0 && Math.abs(rate - eff / t.bpm) > 0.004 && <p className="sd-note">corrigiendo la fase…</p>}
    </div>
  );
}
