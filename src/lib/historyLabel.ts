// QUÉ CAMBIÓ EN CADA PASO DEL HISTORIAL (Fase 12.3) — lógica PURA (testeable en Node). El historial
// guarda cómo estaba todo ANTES de cada cambio; comparando un paso con el siguiente se escribe una
// línea legible: «bombo: código», «nueva pista: hats», «estructura de la canción»…
interface NodeLike { id: string; data: Record<string, unknown> }
interface EdgeLike { source: string; target: string }
export interface Snap { nodes: NodeLike[]; edges: EdgeLike[]; song?: unknown }

const KEY_LABEL: Record<string, string> = {
  code: 'patrón', mute: 'mute', solo: 'solo', gain: 'volumen', chPan: 'paneo', chFilter: 'filtro', eq: 'EQ', comp: 'compresor',
  sends: 'envíos', auto: 'automatización', params: 'perillas', name: 'nombre', transitions: 'transiciones', laneH: 'alto de fila',
  folder: 'carpeta', color: 'color', warp: 'loop', xfa: 'crossfader', macros: 'macros', synth: 'sinte', voice: 'voz', opId: 'efecto',
};
const nameOf = (n: NodeLike) => String(n.data.name ?? '').trim() || (n.data.kind === 'out' ? 'salida' : n.data.opId ? String(n.data.opId) : n.id);
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function describeChange(before: Snap, after: Snap): string {
  const bm = new Map(before.nodes.map((n) => [n.id, n]));
  const am = new Map(after.nodes.map((n) => [n.id, n]));
  const added = after.nodes.filter((n) => !bm.has(n.id));
  const removed = before.nodes.filter((n) => !am.has(n.id));
  if (added.length === 1 && !removed.length) return `nueva: ${nameOf(added[0])}`;
  if (removed.length === 1 && !added.length) return `quitó: ${nameOf(removed[0])}`;
  if (added.length || removed.length) {
    const nums = `${added.length ? `+${added.length}` : ''}${added.length && removed.length ? ' ' : ''}${removed.length ? `−${removed.length}` : ''}`;
    return added.length + removed.length > 3 ? `cambió el proyecto (${nums} nodos)` : `${nums} nodos`;
  }
  const changed: { n: NodeLike; keys: string[] }[] = [];
  for (const a of after.nodes) {
    const b = bm.get(a.id);
    if (!b) continue;
    const keys = [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])].filter((k) => k !== 'selected' && !same(a.data[k], b.data[k]));
    if (keys.length) changed.push({ n: a, keys });
  }
  const songChanged = before.song !== undefined && after.song !== undefined && !same(before.song, after.song);
  if (changed.length === 0) {
    if (before.edges.length !== after.edges.length || !same(before.edges, after.edges)) return 'conexiones';
    if (songChanged) return 'estructura de la canción';
    return 'cambio';
  }
  const lab = (k: string) => KEY_LABEL[k] ?? k;
  if (changed.length === 1) {
    const { n, keys } = changed[0];
    return `${nameOf(n)}: ${keys.slice(0, 2).map(lab).join(', ')}${keys.length > 2 ? '…' : ''}`;
  }
  const allCode = changed.every((c) => c.keys.length === 1 && c.keys[0] === 'code');
  if (allCode || songChanged) return songChanged ? `estructura de la canción (${changed.length} pistas)` : `patrones de ${changed.length} pistas`;
  const k0 = changed[0].keys[0];
  if (changed.every((c) => c.keys.length === 1 && c.keys[0] === k0)) return `${lab(k0)} de ${changed.length} pistas`;
  return `${changed.length} pistas`;
}
