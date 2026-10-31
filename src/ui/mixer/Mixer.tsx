import { useEffect, useMemo, useRef } from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { useMixerStore, type MixTab } from '../../store/useMixerStore';
import { useDetailStore } from '../../store/useDetailStore';
import { useTrackColorStore } from '../../store/useTrackColorStore';
import { getSourceCompGr } from '../../audio/engine';
import { getLufs } from '../../audio/lufsMeter';
import { OPS_BY_ID } from '../../graph/ops';
import { eqResponse, xToFreq } from '../../lib/mixMath';
import { dbToGain, gainToDb, fmtDbShort, fmtPan } from '../../lib/dawFolders';
import { channelCompActive, DEFAULT_CHANNEL_EQ, type NodeData } from '../../graph/types';
import { returnsFromMaster } from '../../lib/returns';
import { TrackMeter } from '../TrackMeter';
import { Knob } from '../Knob';
import { ErrorBoundary } from '../ErrorBoundary';
import { EqView } from './EqView';
import { CompView } from './CompView';
import { ChainView } from './ChainView';
import { MasterView } from './MasterView';
import { SpatialMix } from '../SpatialMix';
import './Mixer.css';

// MEZCLADOR (Fase 11.1): una TIRA por pista — color, inserts en orden, EQ y compresor en miniatura,
// envíos, paneo, fader en dB con medidor (pico con retención y aviso de clip), mute/solo — más los
// dos retornos y el máster con su LUFS. Tocar una tira la elige; a la derecha, su INSPECTOR.

const TABS: { id: MixTab; label: string; title: string }[] = [
  { id: 'eq', label: 'EQ', title: 'EQ visual sobre el espectro de la pista (11.2)' },
  { id: 'comp', label: 'compresor', title: 'curva y reducción del compresor, y el bombeo del sidechain (11.3)' },
  { id: 'chain', label: 'cadena', title: 'la cadena de efectos, con la automatización a la vista, y las macros (11.5)' },
  { id: 'master', label: 'máster', title: 'espectro, estéreo e historial de sonoridad del máster (11.4)' },
  { id: 'stage', label: 'escenario', title: 'la mezcla como un escenario: paneo × frecuencia, con los choques (11.6)' },
];

