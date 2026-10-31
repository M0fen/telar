import { useEffect, useRef } from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { useTrackColorStore } from '../../store/useTrackColorStore';
import { getSourceCompGr } from '../../audio/engine';
import { readTrackSpectrum, releaseTrackSpectrum } from '../../audio/mixTaps';
import { compGainDb } from '../../lib/compCurve';
import { DEFAULT_CHANNEL_COMP, type ChannelComp, type NodeData } from '../../graph/types';
import { Knob } from '../Knob';

// COMPRESOR Y SIDECHAIN A LA VISTA (Fase 11.3): la curva de transferencia (entrada → salida, con su
// rodilla) con el punto donde está la señal ahora, y el HISTORIAL de los últimos segundos: la
// reducción de ganancia del compresor (barras rojas) y el nivel de la pista (línea) — el bombeo del
// sidechain se ve como los valles de esa línea en cada golpe del bombo.

const HIST = 180; // ~6 s a 30 por segundo

export function CompView({ id }: { id: string }) {
  const data = useGraphStore((s) => s.nodes.find((n) => n.id === id)?.data) as NodeData | undefined;
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const update = useGraphStore((s) => s.updateNodeData);
  const color = useTrackColorStore((s) => s.map[id]) ?? '#3df0d0';
  const comp: Required<ChannelComp> = { ...DEFAULT_CHANNEL_COMP, ...(data?.comp ?? {}) } as Required<ChannelComp>;
  const compRef = useRef(comp);
  compRef.current = comp;
  const curveCv = useRef<HTMLCanvasElement>(null);
  const histCv = useRef<HTMLCanvasElement>(null);

  // sidechain duck por el que pasa esta pista (subiendo desde la pista hasta la salida)
  const duck = (() => {
    const seen = new Set<string>();
    const q = [id];
    while (q.length) {
      const cur = q.shift()!;
      for (const e of edges) {
        if (e.source !== cur || seen.has(e.target)) continue;
        seen.add(e.target);
        const n = nodes.find((x) => x.id === e.target);
        if (n?.data.kind === 'fx' && n.data.opId === 'sidechain' && String(n.data.params?.mode ?? 'gen') === 'duck') return n;
        q.push(e.target);
      }
    }
    return null;
  })();
  const trigName = duck ? nodes.find((n) => n.id === String(duck.data.params?.trigger ?? ''))?.data.name ?? 'el bombo' : '';

  useEffect(() => {
    const gr = new Float32Array(HIST);
    const lv = new Float32Array(HIST).fill(-90);
    let head = 0;
    let last = 0;
    const spec = { data: null as Float32Array<ArrayBuffer> | null };
    const time = { buf: null as Float32Array<ArrayBuffer> | null };
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      last = now;
      // nivel de salida de la pista (pico del bloque) y reducción del compresor
      const an = readTrackSpectrum(id, spec);
      let peakDb = -90;
      if (an) {
        if (!time.buf || time.buf.length !== an.fftSize) time.buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(time.buf);
        let pk = 0;
        for (let i = 0; i < time.buf.length; i++) { const v = Math.abs(time.buf[i]); if (v > pk) pk = v; }
        peakDb = pk > 1e-5 ? 20 * Math.log10(pk) : -90;
      }
      const g = useGraphStore.getState().playing ? getSourceCompGr(id) : 0;
      gr[head] = g;
      lv[head] = peakDb;
      head = (head + 1) % HIST;
      const c = compRef.current;
      // CURVA
      const cc = curveCv.current;
      if (cc) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = cc.clientWidth || 160, H = cc.clientHeight || 160;
        if (cc.width !== Math.round(W * dpr)) { cc.width = Math.round(W * dpr); cc.height = Math.round(H * dpr); }
        const x2 = cc.getContext('2d')!;
        x2.setTransform(dpr, 0, 0, dpr, 0, 0);
        x2.clearRect(0, 0, W, H);
        const px = (db: number) => ((db + 60) / 60) * W;
        const py = (db: number) => H - ((db + 60) / 60) * H;
        x2.strokeStyle = 'rgba(120,150,165,0.15)';
        for (let d = -48; d <= 0; d += 12) { x2.beginPath(); x2.moveTo(px(d), 0); x2.lineTo(px(d), H); x2.moveTo(0, py(d)); x2.lineTo(W, py(d)); x2.stroke(); }
        x2.strokeStyle = 'rgba(160,180,190,0.35)';
        x2.beginPath(); x2.moveTo(0, H); x2.lineTo(W, 0); x2.stroke(); // 1:1
        x2.beginPath();
        for (let i = 0; i <= 120; i++) {
          const xin = -60 + i / 2;
          const yout = xin + (c.on ? compGainDb(xin, c.thr, c.ratio) + c.makeup : 0);
          if (i) x2.lineTo(px(xin), py(yout)); else x2.moveTo(px(xin), py(yout));
        }
        x2.strokeStyle = c.on ? color : 'rgba(160,180,190,0.6)';
        x2.lineWidth = 2;
        x2.stroke();
        x2.lineWidth = 1;
        if (c.on) { x2.strokeStyle = '#e46a6a'; x2.setLineDash([3, 3]); x2.beginPath(); x2.moveTo(px(c.thr), 0); x2.lineTo(px(c.thr), H); x2.stroke(); x2.setLineDash([]); }
        // dónde está ahora: entrada ≈ salida − makeup − reducción
        if (peakDb > -60) {
          const xin = Math.max(-60, Math.min(0, peakDb - (c.on ? c.makeup : 0) - g));
          const yout = Math.max(-60, Math.min(0, peakDb));
          x2.beginPath(); x2.arc(px(xin), py(yout), 4, 0, Math.PI * 2); x2.fillStyle = '#e8eef2'; x2.fill();
        }
      }
      // HISTORIAL
      const hc = histCv.current;
      if (hc) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = hc.clientWidth || 300, H = hc.clientHeight || 120;
        if (hc.width !== Math.round(W * dpr)) { hc.width = Math.round(W * dpr); hc.height = Math.round(H * dpr); }
        const x2 = hc.getContext('2d')!;
        x2.setTransform(dpr, 0, 0, dpr, 0, 0);
        x2.clearRect(0, 0, W, H);
        const bw = W / HIST;
        // reducción: de arriba hacia abajo (0 a −24 dB)
        x2.fillStyle = 'rgba(228,106,106,0.75)';
        for (let k = 0; k < HIST; k++) {
          const v = gr[(head + k) % HIST];
          if (v < -0.1) x2.fillRect(k * bw, 0, Math.max(1, bw - 0.3), (Math.min(24, -v) / 24) * H * 0.5);
        }
        // nivel de la pista (−48…0 dBFS)
        x2.beginPath();
        for (let k = 0; k < HIST; k++) {
          const v = lv[(head + k) % HIST];
          const y = H - ((Math.max(-48, v) + 48) / 48) * H;
          if (k) x2.lineTo(k * bw, y); else x2.moveTo(0, y);
        }
        x2.strokeStyle = color;
        x2.lineWidth = 1.5;
        x2.stroke();
        x2.fillStyle = 'rgba(160,180,190,0.5)';
        x2.font = '9px monospace';
        x2.fillText('reducción', 4, 10);
        x2.fillText('nivel', 4, H - 4);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); releaseTrackSpectrum(id); };
  }, [id, color]);

  const set = (patch: Partial<ChannelComp>) => update(id, { comp: { ...comp, ...patch } });
  const p = duck?.data.params ?? {};
  return (
    <div className="mx-comp-view">
      <div className="mx-comp-left">
        <canvas ref={curveCv} className="mx-comp-curve" title="curva del compresor: entrada (abajo) → salida (al lado). La línea roja es el umbral; el punto, dónde está la señal ahora" />
        <div className="mx-knobs">
          <button className={`mx-tog${comp.on ? ' on' : ''}`} onClick={() => set({ on: !comp.on })} title="compresor de la pista encendido / apagado">comp {comp.on ? 'on' : 'off'}</button>
          <label><Knob value={comp.thr} min={-48} max={0} step={0.5} size={28} defaultValue={-18} label="umbral (dBFS)" hideValue onChange={(v) => set({ thr: v, on: true })} /><span>umbral</span><i>{comp.thr.toFixed(1)}</i></label>
          <label><Knob value={comp.ratio} min={1} max={20} step={0.1} size={28} defaultValue={4} label="ratio" hideValue onChange={(v) => set({ ratio: v, on: true })} /><span>ratio</span><i>{comp.ratio.toFixed(1)}:1</i></label>
          <label><Knob value={comp.att} min={0.1} max={100} step={0.1} scale="exp" size={28} defaultValue={10} label="ataque (ms)" hideValue onChange={(v) => set({ att: v })} /><span>ataque</span><i>{comp.att.toFixed(1)} ms</i></label>
          <label><Knob value={comp.rel} min={10} max={1000} step={1} scale="exp" size={28} defaultValue={120} label="release (ms)" hideValue onChange={(v) => set({ rel: v })} /><span>release</span><i>{Math.round(comp.rel)} ms</i></label>
          <label><Knob value={comp.makeup} min={0} max={24} step={0.5} size={28} defaultValue={0} label="makeup (dB)" hideValue onChange={(v) => set({ makeup: v })} /><span>makeup</span><i>+{comp.makeup.toFixed(1)}</i></label>
        </div>
      </div>
      <div className="mx-comp-right">
        <canvas ref={histCv} className="mx-comp-hist" title="los últimos 6 segundos: barras rojas = cuánto baja el compresor; línea = nivel de la pista (el bombeo del sidechain se ve como valles)" />
        {duck ? (
          <div className="mx-duck">
            <span className="mx-duck-t">bombea con <b>«{trigName}»</b> (sidechain)</span>
            <label><Knob value={Number(p.depth ?? 0.7)} min={0.05} max={1} step={0.01} size={26} defaultValue={0.7} label="profundidad del bombeo" hideValue onChange={(v) => update(duck.id, { params: { ...p, depth: v } })} /><span>profundidad</span><i>{Math.round(Number(p.depth ?? 0.7) * 100)}%</i></label>
            <label><Knob value={Number(p.attack ?? 0.1)} min={0.005} max={0.5} step={0.005} size={26} defaultValue={0.1} label="recuperación del bombeo (s)" hideValue onChange={(v) => update(duck.id, { params: { ...p, attack: v } })} /><span>vuelta</span><i>{Math.round(Number(p.attack ?? 0.1) * 1000)} ms</i></label>
          </div>
        ) : (
          <p className="mx-note">Esta pista no pasa por un sidechain. En el grafo: «pump al bombo» (herramientas) o un nodo sidechain en modo duck.</p>
        )}
      </div>
    </div>
  );
}
