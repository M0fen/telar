import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '../graph/types';
import { useGraphStore } from '../store/useGraphStore';
import { sampleDuration } from './audioMeta';
import { detectBpm } from './bpm';
import { resolveSampleUrl, firstSampleName, loopAtValue } from './sampleResolve';

type N = Node<NodeData>;

export interface DiagFix { label: string; apply: () => void }
export interface Diagnostic {
  level: 'error' | 'warn' | 'info' | 'ok';
  title: string;
  detail: string;
  fix?: DiagFix;
}

// Conjunto de nodos con un camino hacia algún Out (siguiendo edges source→target).
function reachingOut(nodes: N[], edges: Edge[]): Set<string> {
  const outs = new Set(nodes.filter((n) => n.data.kind === 'out').map((n) => n.id));
  const fwd = new Map<string, string[]>();
  for (const e of edges) { const a = fwd.get(e.source) ?? []; a.push(e.target); fwd.set(e.source, a); }
  const memo = new Map<string, boolean>();
  const can = (id: string): boolean => {
    if (outs.has(id)) return true;
    const m = memo.get(id);
    if (m !== undefined) return m;
    memo.set(id, false); // corta ciclos
    let r = false;
    for (const nxt of fwd.get(id) ?? []) if (can(nxt)) { r = true; break; }
    memo.set(id, r);
    return r;
  };
  const set = new Set<string>();
  for (const n of nodes) if (can(n.id)) set.add(n.id);
  return set;
}

