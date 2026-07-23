import { useGraphStore } from '../store/useGraphStore';
import { validStrudel, sanitizeAiGraph } from './aiGraph';
import { DEFAULT_CHANNEL_EQ, type ChannelEq } from '../graph/types';
import type { MasterFx } from '../graph/compile';
import { getLufs } from '../audio/lufsMeter';
import { aiFailMsg } from './aiError';

// AGENTE Nod-IA: convierte una instrucción en lenguaje natural en ACCIONES que se
// aplican al proyecto (crear/editar/borrar sources, tempo, gain, EQ, master, o
// reemplazar todo). El endpoint (/api/ai-help mode:act) devuelve {reply, actions};
// aquí las aplicamos de forma SEGURA (validando el código y acotando los números).
// Sirve para: chat que actúa (A), variaciones de 1 clic (B) y mezcla asistida (D).

type Action = Record<string, unknown>;
export interface AgentResult { applied: string[]; skipped: string[]; changedSound: boolean }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const S = () => useGraphStore.getState();

// resuelve un "target" (id, nombre exacto/parcial, o parte del código) a un nodeId.
function resolveTarget(target: unknown): string | null {
  const t = String(target ?? '').trim().toLowerCase();
  if (!t) return null;
  const srcs = S().nodes.filter((n) => n.data.kind === 'source');
  const hit =
    srcs.find((n) => n.id.toLowerCase() === t) ||
    srcs.find((n) => String(n.data.name ?? '').trim().toLowerCase() === t) ||
    srcs.find((n) => String(n.data.name ?? '').toLowerCase().includes(t)) ||
    srcs.find((n) => String(n.data.code ?? '').toLowerCase().includes(t));
  return hit?.id ?? null;
}

export async function requestAgent(instruction: string, context: unknown): Promise<{ reply: string; actions: Action[] }> {
  const r = await fetch('/api/ai-help', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'act', instruction, context }),
  });
  const j = (await r.json().catch(() => null)) as { act?: { reply?: string; actions?: Action[] }; error?: string } | null;
  if (!r.ok || !j) throw new Error((j && j.error) || aiFailMsg(r));
  const act = j.act || {};
  return { reply: String(act.reply || ''), actions: Array.isArray(act.actions) ? act.actions : [] };
}

const num = (v: unknown) => Number(v);
const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)));
const r1 = (v: number) => Math.round(v * 10) / 10;

// FOTO de la mezcla para "revisar mezcla" (D): cada canal (nombre/código para adivinar
// el rol, nivel, pan, EQ, mute/solo) + master + LOUDNESS real (LUFS/true-peak, si suena).
// El modelo la usa para reequilibrar niveles/pan/EQ y proteger de clipping.
export function buildMixContext() {
  const st = S();
  const sources = st.nodes
    .filter((n) => n.data.kind === 'source' && !n.data.mute)
    .map((n) => {
      const eq = n.data.eq;
      return {
        id: n.id,
        name: String(n.data.name ?? '').slice(0, 30),
        code: String(n.data.code ?? '').slice(0, 70),
        gain: r1(n.data.gain ?? 1),
        pan: r1(n.data.chPan ?? 0.5),
        eq: eq && eq.on ? { low: eq.low ?? 0, mid: eq.mid ?? 0, high: eq.high ?? 0 } : null,
        solo: !!n.data.solo,
      };
    });
  const m = st.master;
  const l = getLufs();
  return {
    bpm: Math.round((st.cps || 0.5) * 60 * (st.beatsPerCycle || 4)),
    master: { gain: r1(m.gain ?? 1), limit: r1(m.limit ?? 0), eqLow: m.eqLow ?? 0, eqMid: m.eqMid ?? 0, eqHigh: m.eqHigh ?? 0, room: r1(m.room ?? 0) },
    loudness: {
      integrated: isFinite(l.integrated) ? r1(l.integrated) : null,
      short: isFinite(l.short) ? r1(l.short) : null,
      truePeakDb: isFinite(l.truePeakDb) ? r1(l.truePeakDb) : null,
    },
    playing: !!st.playing,
    channels: sources.length,
    sources,
  };
}

// Pide una revisión de mezcla a Nod-IA (endpoint mode:'mix'): devuelve reply + acciones
// (gain/pan/eq/master) que luego aplica applyActions. target = objetivo LUFS (−14/−8/−6).
export async function requestMixReview(target = -14): Promise<{ reply: string; actions: Action[] }> {
  const context = buildMixContext();
  if (!context.sources.length) return { reply: 'No hay canales que revisar: añade sonidos primero.', actions: [] };
  const r = await fetch('/api/ai-help', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'mix', target, context }),
  });
  const j = (await r.json().catch(() => null)) as { act?: { reply?: string; actions?: Action[] }; error?: string } | null;
  if (!r.ok || !j) throw new Error((j && j.error) || aiFailMsg(r));
  const act = j.act || {};
  return { reply: String(act.reply || ''), actions: Array.isArray(act.actions) ? act.actions : [] };
}

