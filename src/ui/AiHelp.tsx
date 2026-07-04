import { useEffect, useMemo, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { localDiagnostics, analyzeLoops, requestAiFix, detectBrokenSource, quickFixCode, helpContext, type Diagnostic, type AiFix, type BrokenSource } from '../lib/aiHelp';
import { requestAgent, applyActions, requestMixReview } from '../lib/aiAgent';
import { validStrudel } from '../lib/aiGraph';

// Nod-IA: el asistente propio de Telar. (1) CHAT que ACTÚA — crea/cambia/arregla el
// proyecto hablando ("hazme un dembow", "quita el hi-hat", variaciones de 1 clic,
// "revisar mezcla"); (2) revisa el proyecto y explica qué pasa; (3) REPARA/VARÍA el
// código de un source y lo deja SONANDO (lo conecta al Out y reproduce).
const VARIATIONS = ['otra versión', 'más intenso', 'breakdown', 'menos denso', 'más oscuro'];
const IDEAS = ['hazme un techno oscuro a 135', 'un dembow a 95', 'quítale el hi-hat', 'añade un bajo 808'];

export function AiHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [scanning, setScanning] = useState(false);
  const [tick, setTick] = useState(0);

  const nodes = useGraphStore((s) => s.nodes);
  const sources = useMemo(() => nodes.filter((n) => n.data.kind === 'source'), [nodes]);

  // agente (chat que actúa)
  const [instr, setInstr] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [agentErr, setAgentErr] = useState<string | null>(null);

  // reparar / variar un source
  const [repairFor, setRepairFor] = useState<string>('');
  const [repairCode, setRepairCode] = useState('');
  const [repairing, setRepairing] = useState<false | 'fix' | 'vary'>(false);
  const [repairErr, setRepairErr] = useState<string | null>(null);
  const [fix, setFix] = useState<AiFix | null>(null);
  const [applied, setApplied] = useState(false);
  const [detected, setDetected] = useState<BrokenSource | null>(null);

  useEffect(() => {
    if (!open) return;
    setDiags(localDiagnostics());
    setScanning(true);
    const b = detectBrokenSource();
    setDetected(b);
    if (b) { setRepairFor((p) => p || b.id); setRepairCode((p) => (p.trim() ? p : b.code)); }
    let alive = true;
    void analyzeLoops().then((loop) => { if (alive) { setDiags([...localDiagnostics(), ...loop]); setScanning(false); } }).catch(() => { if (alive) setScanning(false); });
    return () => { alive = false; };
  }, [open, tick]);

  if (!open) return null;

  const runAgent = async (text: string) => {
    const t = text.trim();
    if (agentBusy || !t) return;
    setAgentBusy(true); setAgentErr(null); setAgentReply(null);
    try {
      const { reply, actions } = await requestAgent(t, helpContext());
      const res = applyActions(actions);
      const done = res.applied.length ? `\n\n✓ ${res.applied.join(' · ')}` : '';
      const warn = res.skipped.length ? `\n⚠ omití: ${res.skipped.join(' · ')}` : '';
      setAgentReply((reply || (res.applied.length ? 'Hecho.' : 'Listo.')) + done + warn);
      setTimeout(() => setTick((x) => x + 1), 90);
    } catch (e) {
      setAgentErr(e instanceof Error ? e.message : 'no se pudo');
    } finally {
      setAgentBusy(false);
    }
  };

  // "revisar mezcla" (D): usa la revisión DEDICADA (foto de la mezcla real + LUFS) →
  // reequilibra niveles/pan/EQ y protege de clipping. Mejor que una instrucción de texto.
  const runMixReview = async () => {
    if (agentBusy) return;
    setAgentBusy(true); setAgentErr(null); setAgentReply(null);
    try {
      const { reply, actions } = await requestMixReview();
      const res = applyActions(actions);
      const done = res.applied.length ? `\n\n✓ ${res.applied.join(' · ')}` : '';
      const warn = res.skipped.length ? `\n⚠ omití: ${res.skipped.join(' · ')}` : '';
      setAgentReply((reply || (res.applied.length ? 'Mezcla ajustada.' : 'La mezcla ya está equilibrada.')) + done + warn);
      setTimeout(() => setTick((x) => x + 1), 90);
    } catch (e) {
      setAgentErr(e instanceof Error ? e.message : 'no se pudo revisar la mezcla');
    } finally {
      setAgentBusy(false);
    }
  };

  const runDiagFix = (d: Diagnostic) => { d.fix?.apply(); setTimeout(() => setTick((t) => t + 1), 60); };

  const pickSource = (id: string) => {
    setRepairFor(id); setFix(null); setApplied(false); setRepairErr(null);
    const n = sources.find((s) => s.id === id);
    setRepairCode(n ? ((n.data.code as string) ?? '') : '');
  };

  const doRepair = async (intent: 'fix' | 'vary') => {
    if (repairing || !repairCode.trim()) return;
    setRepairing(intent); setRepairErr(null); setFix(null); setApplied(false);
    try {
      const f = await requestAiFix(repairCode, intent === 'fix' ? useGraphStore.getState().runtimeError : null, helpContext(), intent);
      if (!validStrudel(f.code)) throw new Error('no pasó la validación de seguridad; prueba de nuevo');
      setFix(f);
    } catch (e) {
      setRepairErr(e instanceof Error ? e.message : 'no se pudo');
    } finally {
      setRepairing(false);
    }
  };

  // aplica el arreglo/variación y lo deja SONANDO (corrige, conecta al Out y reproduce).
  const applyFix = () => {
    if (!fix) return;
    const st = useGraphStore.getState();
    if (repairFor) {
      st.updateNodeData(repairFor, { code: fix.code });
      const outs = st.nodes.filter((n) => n.data.kind === 'out');
      const wired = st.edges.some((e) => e.source === repairFor);
      if (!wired && outs[0]) st.onConnect({ source: repairFor, target: outs[0].id, sourceHandle: null, targetHandle: null });
    } else {
      st.addPattern(fix.code, 'nuevo', {}, undefined, { connectToOut: true });
    }
    useGraphStore.setState({ runtimeError: null });
    if (!st.playing) void st.play();
    setApplied(true);
    setTimeout(() => setTick((t) => t + 1), 80);
  };

  const hasError = diags.some((d) => d.level === 'error');
  const quick = !fix ? quickFixCode(repairCode) : null;

  return (
    <>
      <div className="ai-backdrop" onClick={onClose} />
      <div className="ai-panel aih">
        <header className="ai-head">
          <span className="ai-title">Nod-IA</span>
          <button className="ai-x" onClick={onClose} title="cerrar (Esc)">×</button>
        </header>
        <p className="aih-intro">Soy Nod-IA. <b>Pídeme música o cambios y los hago</b>: crear un beat, variar lo que suena, mezclar o arreglar un source. 🎛️</p>

        {/* CHAT que ACTÚA */}
        <div className="aih-agent">
          <textarea
            className="ai-input"
            value={instr}
            placeholder={'dime qué hacer… p.ej. «hazme un dembow oscuro a 95» · «quita el hi-hat» · «sube el bajo»'}
            onChange={(e) => setInstr(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void runAgent(instr); }}
            rows={2}
          />
          <div className="ai-actions">
            <button className="ai-go" onClick={() => void runAgent(instr)} disabled={agentBusy || !instr.trim()}>{agentBusy ? 'trabajando…' : 'enviar ▸'}</button>
            <button className="ai-go aih-quick" onClick={() => void runMixReview()} disabled={agentBusy} title="revisa la mezcla REAL (niveles, pan, EQ por canal, loudness) y la reequilibra; protege de clipping">revisar mezcla</button>
          </div>
          <div className="aih-chips">
            {IDEAS.map((q) => <button key={q} className="aih-chip" onClick={() => { setInstr(q); void runAgent(q); }}>{q}</button>)}
          </div>
          <div className="aih-chips aih-var">
            <span className="aih-var-tag">variaciones</span>
            {VARIATIONS.map((v) => <button key={v} className="aih-chip aih-varchip" onClick={() => void runAgent(v)} disabled={agentBusy}>{v}</button>)}
          </div>
          {agentErr && <div className="ai-err">⚠ {agentErr}</div>}
          {agentReply && <div className="aih-answer">{agentReply}</div>}
        </div>

        <div className="aih-diag-head">
          <span>{hasError ? '⚠ encontré algo que resolver' : 'revisión del proyecto'}{scanning ? ' · analizando…' : ''}</span>
          <button className="aih-rescan" onClick={() => setTick((t) => t + 1)} title="volver a revisar">↻ revisar</button>
        </div>
        <div className="aih-diags">
          {diags.map((d, i) => (
            <div key={i} className={`aih-diag ${d.level}`}>
              <div className="aih-diag-top">
                <span className="aih-dot" />
                <b>{d.title}</b>
                {d.fix && <button className="aih-fix" onClick={() => runDiagFix(d)}>{d.fix.label}</button>}
              </div>
              <p>{d.detail}</p>
            </div>
          ))}
        </div>

        {/* REPARAR / VARIAR un source */}
        <div className="aih-repair">
          <div className="aih-repair-head">reparar o variar un source</div>
          {detected && <div className="aih-detected">🔎 Detecté que <b>«{detected.name}»</b> {detected.reason}. Lo cargué abajo.</div>}
          <div className="aih-repair-src">
            <select value={repairFor} onChange={(e) => pickSource(e.target.value)} title="elige el source (carga su código)">
              <option value="">nuevo (crear un source)</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{(s.data.name as string)?.trim() || (s.data.code as string)?.slice(0, 22) || s.id}</option>)}
            </select>
          </div>
          <textarea
            className="ai-input aih-repair-code"
            value={repairCode}
            placeholder={'código del source (o elige uno arriba)\nej.: s("bd*4").lpf(800)'}
            onChange={(e) => { setRepairCode(e.target.value); setFix(null); setApplied(false); }}
            rows={2}
            spellCheck={false}
          />
          <div className="ai-actions">
            {quick && <button className="ai-go aih-quick" onClick={() => setFix({ code: quick, explain: 'Arreglo rápido: quité la(s) llamada(s) a efectos sin argumento (la causa típica).', tip: 'Si querías ese efecto, vuelve a añadirlo con un valor, p.ej. .lpf(800).' })} title="sin IA, al instante">arreglo rápido</button>}
            <button className="ai-go" onClick={() => void doRepair('fix')} disabled={!!repairing || !repairCode.trim()}>{repairing === 'fix' ? 'reparando…' : 'reparar con IA'}</button>
            {repairFor && <button className="ai-go aih-quick" onClick={() => void doRepair('vary')} disabled={!!repairing || !repairCode.trim()} title="hazme una variación de este source">{repairing === 'vary' ? 'variando…' : 'variar'}</button>}
          </div>
          {repairErr && <div className="ai-err">⚠ {repairErr}</div>}
          {fix && (
            <div className="aih-fixbox">
              <p className="aih-fix-explain">{fix.explain}</p>
              <pre className="aih-fix-code">{fix.code}</pre>
              {fix.tip && <p className="aih-fix-tip">💡 {fix.tip}</p>}
              {applied ? <div className="aih-applied">✓ aplicado y sonando</div> : <button className="ai-go aih-apply" onClick={applyFix}>aplicar y sonar ▸</button>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