// Diagnósticos INSTANTÁNEOS (sin red): conexión al Out, alineación de arrange, errores.
export function localDiagnostics(): Diagnostic[] {
  const st = useGraphStore.getState();
  const nodes = st.nodes as N[];
  const edges = st.edges;
  const out: Diagnostic[] = [];

  const retryFix: DiagFix = {
    label: 'reintentar',
    apply: () => { useGraphStore.setState({ runtimeError: null, compileError: null }); useGraphStore.getState().recompile(); },
  };
  if (st.compileError)
    out.push({ level: 'error', title: 'algo del grafo no compila', detail: `${explainError(st.compileError)}  ·  (detalle: ${st.compileError})`, fix: retryFix });
  if (st.runtimeError)
    out.push({ level: 'error', title: 'algo no suena bien al reproducir', detail: `${explainError(st.runtimeError)}  ·  Puedes pegar el código del source de abajo en «reparar código» y lo dejo sonando.  (detalle: ${st.runtimeError})`, fix: retryFix });

  const reach = reachingOut(nodes, edges);
  const outs = nodes.filter((n) => n.data.kind === 'out');
  for (const n of nodes) {
    if (n.data.kind !== 'source' || n.data.mute) continue;
    if (!reach.has(n.id)) {
      const nm = (n.data.name || firstSampleName(n.data.code ?? '') || n.id).toString();
      out.push({
        level: 'warn',
        title: `"${nm}" no suena`,
        detail: 'no está conectado al Out (una fuente suelta no se oye). Conéctala al Out.',
        fix: outs.length
          ? { label: 'conectar al Out', apply: () => useGraphStore.getState().onConnect({ source: n.id, target: outs[0].id, sourceHandle: null, targetHandle: null }) }
          : undefined,
      });
    }
  }

  // alineación de arrange: todas las pistas con arrange deben sumar los mismos ciclos
  const totals = new Map<number, string[]>();
  for (const n of nodes) {
    if (n.data.kind !== 'source') continue;
    const c = n.data.code ?? '';
    if (!c.includes('arrange')) continue;
    const nums = [...c.matchAll(/\[(\d+),/g)].map((x) => Number(x[1]));
    if (!nums.length) continue;
    const t = nums.reduce((a, b) => a + b, 0);
    const arr = totals.get(t) ?? [];
    arr.push((n.data.name || n.id).toString());
    totals.set(t, arr);
  }
  if (totals.size > 1) {
    const desc = [...totals.entries()].map(([t, ns]) => `${t} ciclos: ${ns.join(', ')}`).join(' · ');
    out.push({ level: 'warn', title: 'secciones desalineadas', detail: `las pistas con "entradas" (arrange) no suman los mismos ciclos → se desincronizan. ${desc}` });
  }

  if (!out.length) out.push({ level: 'ok', title: 'sin problemas evidentes', detail: 'conexiones y estructura correctas. Si algo suena raro, pregunta a la IA abajo.' });
  return out;
}

// Análisis ASÍNCRONO de LOOPS (tempo/pitch): decodifica el sample, detecta su BPM y
// avisa si loopAt lo está pitcheando; ofrece arreglo de 1 clic (pitch natural + al grid
// ajustando el tempo, o pitch natural al tempo actual).
export async function analyzeLoops(): Promise<Diagnostic[]> {
  const st = useGraphStore.getState();
  const nodes = st.nodes as N[];
  const cps = st.cps || 0.5;
  const bpc = st.beatsPerCycle || 4;
  const out: Diagnostic[] = [];

  for (const n of nodes) {
    if (n.data.kind !== 'source') continue;
    const code = n.data.code ?? '';
    const N0 = loopAtValue(code);
    if (N0 == null) continue; // solo loops con loopAt
    const name = firstSampleName(code);
    const url = resolveSampleUrl(name);
    if (!url) { continue; }
    const dur = await sampleDuration(url).catch(() => 0);
    if (!dur || !isFinite(dur)) continue;
    const label = (n.data.name || name || n.id).toString();
    // velocidad actual del loop: dur real vs. lo que ocupa (N0 ciclos)
    const speed = (dur * cps) / N0;
    const semis = 12 * Math.log2(speed);
    if (Math.abs(semis) < 0.5) continue; // ya suena natural

    // BPM detectado → nº de compases del loop → tempo natural (cps') que lo alinea al grid
    const bpm = await detectBpm(url).catch(() => null);
    let bars = bpm ? Math.round((dur * bpm) / (60 * bpc)) : Math.max(1, Math.round(dur * cps));
    bars = Math.max(1, Math.min(64, bars));
    const naturalCps = bars / dur; // 1 ciclo = 1 compás → cps que hace loopAt(bars) natural
    const naturalBpm = Math.round(naturalCps * 60 * bpc);
    const dir = semis > 0 ? 'agudo (más rápido)' : 'grave (más lento)';

    const applyNaturalGrid = () => {
      const s = useGraphStore.getState();
      s.setCpsValue(naturalCps);
      const newCode = code.replace(/\.loopAt\(\s*[0-9.]+\s*\)/, `.loopAt(${bars})`);
      s.updateNodeData(n.id, { code: newCode });
    };
    const applyNaturalSameTempo = () => {
      const s = useGraphStore.getState();
      const nb = Math.max(1, Math.min(512, Math.round(dur * (s.cps || 0.5))));
      const newCode = code.replace(/\.loopAt\(\s*[0-9.]+\s*\)/, `.loopAt(${nb})`);
      s.updateNodeData(n.id, { code: newCode });
    };

    out.push({
      level: 'warn',
      title: `"${label}" está pitcheado ${semis > 0 ? '+' : ''}${semis.toFixed(1)} semitonos (${dir})`,
      detail: `el sample dura ${dur.toFixed(2)}s (~${bars} compás/es${bpm ? `, ~${bpm} BPM` : ''}) pero loopAt(${N0}) lo estira para encajarlo al tempo actual, cambiando su velocidad y pitch. Para pitch NATURAL y al grid, pon el proyecto a ~${naturalBpm} BPM con loopAt(${bars}).`,
      fix: { label: `pitch natural → ${naturalBpm} BPM`, apply: applyNaturalGrid },
      // segundo arreglo alternativo se expone en la UI vía detail; el principal ajusta tempo
    });
    // arreglo alternativo (mismo tempo, pitch natural aunque no cuadre a compases enteros)
    out.push({
      level: 'info',
      title: `alternativa para "${label}"`,
      detail: 'si prefieres NO cambiar el tempo del proyecto, ajusta loopAt para que suene a pitch natural (puede no cuadrar a compases exactos). O trocea con chop (no cambia el pitch).',
      fix: { label: 'pitch natural (mismo tempo)', apply: applyNaturalSameTempo },
    });
  }
  return out;
}

// Contexto compacto para la IA (nombres + código + errores + tempo).
export function helpContext(): unknown {
  const st = useGraphStore.getState();
  const nodes = (st.nodes as N[]).map((n) => ({
    id: n.id, kind: n.data.kind, name: n.data.name,
    code: (n.data.code ?? '').slice(0, 240),
    opId: n.data.opId,
  }));
  return {
    cps: st.cps, bpm: Math.round((st.cps || 0.5) * 60 * (st.beatsPerCycle || 4)),
    nodes, edges: st.edges.map((e) => ({ s: e.source, t: e.target })),
    master: st.master,
    compileError: st.compileError, runtimeError: st.runtimeError,
  };
}

// Traduce un error crudo (de Strudel/compilador) a lenguaje humano con QUÉ HACER.
// Cubre los casos comunes; el resto cae a una guía genérica accionable.
export function explainError(msg: string): string {
  const m = (msg || '').toLowerCase();
  const rd = /reading '([^']+)'/.exec(msg);
  if (rd) return `un source tiene el código incompleto: se aplica “.${rd[1]}(…)” sobre algo vacío. Suele faltar el patrón antes del efecto (p.ej. escribir “.${rd[1]}()” sin un s("…")/note("…") delante) o hay un método mal escrito. Abre ese source, corrige el código (o repáralo con IA aquí) y vuelve a sonar.`;
  if (/is not a function/.test(m)) return 'se usó un método que Strudel no reconoce (nombre inventado o mal escrito). Revisa el último efecto que añadiste al source; déjame repararlo abajo si quieres.';
  if (/is not defined/.test(m)) return 'hay un nombre/variable que Strudel no conoce (una nota, sonido o palabra suelta mal escrita). Revísalo en el código del source.';
  if (/unexpected token|syntaxerror|unexpected end/.test(m)) return 'error de sintaxis: falta o sobra un paréntesis, coma o comilla en el código de un source. Revisa que cada “(” tenga su “)” y cada comilla su pareja.';
  if (/ciclo en el grafo/.test(m)) return 'hay un cable que forma un bucle (una fuente que se alimenta a sí misma). Quita ese cable.';
  if (/sin nodo out|out sin entrada|no está conectado/.test(m)) return 'no hay camino hasta el Out: conecta la fuente al nodo Out con un cable para que se oiga.';
  if (/source vacío|nada que sonar/.test(m)) return 'hay un source sin código. Escribe un patrón (p.ej. s("bd*4")) o bórralo.';
  return 'Strudel no pudo reproducir el patrón. Suele ser un source con el código incompleto o un método mal escrito. Pega su código en «reparar código» y lo dejo sonando.';
}