export function applyActions(actions: Action[]): AgentResult {
  const applied: string[] = [], skipped: string[] = [];
  let changedSound = false;
  for (const a of actions || []) {
    const type = String((a as { type?: unknown }).type || '');
    try {
      if (type === 'cps') {
        const bpm = num(a.bpm);
        if (bpm > 20 && bpm < 400) { S().setCpsValue(bpm / (60 * (S().beatsPerCycle || 4))); applied.push(`tempo ${Math.round(bpm)} BPM`); changedSound = true; }
        else skipped.push('tempo inválido');
      } else if (type === 'add') {
        const code = String(a.code || '');
        if (validStrudel(code)) { S().addPattern(code, String(a.name || 'IA').slice(0, 40), {}, undefined, { connectToOut: true }); applied.push(`+ ${a.name || 'source'}`); changedSound = true; }
        else skipped.push(`añadir «${a.name || '?'}» (código inválido)`);
      } else if (type === 'edit') {
        const id = resolveTarget(a.target); const code = String(a.code || '');
        if (id && validStrudel(code)) { S().updateNodeData(id, { code }); applied.push(`editado ${a.target}`); changedSound = true; }
        else skipped.push(`editar «${a.target || '?'}»`);
      } else if (type === 'remove') {
        const id = resolveTarget(a.target);
        if (id) { S().removeNode(id); applied.push(`− ${a.target}`); changedSound = true; }
        else skipped.push(`quitar «${a.target || '?'}» (no encontrado)`);
      } else if (type === 'mute' || type === 'solo') {
        const id = resolveTarget(a.target);
        if (id) { S().updateNodeData(id, { [type]: !!a.on }); applied.push(`${type} ${a.on ? 'on' : 'off'} ${a.target}`); changedSound = true; }
        else skipped.push(`${type} «${a.target || '?'}»`);
      } else if (type === 'gain') {
        const id = resolveTarget(a.target);
        if (id && isNum(a.value)) { S().updateNodeData(id, { gain: clamp(num(a.value), 0, 1.5) }); applied.push(`nivel ${a.target}`); changedSound = true; }
        else skipped.push(`nivel «${a.target || '?'}»`);
      } else if (type === 'pan') {
        const id = resolveTarget(a.target);
        if (id && isNum(a.value)) { S().updateNodeData(id, { chPan: clamp(num(a.value), 0, 1) }); applied.push(`pan ${a.target}`); changedSound = true; }
        else skipped.push(`pan «${a.target || '?'}»`);
      } else if (type === 'sidechain') {
        const tgt = resolveTarget(a.target);   // lo que se duckea (bajo/pad/acordes)
        const trig = resolveTarget(a.trigger); // el disparador (kick/bombo)
        if (tgt && trig && tgt !== trig) {
          const scId = S().insertSidechain(tgt, trig, isNum(a.depth) ? num(a.depth) : 0.7, isNum(a.attack) ? num(a.attack) : 0.1);
          if (scId) { applied.push(`sidechain ${a.target} ← ${a.trigger}`); changedSound = true; }
          else skipped.push(`sidechain «${a.target || '?'}» (no va al Out, o ya existe)`);
        } else skipped.push(`sidechain «${a.target || '?'}» (falta target/disparador)`);
      } else if (type === 'eq') {
        const id = resolveTarget(a.target);
        if (id) {
          const cur = (S().nodes.find((n) => n.id === id)?.data.eq as ChannelEq) || {};
          const eq: ChannelEq = { ...DEFAULT_CHANNEL_EQ, ...cur, on: true };
          if (isNum(a.low)) eq.low = clamp(num(a.low), -30, 15);
          if (isNum(a.mid)) eq.mid = clamp(num(a.mid), -30, 15);
          if (isNum(a.high)) eq.high = clamp(num(a.high), -30, 15);
          if (isNum(a.midFreq)) eq.midFreq = clamp(num(a.midFreq), 200, 8000);
          S().updateNodeData(id, { eq }); applied.push(`EQ ${a.target}`); changedSound = true;
        } else skipped.push(`EQ «${a.target || '?'}»`);
      } else if (type === 'master') {
        const p = (a.patch || {}) as Record<string, unknown>;
        const patch: Partial<MasterFx> = {};
        (['gain', 'filter', 'room', 'drive', 'delay', 'crush', 'swing', 'humanize', 'limit', 'glue', 'eqLow', 'eqMid', 'eqHigh'] as const).forEach((k) => { if (isNum(p[k])) patch[k] = num(p[k]); });
        if (typeof p.space === 'string') patch.space = p.space;
        if (Object.keys(patch).length) { S().setMaster(patch); applied.push('master'); changedSound = true; }
        else skipped.push('master (sin cambios)');
      } else if (type === 'replace') {
        const { snap } = sanitizeAiGraph(a.graph);
        S().loadSnapshot(snap); applied.push('proyecto nuevo'); changedSound = true;
      } else {
        skipped.push(`acción desconocida (${type})`);
      }
    } catch {
      skipped.push(`falló ${type || 'una acción'}`);
    }
  }
  // si se creó/reemplazó material y no está sonando, arranca para que se oiga.
  if (changedSound && !S().playing) void S().play();
  return { applied, skipped, changedSound };
}