function MiniEq({ eq, color }: { eq: NodeData['eq']; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const on = !!eq && eq.on !== false;
  const curve = useMemo(() => eqResponse(on ? { ...DEFAULT_CHANNEL_EQ, ...eq } : undefined, Array.from({ length: 48 }, (_, i) => xToFreq(i, 47))), [on, eq?.low, eq?.mid, eq?.high, eq?.midFreq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth || 70, H = c.clientHeight || 22;
    c.width = W * 2; c.height = H * 2;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(160,180,190,0.25)';
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.beginPath();
    curve.forEach((d, i) => { const x = (i / 47) * W, y = H / 2 - (Math.max(-15, Math.min(15, d)) / 15) * (H / 2 - 2); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = on ? color : 'rgba(160,180,190,0.5)';
    g.lineWidth = 1.5;
    g.stroke();
  }, [curve, color, on]);
  return <canvas ref={ref} className="mx-mini-eq" />;
}

function GrBar({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = useGraphStore.getState().playing ? getSourceCompGr(id) : 0;
      if (ref.current) ref.current.style.width = `${Math.min(100, (-g / 18) * 100)}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id]);
  return <div className="mx-gr"><div ref={ref} className="mx-gr-fill" /></div>;
}

// efectos por los que pasa la pista, en orden (sus nombres)
function inserts(id: string, nodes: { id: string; data: NodeData }[], edges: { source: string; target: string }[]): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  const q = [id];
  while (q.length) {
    const cur = q.shift()!;
    for (const e of edges) {
      if (e.source !== cur || seen.has(e.target)) continue;
      seen.add(e.target);
      const n = nodes.find((x) => x.id === e.target);
      if (!n) continue;
      if (n.data.kind === 'fx' || n.data.kind === 'transform') out.push(n.data.opId ? OPS_BY_ID[n.data.opId]?.label ?? n.data.opId : n.data.kind);
      q.push(n.id);
    }
  }
  return out;
}

function Strip({ id, data, color, sel, ins }: { id: string; data: NodeData; color: string; sel: boolean; ins: string[] }) {
  const update = useGraphStore((s) => s.updateNodeData);
  const select = useMixerStore((s) => s.select);
  const gain = Number(data.gain ?? 1);
  const db = gainToDb(Number.isFinite(gain) ? gain : 1);
  const pan = typeof data.chPan === 'number' ? data.chPan : 0.5;
  const comp = channelCompActive(data.comp);
  const name = (data.name ?? '').trim() || id;
  return (
    <div className={`mx-strip${sel ? ' sel' : ''}${data.mute ? ' muted' : ''}`} style={{ ['--tc' as string]: color }} onPointerDown={() => select(id)}>
      <button className="mx-name" title={`${name} · tocar para ver su inspector`} onClick={() => select(id)}>{name}</button>
      <div className="mx-ins" title={ins.length ? `inserts: ${ins.join(' → ')}` : 'sin efectos en el grafo'} onClick={() => select(id, 'chain')}>
        {ins.length ? ins.slice(0, 3).map((x, i) => <span key={i}>{x}</span>) : <em>sin inserts</em>}
        {ins.length > 3 && <span>+{ins.length - 3}</span>}
      </div>
      <div className="mx-cell" onClick={() => select(id, 'eq')} title="EQ (clic: EQ visual)"><MiniEq eq={data.eq} color={color} /></div>
      <div className={`mx-cell mx-compcell${comp ? ' on' : ''}`} onClick={() => select(id, 'comp')} title="compresor (clic: verlo)">
        <span>{comp ? `comp ${(data.comp?.ratio ?? 4).toFixed(1)}:1` : 'comp off'}</span>
        <GrBar id={id} />
      </div>
      <div className="mx-sends">
        <label title="envío a la reverb compartida"><Knob value={Number(data.sends?.rev ?? 0)} min={0} max={1} step={0.01} size={22} defaultValue={0} label="envío reverb" hideValue onChange={(v) => update(id, { sends: { ...(data.sends ?? {}), rev: v } })} /><span>rev</span></label>
        <label title="envío al eco compartido"><Knob value={Number(data.sends?.del ?? 0)} min={0} max={1} step={0.01} size={22} defaultValue={0} label="envío eco" hideValue onChange={(v) => update(id, { sends: { ...(data.sends ?? {}), del: v } })} /><span>eco</span></label>
        <label title={`paneo: ${fmtPan(pan)}`}><Knob value={pan} min={0} max={1} step={0.01} size={22} defaultValue={0.5} label="paneo" hideValue onChange={(v) => update(id, { chPan: Math.round(v * 100) / 100 })} /><span>{fmtPan(pan)}</span></label>
      </div>
      <div className="mx-faderrow">
        <input className="mx-fader" type="range" min={-60} max={6} step={0.1} value={db} aria-label={`volumen de ${name} en dB`}
          onChange={(e) => update(id, { gain: Math.round(dbToGain(Number(e.target.value)) * 10000) / 10000 })}
          onDoubleClick={() => update(id, { gain: 1 })} title={`${fmtDbShort(db)} dB · doble clic = 0 dB`} />
        <TrackMeter id={id} db className="tmeter-mix-v" />
      </div>
      <span className="mx-db">{fmtDbShort(db)} dB</span>
      <div className="mx-ms">
        <button className={data.mute ? 'on mute' : ''} onClick={() => update(id, { mute: !data.mute })} title="mute">M</button>
        <button className={data.solo ? 'on solo' : ''} onClick={() => update(id, { solo: !data.solo })} title="solo">S</button>
      </div>
    </div>
  );
}

function ReturnStrip({ which }: { which: 'rv' | 'dl' }) {
  const master = useGraphStore((s) => s.master);
  const setMaster = useGraphStore((s) => s.setMaster);
  const r = returnsFromMaster(master);
  const v = which === 'rv' ? r.rvLevel : r.dlLevel;
  return (
    <div className="mx-strip ret">
      <span className="mx-name">{which === 'rv' ? 'reverb' : 'eco'}</span>
      <div className="mx-ins"><em>retorno compartido</em></div>
      <div className="mx-faderrow">
        <input className="mx-fader" type="range" min={-30} max={6} step={0.5} value={v} aria-label={`nivel del retorno de ${which === 'rv' ? 'reverb' : 'eco'}`}
          onChange={(e) => setMaster(which === 'rv' ? { rvLevel: Number(e.target.value) } : { dlLevel: Number(e.target.value) })}
          onDoubleClick={() => setMaster(which === 'rv' ? { rvLevel: 0 } : { dlLevel: 0 })} />
      </div>
      <span className="mx-db">{fmtDbShort(v)} dB</span>
    </div>
  );
}

function MasterStrip() {
  const master = useGraphStore((s) => s.master);
  const setMaster = useGraphStore((s) => s.setMaster);
  const select = useMixerStore((s) => s.select);
  const lref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const t = window.setInterval(() => {
      const r = getLufs();
      if (lref.current) lref.current.textContent = Number.isFinite(r.short) ? `${r.short.toFixed(1)} LUFS` : '— LUFS';
    }, 250);
    return () => window.clearInterval(t);
  }, []);
  const db = gainToDb(Number(master.gain ?? 1));
  return (
    <div className="mx-strip master" onPointerDown={() => select(null, 'master')}>
      <button className="mx-name" onClick={() => select(null, 'master')}>máster</button>
      <span className="mx-lufs" ref={lref}>— LUFS</span>
      <div className="mx-faderrow">
        <input className="mx-fader" type="range" min={-60} max={6} step={0.1} value={db} aria-label="volumen del máster en dB"
          onChange={(e) => setMaster({ gain: Math.round(dbToGain(Number(e.target.value)) * 1000) / 1000 })}
          onDoubleClick={() => setMaster({ gain: 1 })} />
      </div>
      <span className="mx-db">{fmtDbShort(db)} dB</span>
    </div>
  );
}

export function Mixer() {
  const open = useMixerStore((s) => s.open);
  const setOpen = useMixerStore((s) => s.setOpen);
  const sel = useMixerStore((s) => s.sel);
  const tab = useMixerStore((s) => s.tab);
  const setTab = useMixerStore((s) => s.setTab);
  const select = useMixerStore((s) => s.select);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const colors = useTrackColorStore((s) => s.map);
  const setH = useDetailStore((s) => s.setH);
  const drag = useRef<{ y0: number; h0: number } | null>(null);
  const tracks = nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions) && !n.data.djTrack); // los decks de tema son del modo DJ
  // X abre/cierra el mezclador (fuera de los campos de texto y del código)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'x') return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('.cm-editor'))) return;
      if (useGraphStore.getState().mode === 'dj') return;
      e.preventDefault();
      useMixerStore.getState().toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // sin pista elegida (o borrada): la primera
  const cur = sel && tracks.some((t) => t.id === sel) ? sel : null;
  useEffect(() => { if (open && !cur && tracks.length && tab !== 'master' && tab !== 'stage') select(tracks[0].id); }, [open, cur, tracks.length, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const selName = cur ? (tracks.find((t) => t.id === cur)?.data.name ?? cur) : '';
  return (
    <section className="detail mixer" aria-label="mezclador">
      <div className="detail-resize" role="separator" aria-orientation="horizontal" aria-label="alto del mezclador" title="arrastra para cambiar el alto"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y0: e.clientY, h0: useDetailStore.getState().h }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setH(d.h0 + (d.y0 - e.clientY)); }}
        onPointerUp={() => { drag.current = null; }} />
      <header className="detail-head">
        <span className="detail-dot" style={{ background: '#e7b84a' }} />
        <b className="detail-name">mezclador</b>
        <div className="mx-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} title={t.title}>{t.label}</button>
          ))}
        </div>
        <span className="detail-hint">{tab === 'master' || tab === 'stage' ? '' : selName ? `inspector: ${selName}` : ''}</span>
        <button className="detail-x" onClick={() => setOpen(false)} title="cerrar el mezclador" aria-label="cerrar el mezclador">×</button>
      </header>
      <div className="mx-body">
        <div className="mx-strips" role="list">
          {tracks.map((n) => (
            <Strip key={n.id} id={n.id} data={n.data as NodeData} color={colors[n.id] ?? '#3df0d0'} sel={cur === n.id && tab !== 'master' && tab !== 'stage'} ins={inserts(n.id, nodes, edges)} />
          ))}
          <ReturnStrip which="rv" />
          <ReturnStrip which="dl" />
          <MasterStrip />
        </div>
        <div className="mx-insp">
          <ErrorBoundary variant="panel" label="inspector">
            {tab === 'master' ? <MasterView />
              : tab === 'stage' ? <SpatialMix open inline onClose={() => setTab('eq')} />
              : !cur ? <p className="mx-note">Elige una pista.</p>
              : tab === 'eq' ? <EqView key={cur} id={cur} />
              : tab === 'comp' ? <CompView key={cur} id={cur} />
              : <ChainView key={cur} id={cur} />}
          </ErrorBoundary>
        </div>
      </div>
    </section>
  );
}
