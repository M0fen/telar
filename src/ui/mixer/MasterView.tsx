import { useEffect, useRef, useState } from 'react';
import { masterTap, holdMasterTap } from '../../audio/mixTaps';
import { getLufs } from '../../audio/lufsMeter';
import { dbToY, F_MAX, F_MIN, freqToX, stereoStats, xToFreq } from '../../lib/mixMath';
import { LufsMeter } from '../LufsMeter';

// ANÁLISIS DEL MÁSTER (Fase 11.4): lo que suena (post-bus) — analizador con ejes en Hz y dB (con
// picos retenidos), estéreo (correlación, balance, ancho y el «goniómetro») y el HISTORIAL de la
// sonoridad (LUFS a corto plazo de los últimos 2 minutos, con la línea del objetivo).

const FREQ_LINES = [30, 60, 100, 200, 500, 1000, 2000, 5000, 10000];
const DB_LO = -90, DB_HI = -6;
const HIST = 480; // 2 min a 4 por segundo
const fmtHz = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

export function MasterView() {
  const specCv = useRef<HTMLCanvasElement>(null);
  const gonCv = useRef<HTMLCanvasElement>(null);
  const histCv = useRef<HTMLCanvasElement>(null);
  const [st, setSt] = useState({ corr: 0, bal: 0, width: 0 });
  const [target, setTarget] = useState(-14);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const release = holdMasterTap();
    let raf = 0;
    let spec: Float32Array<ArrayBuffer> | null = null;
    let hold: Float32Array | null = null;
    let L: Float32Array<ArrayBuffer> | null = null, R: Float32Array<ArrayBuffer> | null = null;
    const lufs = new Float32Array(HIST).fill(NaN);
    let head = 0, lastL = 0, lastSt = 0;
    const fit = (c: HTMLCanvasElement) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth || 300, H = c.clientHeight || 150;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.font = '9px monospace';
      return { g, W, H };
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const tap = masterTap();
      // ESPECTRO
      const sc = specCv.current;
      if (sc) {
        const { g, W, H } = fit(sc);
        for (const f of FREQ_LINES) {
          const x = Math.round(freqToX(f, W)) + 0.5;
          g.strokeStyle = 'rgba(120,150,165,0.12)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
          g.fillStyle = 'rgba(160,180,190,0.5)'; g.fillText(fmtHz(f), x + 2, H - 3);
        }
        for (let d = -84; d <= -12; d += 12) {
          const y = Math.round(dbToY(d, H, DB_LO, DB_HI)) + 0.5;
          g.strokeStyle = 'rgba(120,150,165,0.1)'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
          g.fillStyle = 'rgba(160,180,190,0.5)'; g.fillText(`${d}`, 2, y - 2);
        }
        if (tap) {
          const an = tap.an;
          if (!spec || spec.length !== an.frequencyBinCount) { spec = new Float32Array(an.frequencyBinCount); hold = new Float32Array(an.frequencyBinCount).fill(-200); }
          an.getFloatFrequencyData(spec);
          const sr = an.context.sampleRate, n = spec.length;
          for (let i = 0; i < n; i++) hold![i] = Math.max(spec[i], hold![i] - 0.25); // picos que caen despacio
          const line = (arr: Float32Array, fill: boolean) => {
            g.beginPath();
            for (let x = 0; x <= W; x += 2) {
              const f = xToFreq(x, W);
              if (f < F_MIN || f > F_MAX) continue;
              const b = Math.max(1, Math.min(n - 1, Math.round((f / (sr / 2)) * n)));
              const y = dbToY(Number.isFinite(arr[b]) ? arr[b] : DB_LO, H, DB_LO, DB_HI);
              if (x) g.lineTo(x, y); else g.moveTo(x, y);
            }
            if (fill) { g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(61,240,208,0.18)'; g.fill(); g.strokeStyle = 'rgba(61,240,208,0.9)'; g.lineWidth = 1.2; g.stroke(); }
            else { g.strokeStyle = 'rgba(231,184,74,0.7)'; g.lineWidth = 1; g.stroke(); }
          };
          line(spec, true);
          line(hold!, false);
        }
      }
      // ESTÉREO
      if (tap) {
        if (!L || L.length !== tap.l.fftSize) { L = new Float32Array(tap.l.fftSize); R = new Float32Array(tap.r.fftSize); }
        tap.l.getFloatTimeDomainData(L);
        tap.r.getFloatTimeDomainData(R!);
        const gc = gonCv.current;
        if (gc) {
          const { g, W, H } = fit(gc);
          const cx = W / 2, cy = H / 2, s = Math.min(W, H) * 0.45;
          g.strokeStyle = 'rgba(120,150,165,0.18)';
          g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s); g.moveTo(cx - s, cy); g.lineTo(cx + s, cy); g.stroke();
          g.fillStyle = 'rgba(61,240,208,0.5)';
          for (let i = 0; i < L.length; i += 2) {
            const m = (L[i] + R![i]) * 0.7071, sd = (R![i] - L[i]) * 0.7071; // M arriba, S de lado
            g.fillRect(cx + sd * s * 1.6, cy - m * s * 1.6, 1.2, 1.2);
          }
          g.fillStyle = 'rgba(160,180,190,0.5)';
          g.fillText('M', cx + 3, 10); g.fillText('I', 3, cy - 3); g.fillText('D', W - 9, cy - 3);
        }
        if (now - lastSt > 150) { lastSt = now; setSt(stereoStats(L, R!)); }
      }
      // HISTORIAL DE SONORIDAD
      if (now - lastL > 250) {
        lastL = now;
        const r = getLufs();
        lufs[head] = Number.isFinite(r.short) ? r.short : NaN;
        head = (head + 1) % HIST;
      }
      const hc = histCv.current;
      if (hc) {
        const { g, W, H } = fit(hc);
        const lo = -36, hi = -4;
        const yOf = (v: number) => dbToY(v, H, lo, hi);
        for (const d of [-30, -24, -18, -12, -6]) {
          const y = Math.round(yOf(d)) + 0.5;
          g.strokeStyle = 'rgba(120,150,165,0.1)'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
          g.fillStyle = 'rgba(160,180,190,0.5)'; g.fillText(`${d}`, 2, y - 2);
        }
        const ty = Math.round(yOf(targetRef.current)) + 0.5;
        g.strokeStyle = 'rgba(231,184,74,0.8)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, ty); g.lineTo(W, ty); g.stroke(); g.setLineDash([]);
        g.beginPath();
        let started = false;
        for (let k = 0; k < HIST; k++) {
          const v = lufs[(head + k) % HIST];
          if (!Number.isFinite(v)) { started = false; continue; }
          const x = (k / (HIST - 1)) * W, y = yOf(v);
          if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
        }
        g.strokeStyle = '#3df0d0'; g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); release(); };
  }, []);

  const corrPct = ((st.corr + 1) / 2) * 100;
  return (
    <div className="mx-master">
      <canvas ref={specCv} className="mx-spec" title="espectro del máster (lo que suena): Hz abajo, dBFS a la izquierda; ámbar = picos" />
      <div className="mx-master-side">
        <div className="mx-stereo">
          <canvas ref={gonCv} className="mx-gon" title="goniómetro: vertical = centro (mono), horizontal = lados (ancho)" />
          <div className="mx-st-read">
            <span title="+1 = mono · 0 = sin relación · negativo = fuera de fase (se cancela en mono)">correlación</span>
            <div className={`mx-corr${st.corr < 0 ? ' bad' : ''}`}><i style={{ left: `${corrPct}%` }} /></div>
            <b className={st.corr < 0 ? 'bad' : ''}>{st.corr.toFixed(2)}</b>
            <span>balance</span><b>{Math.abs(st.bal) < 0.02 ? 'centro' : st.bal < 0 ? `I ${Math.round(-st.bal * 100)}` : `D ${Math.round(st.bal * 100)}`}</b>
            <span>ancho</span><b>{Math.round(st.width * 100)}%</b>
          </div>
        </div>
        <div className="mx-lufs-hist">
          <div className="mx-lufs-head">
            <span>sonoridad (LUFS corto plazo · 2 min)</span>
            <select value={target} onChange={(e) => setTarget(Number(e.target.value))} aria-label="objetivo">
              <option value={-14}>objetivo −14 (stream)</option>
              <option value={-8}>objetivo −8 (club)</option>
            </select>
          </div>
          <canvas ref={histCv} className="mx-lhist" />
        </div>
        <LufsMeter />
      </div>
    </div>
  );
}
