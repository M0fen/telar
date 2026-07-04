// Copiloto IA → grafo: pide a /api/ai-graph (proxy DeepSeek) un grafo y lo SANEA
// antes de cargarlo. El código de las fuentes es código que el motor evalúa, así que:
//   1) rechazamos tokens peligrosos (import/fetch/window/…, backticks, funciones flecha);
//   2) validamos la SINTAXIS con un stub que resuelve cualquier identificador a un
//      proxy encadenable (solo detecta errores de sintaxis, no semántica);
//   3) descartamos fuentes inválidas, aseguramos un único Out, reconectamos lo suelto
//      y auto-posicionamos en columnas.
import type { Node, Edge } from '@xyflow/react';
import type { ProjectSnapshot } from './projectStore';
import type { NodeData, NodeKind } from '../graph/types';
import { OPS_BY_ID, defaultParams } from '../graph/ops';

// tokens que no aparecen en mini-notación de Strudel y sí en código malicioso/roto.
const DANGER = /\b(import|require|fetch|eval|Function|window|document|globalThis|constructor|__proto__|prototype|process|async|await|XMLHttpRequest|location|cookie|localStorage)\b|`|=>/;

// Métodos (.metodo(...)) VÁLIDOS de Strudel (controles + transformaciones). Si la IA
// inventa un método (p.ej. .slide().glissando()), esa fuente rompería al evaluar TODO
// el stack; por eso la descartamos. Lista tomada de @strudel/core (controls + pattern).
const VALID_METHODS = new Set<string>([
  's','sound','note','n','bank','gain','pan','velocity','postgain','overgain','amp','channels',
  'lpf','hpf','bpf','cutoff','hcutoff','bandf','lpq','hpq','bandq','resonance','hresonance','vlpf','kcutoff','krush',
  'lpenv','lpattack','lpdecay','lpsustain','lprelease','lpa','lpd','lps','lpr','hpenv','hpattack','hpdecay','bpenv',
  'attack','decay','sustain','release','hold','adsr','curve',
  'room','roomsize','size','roomfade','roomlp','roomdim','dry','orbit','ir',
  'delay','delaytime','delayfeedback','delayfb','delayspeed','delaysync',
  'shape','distort','distorttype','distortvol','crush','coarse','triode','drive','overshape','ring','ringf','ringdf','comb','smear','scram','binshift','freeze','waveloss',
  'speed','unit','begin','end','loop','loopBegin','loopEnd','cut','clip','legato','chop','striate','slice','splice','fit','loopAt','loopAtCps',
  'vowel','noise','fm','fmh','fmi','detune','unison','spread','penv','pdecay','pattack','pcurve','vib','vibmod','octave','octaveR','semitone','ctranspose','mtranspose',
  'accelerate','slide','stretch','warp','duck','duckorbit','duckattack','duckdepth','duckonset','tremolosync','tremolodepth','tremolophase','tremoloshape','tremoloskew',
  'phaser','phasercenter','phaserdepth','phasersweep','leslie','djf','squiz','chorus','enhance',
  'stut','echo','ply','plyWith','plyForEach','stutter',
  'compressor','compressorAttack','compressorRatio','compressorKnee','compressorRelease','gate',
  'fast','slow','hurry','rev','palindrome','iter','iterBack','chunk','chunkBack','chunkinto','brak','press','pressBy',
  'every','everyPrime','firstOf','lastOf','foldEvery','when','whenmod','within','inside','outside','someCyclesBy','someCycles','somecyclesBy','somecycles',
  'jux','juxBy','superimpose','layer','off','stack','seq','cat','arrange','silence','overlay','append','fastcat','slowcat',
  'add','sub','mul','div','range','rangex','ratio','fromBipolar','toBipolar','round','floor','ceil',
  'sometimes','sometimesBy','always','almostAlways','often','rarely','almostNever','never','degrade','degradeBy','undegradeBy','unDegradeBy',
  'struct','mask','euclid','euclidLegato','euclidRot','euclidInv','euclidRotLegato',
  'scale','arp','arpWith','chord','voicing','rootNotes','transpose','mode','root',
  'segment','quantise','quantize','ribbon','zoom','zoomArc','compress','compressSpan','focus','focusSpan','fastGap','filter','filterWhen','pace','apply','applyN','run',
  'color','hsl','hsla',
]);

// valida solo la SINTAXIS del código de una fuente. `with` sobre un proxy hace que
// cualquier identificador resuelva a un objeto encadenable → no lanza ReferenceError;
// solo un error de sintaxis real hace fallar el new Function.
export function validStrudel(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  if (code.length > 2000) return false;
  if (DANGER.test(code)) return false;
  // rechaza métodos inventados por la IA (uno solo rompería todo el stack al evaluar).
  const calls = code.match(/\.([a-zA-Z_$][\w$]*)\s*\(/g) || [];
  for (const c of calls) {
    const name = c.slice(1, c.length - 1).trim().replace(/\($/, '').trim();
    if (!VALID_METHODS.has(name)) return false;
  }
  try {
    // proxy encadenable: cualquier get/llamada devuelve el mismo proxy.
    const proxy: unknown = new Proxy(function () {}, { get: () => proxy, apply: () => proxy });
    // `has:()=>true` hace que `with` capture TODOS los identificadores; pero hay que
    // devolver undefined en Symbol.unscopables o `with` los trata como fuera de alcance.
    const env = new Proxy({}, { has: () => true, get: (_t, k) => (k === Symbol.unscopables ? undefined : proxy) });
    // eslint-disable-next-line no-new-func
    new Function('__env', 'with(__env){ return (\n' + code + '\n) }')(env);
    return true;
  } catch {
    return false;
  }
}

export async function requestAiGraph(prompt: string, current?: unknown, opts?: { withLyrics?: boolean }): Promise<Record<string, unknown>> {
  const r = await fetch('/api/ai-graph', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, current, withLyrics: opts?.withLyrics }),
  });
  const j = (await r.json().catch(() => null)) as { graph?: unknown; error?: string } | null;
  if (!r.ok || !j) throw new Error((j && j.error) || 'el copiloto no respondió');
  if (j.error) throw new Error(j.error);
  return (j.graph ?? {}) as Record<string, unknown>;
}

export interface SanitizeResult {
  snap: Partial<ProjectSnapshot>;
  warnings: string[];
}

type AnyNode = { id?: unknown; type?: unknown; data?: { kind?: unknown; code?: unknown; name?: unknown; opId?: unknown; params?: unknown } };

function layout(nodes: Node<NodeData>[], outId: string): void {
  const colX = [60, 430, 820];
  const counters = [0, 0, 0];
  for (const n of nodes) {
    const c = n.id === outId ? 2 : n.data.kind === 'source' ? 0 : 1;
    n.position = { x: colX[c], y: 40 + counters[c] * 120 };
    counters[c]++;
  }
}

export function sanitizeAiGraph(raw: unknown): SanitizeResult {
  const warnings: string[] = [];
  const r = raw as { nodes?: unknown; edges?: unknown; cps?: unknown; master?: unknown } | null;
  if (!r || typeof r !== 'object') throw new Error('el copiloto no devolvió un grafo');
  const rawNodes = Array.isArray(r.nodes) ? (r.nodes as AnyNode[]) : [];
  const rawEdges = Array.isArray(r.edges) ? (r.edges as { source?: unknown; target?: unknown }[]) : [];

  const nodes: Node<NodeData>[] = [];
  const idSet = new Set<string>();
  let outId: string | null = null;
  let si = 0, fi = 0;

  for (const n of rawNodes) {
    if (!n || typeof n !== 'object') continue;
    const kind = String(n.data?.kind || n.type || '') as NodeKind;
    let id = n.id != null ? String(n.id) : '';
    if (!id || idSet.has(id)) id = kind === 'out' ? 'out_1' : kind === 'source' ? `src_${++si}` : `fx_${++fi}`;
    if (idSet.has(id)) continue;

    if (kind === 'source') {
      const code = String(n.data?.code || '').trim();
      if (!code || !validStrudel(code)) { warnings.push(`fuente "${n.data?.name || id}" descartada (código inválido)`); continue; }
      const name = n.data?.name ? String(n.data.name).slice(0, 40) : undefined;
      idSet.add(id);
      nodes.push({ id, type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', name, code } });
    } else if (kind === 'fx' || kind === 'transform') {
      const opId = String(n.data?.opId || '');
      const op = OPS_BY_ID[opId];
      if (!op) warnings.push(`efecto "${opId || '?'}" desconocido → pasa de largo`);
      const params = op
        ? { ...defaultParams(op), ...(n.data?.params && typeof n.data.params === 'object' ? (n.data.params as Record<string, number | string>) : {}) }
        : ((n.data?.params as Record<string, number | string>) || {});
      idSet.add(id);
      nodes.push({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, opId: op ? opId : undefined, params } as NodeData });
    } else if (kind === 'out') {
      if (outId) continue;
      idSet.add(id);
      outId = id;
      nodes.push({ id, type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } });
    }
  }

  if (!outId) { outId = 'out_1'; idSet.add(outId); nodes.push({ id: outId, type: 'out', position: { x: 0, y: 0 }, data: { kind: 'out' } }); }
  if (nodes.filter((n) => n.data.kind === 'source').length === 0) throw new Error('el copiloto no generó instrumentos válidos');

  // edges válidos
  const edges: Edge[] = [];
  const eSet = new Set<string>();
  const hasOutgoing = new Set<string>();
  const hasIncoming = new Set<string>();
  for (const e of rawEdges) {
    const s = String(e?.source || ''), t = String(e?.target || '');
    if (!idSet.has(s) || !idSet.has(t) || s === t) continue;
    const eid = `e_${s}_${t}`;
    if (eSet.has(eid)) continue;
    eSet.add(eid); edges.push({ id: eid, source: s, target: t }); hasOutgoing.add(s); hasIncoming.add(t);
  }
  // reconectar al Out lo que quedó suelto: fuentes sin salida (siempre ok) y
  // efectos con entrada pero sin salida (completa la cadena). Un fx sin entrada se
  // deja suelto (el compilador no lo alcanza → inofensivo).
  for (const n of nodes) {
    if (n.id === outId || hasOutgoing.has(n.id)) continue;
    if (n.data.kind === 'source' || hasIncoming.has(n.id)) {
      const eid = `e_${n.id}_${outId}`;
      if (!eSet.has(eid)) { eSet.add(eid); edges.push({ id: eid, source: n.id, target: outId }); }
    }
  }

  layout(nodes, outId);

  let cps = Number(r.cps);
  if (!isFinite(cps) || cps <= 0 || cps > 4) { cps = 0.5; warnings.push('cps fuera de rango → 0.5 (120bpm)'); }
  const master = r.master && typeof r.master === 'object' ? (r.master as ProjectSnapshot['master']) : undefined;

  return {
    snap: { nodes, edges, cps, beatsPerCycle: 4, transpose: 0, ...(master ? { master } : {}) },
    warnings,
  };
}