// Métodos que EXIGEN argumento: una llamada vacía `.lpf()` / `.fast()` es la causa más
// típica de "Cannot read properties of undefined (reading '…')" y de que un source no
// suene. Sirve para detectar el source roto y para el arreglo rápido offline.
const NEEDS_ARG = /\.(lpf|hpf|bpf|cutoff|hcutoff|lpq|hpq|fast|slow|gain|room|roomsize|delay|note|n|chop|ply|euclid|euclidRot|scale|arp|speed|shape|distort|crush|coarse|striate|slice|stut|echo|legato|clip|every|off|add|sub|mul|range|loopAt|degradeBy|sometimesBy|segment)\(\s*\)/;

export interface BrokenSource { id: string; name: string; code: string; reason: string }
// Detecta el source MÁS PROBABLEMENTE roto (para pre-cargarlo en «reparar»). Prioriza:
// 1) el método del error "reading 'X'" → el source que usa .X(  2) una llamada a un
// efecto SIN argumento  3) un source vacío.
export function detectBrokenSource(): BrokenSource | null {
  const st = useGraphStore.getState();
  const srcs = (st.nodes as N[]).filter((n) => n.data.kind === 'source' && !n.data.mute);
  const label = (n: N) => (n.data.name || firstSampleName(n.data.code ?? '') || n.id).toString();
  const rt = st.runtimeError || st.compileError || '';
  const m = /reading '([a-zA-Z_$][\w$]*)'/.exec(rt);
  if (m) {
    const meth = m[1];
    const hit = srcs.find((n) => new RegExp('\\.' + meth + '\\s*\\(').test(n.data.code ?? ''));
    if (hit) return { id: hit.id, name: label(hit), code: hit.data.code ?? '', reason: `usa .${meth}(…) probablemente sin el patrón o argumento correcto` };
  }
  const empty = srcs.find((n) => NEEDS_ARG.test(n.data.code ?? ''));
  if (empty) { const mm = NEEDS_ARG.exec(empty.data.code ?? ''); return { id: empty.id, name: label(empty), code: empty.data.code ?? '', reason: `tiene ${mm?.[0] ?? 'un efecto'} sin argumento` }; }
  const blank = srcs.find((n) => !(n.data.code ?? '').trim());
  if (blank) return { id: blank.id, name: label(blank), code: '', reason: 'está vacío (sin patrón)' };
  return null;
}
// Arreglo RÁPIDO offline: quita las llamadas a efectos SIN argumento (la causa típica).
export function quickFixCode(code: string): string | null {
  const fixed = code.replace(new RegExp(NEEDS_ARG.source, 'g'), '').trim();
  return fixed && fixed !== code.trim() ? fixed : null;
}

export interface AiFix { code: string; explain: string; tip?: string }
// Pide a la IA el código CORREGIDO (intent 'fix') o una VARIACIÓN (intent 'vary') de un
// source. Devuelve el arreglo/variación lista para aplicar.
export async function requestAiFix(code: string, error: string | null, context: unknown, intent: 'fix' | 'vary' = 'fix'): Promise<AiFix> {
  const r = await fetch('/api/ai-help', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'fix', code, error, context, intent }),
  });
  const j = (await r.json().catch(() => null)) as { fix?: AiFix; error?: string } | null;
  if (!r.ok || !j) throw new Error((j && j.error) || 'no se pudo reparar');
  if (!j.fix || !j.fix.code) throw new Error(j.error || 'la IA no devolvió un arreglo');
  return j.fix;
}

export async function requestAiHelp(question: string, context: unknown): Promise<string> {
  const r = await fetch('/api/ai-help', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, context }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error((j && (j as { error?: string }).error) || 'no se pudo consultar la IA');
  }
  const j = (await r.json()) as { answer?: string };
  return j.answer ?? '';
}
