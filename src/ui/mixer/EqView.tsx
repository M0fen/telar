import { useEffect, useMemo, useRef } from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { useMixerStore } from '../../store/useMixerStore';
import { useTrackColorStore } from '../../store/useTrackColorStore';
import { readTrackSpectrum, releaseTrackSpectrum } from '../../audio/mixTaps';
import { dbToY, eqResponse, EQ_HIGH_HZ, EQ_LOW_HZ, EQ_RANGE, freqToX, xToFreq, yToDb } from '../../lib/mixMath';
import { DEFAULT_CHANNEL_EQ, type ChannelEq, type NodeData } from '../../graph/types';

// EQ VISUAL POR PISTA (Fase 11.2): la curva de las tres bandas de la tira sobre el ESPECTRO EN VIVO de
// la pista. Los puntos se arrastran: graves y agudos suben o bajan; la campana de medios también se
// corre de frecuencia. «comparar» pinta encima el espectro de otra pista: donde se tapan, chocan.

const SPEC_LO = -96;
const SPEC_HI = -12;
const FREQ_LINES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${Math.round(f)}`);
const fmtDb = (v: number) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

type Band = 'low' | 'mid' | 'high';

export function EqView({ id }: { id: string }) {
  const data = useGraphStore((s) => s.nodes.find((n) => n.id === id)?.data) as NodeData | undefined;
  const nodes = useGraphStore((s) => s.nodes);
  const update = useGraphStore((s) => s.updateNodeData);
  const compare = useMixerStore((s) => s.compare);
  const setCompare = useMixerStore((s) => s.setCompare);
  const colors = useTrackColorStore((s) => s.map);
  const color = colors[id] ?? '#3df0d0';
  const cmpColor = compare ? colors[compare] ?? '#e7b84a' : '#e7b84a';
  const eq: ChannelEq = { ...DEFAULT_CHANNEL_EQ, ...(data?.eq ?? {}) };
  const on = eq.on !== false && !!data?.eq;
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Band | null>(null);
  const eqRef = useRef(eq);
  eqRef.current = eq;
  const others = nodes.filter((n) => n.data.kind === 'source' && n.id !== id && !Array.isArray(n.data.transitions) && !n.data.djTrack);

  // curva (256 puntos) cuando cambia el EQ
  const freqs = useMemo(() => Array.from({ length: 256 }, (_, i) => xToFreq(i, 255)), []);
  const curve = useMemo(() => eqResponse(on ? eq : undefined, freqs), [on, eq.low, eq.mid, eq.high, eq.midFreq, freqs]); // eslint-disable-line react-hooks/exhaustive-deps
  const curveRef = useRef(curve);
  curveRef.current = curve;

  useEffect(() => {
    const a = { data: null as Float32Array<ArrayBuffer> | null };
    const b = { data: null as Float32Array<ArrayBuffer> | null };
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = cv.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth || 400, H = c.clientHeight || 200;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // rejilla
      g.lineWidth = 1;
      g.font = '9px monospace';
      for (const f of FREQ_LINES) {
        const x = Math.round(freqToX(f, W)) + 0.5;
        g.strokeStyle = 'rgba(120,150,165,0.12)';
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
        g.fillStyle = 'rgba(160,180,190,0.45)';
        g.fillText(fmtHz(f), x + 2, H - 3);
      }
      for (const d of [-12, -6, 0, 6, 12]) {
        const y = Math.round(dbToY(d, H, -EQ_RANGE, EQ_RANGE)) + 0.5;
        g.strokeStyle = d === 0 ? 'rgba(160,180,190,0.3)' : 'rgba(120,150,165,0.1)';
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        g.fillStyle = 'rgba(160,180,190,0.45)';
        g.fillText(`${d > 0 ? '+' : ''}${d}`, 2, y - 2);
      }
      // espectros (la pista llena; la de comparar, línea)
      const spectrum = (tid: string, buf: typeof a, fill: string | null, stroke: string) => {
        const an = readTrackSpectrum(tid, buf);
        if (!an || !buf.data) return;
        const sr = an.context.sampleRate;
        const n = buf.data.length;
        g.beginPath();
        let first = true;
        for (let x = 0; x <= W; x += 2) {
          const f = xToFreq(x, W);
          const bin = Math.max(1, Math.min(n - 1, Math.round((f / (sr / 2)) * n)));
          const v = buf.data[bin];
          const y = dbToY(Number.isFinite(v) ? v : SPEC_LO, H, SPEC_LO, SPEC_HI);
          if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
        }
        if (fill) {
          g.lineTo(W, H); g.lineTo(0, H); g.closePath();
          g.fillStyle = fill;
          g.fill();
        } else {
          g.strokeStyle = stroke;
          g.lineWidth = 1.4;
          g.stroke();
        }
      };
      spectrum(id, a, `${color}33`, color);
      const cmp = useMixerStore.getState().compare;
      if (cmp) spectrum(cmp, b, null, cmpColor);
      // curva del EQ
      const cu = curveRef.current;
      g.beginPath();
      cu.forEach((d, i) => { const x = (i / (cu.length - 1)) * W; const y = dbToY(d, H, -EQ_RANGE, EQ_RANGE); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.strokeStyle = '#e8eef2';
      g.lineWidth = 2;
      g.stroke();
      // puntos
      const e = eqRef.current;
      const pts: [Band, number, number][] = [['low', EQ_LOW_HZ, e.low ?? 0], ['mid', e.midFreq ?? 1000, e.mid ?? 0], ['high', EQ_HIGH_HZ, e.high ?? 0]];
      for (const [band, f, d] of pts) {
        const x = freqToX(f, W), y = dbToY(d, H, -EQ_RANGE, EQ_RANGE);
        g.beginPath();
        g.arc(x, y, drag.current === band ? 8 : 6, 0, Math.PI * 2);
        g.fillStyle = band === 'mid' ? color : '#0a0f14';
        g.fill();
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); releaseTrackSpectrum(id); if (compare) releaseTrackSpectrum(compare); };
  }, [id, color, cmpColor, compare]);

  const setEq = (patch: Partial<ChannelEq>) => update(id, { eq: { ...eqRef.current, on: true, ...patch } });
  const pick = (x: number, y: number, W: number, H: number): Band | null => {
    const e = eqRef.current;
    const pts: [Band, number, number][] = [['low', EQ_LOW_HZ, e.low ?? 0], ['mid', e.midFreq ?? 1000, e.mid ?? 0], ['high', EQ_HIGH_HZ, e.high ?? 0]];
    let best: Band | null = null, bd = 18 * 18;
    for (const [b, f, d] of pts) {
      const dx = freqToX(f, W) - x, dy = dbToY(d, H, -EQ_RANGE, EQ_RANGE) - y;
      if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = b; }
    }
    if (best) return best;
    // sin punto cerca: la banda de esa zona
    const f = xToFreq(x, W);
    return f < 250 ? 'low' : f > 3000 ? 'high' : 'mid';
  };
  const apply = (b: Band, x: number, y: number, W: number, H: number) => {
    const db = Math.round(yToDb(y, H, -EQ_RANGE, EQ_RANGE) * 2) / 2;
    if (b === 'mid') setEq({ mid: db, midFreq: Math.round(Math.max(200, Math.min(8000, xToFreq(x, W))) / 10) * 10 });
    else setEq({ [b]: db } as Partial<ChannelEq>);
  };

  return (
    <div className="mx-eq-view">
      <div className="mx-eq-top">
        <button className={`mx-tog${on ? ' on' : ''}`} onClick={() => update(id, { eq: { ...eq, on: !on } })} title="EQ de la pista encendido / apagado (A/B)">EQ {on ? 'on' : 'off'}</button>
        <span className="mx-eq-read">graves <b>{fmtDb(eq.low ?? 0)}</b> · medios <b>{fmtDb(eq.mid ?? 0)}</b> @ {fmtHz(eq.midFreq ?? 1000)} Hz · agudos <b>{fmtDb(eq.high ?? 0)}</b> dB</span>
        <button className="mx-tog" onClick={() => setEq({ low: 0, mid: 0, high: 0, midFreq: 1000 })} title="todas las bandas a 0 dB">plano</button>
        <label className="mx-cmp" title="pinta encima el espectro de otra pista: donde se tapan, chocan (baja una de las dos ahí)">
          comparar
          <select value={compare ?? ''} onChange={(e) => setCompare(e.target.value || null)}>
            <option value="">—</option>
            {others.map((n) => <option key={n.id} value={n.id}>{n.data.name || n.id}</option>)}
          </select>
        </label>
      </div>
      <canvas ref={cv} className="mx-eq-canvas" style={{ ['--tc' as string]: color }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const b = pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
          if (!b) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = b;
          apply(b, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
        }}
        onPointerMove={(e) => { if (!drag.current) return; const r = e.currentTarget.getBoundingClientRect(); apply(drag.current, e.clientX - r.left, e.clientY - r.top, r.width, r.height); }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const b = pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height); if (b) setEq({ [b]: 0 } as Partial<ChannelEq>); }}
        title="arrastra los puntos: graves (120 Hz), medios (se corre de frecuencia) y agudos (4,5 kHz) · doble clic: a 0 dB" />
    </div>
  );
}
