// ACCIONES DEL DAW (Fase 2): puente entre la vista y el motor puro de `arrangeEdit`. Lee el
// estado actual (secciones de la canción + código de cada pista), aplica la operación y la
// deja en UN paso deshacible (`applyArrangement`). Avisa de las pistas que no pudo alinear.
import { useGraphStore } from '../store/useGraphStore';
import { useSongStore } from '../store/useSongStore';
import { useMetroStore } from '../store/useMetroStore';
import { useScenesStore } from '../store/useScenesStore';
import { toast } from '../store/useNotifyStore';
import { useUiFocusStore } from '../store/useUiFocusStore';
import * as E from './arrangeEdit';
import * as TL from './timeline';
import { blockPattern } from './dawModel';
import { startJam, finishJam, isJamRecording, buildFromTake, type JamHooks, type JamTake } from './jamRecorder';
import { getScheduler } from '../audio/engine';
import { cleanAuto, type AutoPoint } from './automation';
import { setVariation, splitVariation, type FillKind } from './variation';
import { cleanTransitions, autoTransitions, type TransItem } from './transitions';
import { splitArrange, spliceArm, isMutedArm, unmuteArm, muteArm, isSilenceArm } from '../nodes/stepseqCode';

export function arrangeState(): E.ArrangeState {
  const codes: Record<string, string> = {};
  const autos: Record<string, Record<string, AutoPoint[]>> = {};
  let trans: E.ArrangeState['trans'];
  for (const n of useGraphStore.getState().nodes) {
    // la pista de transiciones (7.4) no sigue la estructura: su código lo escribe el compilador
    if (n.data.kind === 'source' && !Array.isArray(n.data.transitions)) codes[n.id] = n.data.code ?? '';
    if (Array.isArray(n.data.transitions)) trans = { id: n.id, items: cleanTransitions(n.data.transitions) };
    // curvas de automatización de cualquier nodo (pista, FX, máster): se mueven con su tramo (10.3)
    const au = n.data.auto as Record<string, unknown> | undefined;
    if (au && typeof au === 'object') {
      const pts: Record<string, AutoPoint[]> = {};
      for (const [k, v] of Object.entries(au)) if (Array.isArray(v) && v.length) pts[k] = v as AutoPoint[];
      if (Object.keys(pts).length) autos[n.id] = pts;
    }
  }
  return { steps: useSongStore.getState().steps.map((s) => ({ ...s })), codes, autos, trans };
}

// --- TRANSICIONES (Fase 7.4): riser, reverso, impacto y barrido en la línea de tiempo ----------
export const transitionsNode = () => useGraphStore.getState().nodes.find((n) => n.data.kind === 'source' && Array.isArray(n.data.transitions));
function setTransitions(items: TransItem[]): void {
  const g = useGraphStore.getState();
  let node = transitionsNode();
  if (!node) {
    const before = new Set(g.nodes.map((n) => n.id));
    g.addSources([{ name: 'transiciones', code: 'silence' }]);
    node = useGraphStore.getState().nodes.find((n) => !before.has(n.id) && n.data.kind === 'source');
    if (!node) return;
  }
  useGraphStore.getState().updateNodeData(node.id, { transitions: cleanTransitions(items) });
}
export const dawTransitions = {
  list: (): TransItem[] => cleanTransitions(transitionsNode()?.data.transitions),
  add(it: TransItem): void {
    const cur = dawTransitions.list().filter((x) => !(x.kind === it.kind && x.at === it.at));
    setTransitions([...cur, it]);
  },
  remove(it: TransItem): void {
    setTransitions(dawTransitions.list().filter((x) => !(x.kind === it.kind && x.at === it.at)));
  },
  // un riser de 4 que termina en cada cambio de sección + un impacto en su primer compás
  auto(): number {
    const add = autoTransitions(useSongStore.getState().steps);
    if (!add.length) { toast.info('hace falta más de una sección para poner transiciones entre ellas'); return 0; }
    const cur = dawTransitions.list();
    const key = (x: TransItem) => `${x.kind}@${x.at}`;
    const have = new Set(cur.map(key));
    setTransitions([...cur, ...add.filter((x) => !have.has(key(x)))]);
    return add.length;
  },
  clear(): void {
    if (transitionsNode()) setTransitions([]);
  },
};

function trackName(id: string): string {
  const n = useGraphStore.getState().nodes.find((x) => x.id === id);
  return (n?.data.name ?? '').trim() || id;
}

// Aplica el resultado (o avisa si no se pudo). Devuelve true si cambió algo.
export function commitArrangement(r: E.EditResult | null, failMsg = 'no se pudo hacer ese cambio en la estructura'): boolean {
  if (!r) { toast.warn(failMsg); return false; }
  useGraphStore.getState().applyArrangement(r.codes, r.steps, r.patches);
  if (r.skipped.length) {
    const list = r.skipped.slice(0, 3).map(trackName).join(', ');
    toast.warn(`${list}${r.skipped.length > 3 ? '…' : ''} tiene${r.skipped.length > 1 ? 'n' : ''} más secciones que la canción: no se tocó. Quita secciones en su nodo o borra su arrange.`);
  }
  return true;
}

export const dawSection = {
  duplicate: (i: number) => commitArrangement(E.duplicateSection(arrangeState(), i)),
  insertEmpty: (i: number, bars = 8) => commitArrangement(E.insertEmptySection(arrangeState(), i, bars)),
  remove: (i: number) => commitArrangement(E.deleteSection(arrangeState(), i), 'la canción necesita al menos una sección'),
  resize: (i: number, bars: number) => commitArrangement(E.resizeSection(arrangeState(), i, bars)),
  move: (i: number, j: number) => commitArrangement(E.moveSection(arrangeState(), i, j)),
  rename: (i: number, name: string) => commitArrangement(E.renameSection(arrangeState(), i, name)),
  scene: (i: number, scene: number) => commitArrangement(E.setSectionScene(arrangeState(), i, scene)),
  alignAll: () => commitArrangement(E.alignAll(arrangeState())),
};

// «Una por escena»: una sección de 8 compases por cada escena capturada, en orden.
export function sceneSections(): E.SectionSpec[] {
  const sc = useScenesStore.getState().scenes;
  return Object.keys(sc)
    .map(Number)
    .filter((k) => sc[k])
    .sort((a, b) => a - b)
    .map((k) => ({ bars: 8, scene: k, name: sc[k].name }));
}

// CREAR LA ESTRUCTURA de un tema que hoy es un jam: secciones + pistas alineadas (suenan igual).
export function createStructure(sections: E.SectionSpec[]): boolean {
  const st = arrangeState();
  return commitArrangement(E.createStructure(st.codes, sections), 'elige una plantilla con al menos una sección');
}

// Escenas para una plantilla: ranuras VACÍAS en orden (no dispara mezclas que ya tenías
// capturadas en otras ranuras; luego capturas la mezcla de cada sección en su ranura).
// Si no alcanzan, las últimas repiten la última vacía (o la 1 si no hay ninguna).
export function freeSceneSlots(n: number): number[] {
  const sc = useScenesStore.getState().scenes;
  const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => !sc[k]);
  const last = free.length ? free[free.length - 1] : 1;
  return Array.from({ length: n }, (_, i) => free[i] ?? last);
}

export function createFromTemplate(sections: { bars: number; name: string }[]): boolean {
  const slots = freeSceneSlots(sections.length);
  return createStructure(sections.map((x, i) => ({ bars: x.bars, scene: slots[i], name: x.name })));
}

// --- BLOQUES (Fase 2.3): copiar · pegar · vaciar · duplicar en la siguiente · editar -------
// Editan UNA pista (updateNodeData → Ctrl+Z). El portapapeles vive aquí (sobrevive a cambiar
// de vista) y guarda el patrón del bloque sin su `.mask(0)`: pegado, suena.
let clip: { expr: string; from: string; bars?: number } | null = null;
export const dawClipboard = { get: () => clip };

const codeOf = (id: string) => useGraphStore.getState().nodes.find((n) => n.id === id)?.data.code ?? '';
const setCode = (id: string, next: string | null, failMsg: string): boolean => {
  if (next === null) { toast.warn(failMsg); return false; }
  if (next !== codeOf(id)) useGraphStore.getState().updateNodeData(id, { code: next });
  return true;
};

export const dawBlock = {
  copy(id: string, arm: number): boolean {
    const expr = blockPattern(codeOf(id), arm);
    if (!expr) return false;
    const bars = arm >= 0 ? splitArrange(codeOf(id))?.[arm]?.bars : undefined;
    clip = { expr, from: `${trackName(id)}${arm >= 0 ? ` · sección ${arm + 1}` : ''}`, bars };
    toast.info(`copiado: ${clip.from}`);
    return true;
  },
  paste(id: string, arm: number): boolean {
    if (!clip) { toast.info('primero copia un bloque (Ctrl+C o clic derecho › copiar)'); return false; }
    return setCode(id, E.setArmExpr(codeOf(id), arm, clip.expr), 'esta pista no tiene secciones: usa «⇋ alinear pistas» o «crear estructura»');
  },
  clear(id: string, arm: number): boolean {
    return setCode(id, E.setArmExpr(codeOf(id), arm, 'silence'), 'esta pista no tiene secciones');
  },
  toNext(id: string, arm: number): boolean {
    const code = codeOf(id);
    const expr = blockPattern(code, arm);
    return setCode(id, expr ? E.setArmExpr(code, arm + 1, expr) : null, 'no hay una sección siguiente en esta pista');
  },
  edit(id: string, arm: number): void {
    useUiFocusStore.getState().request(id, arm);
    useGraphStore.getState().setMode('standard');
  },
  // VARIACIÓN CADA N COMPASES (Fase 7.3): el último compás de cada N toca un fill (copia para
  // editar, corte o roll); every 0 la quita. Una sección apagada sigue apagada.
  variation(id: string, arm: number, every: number, kind: FillKind = 'copy', half = false): boolean {
    const code = codeOf(id);
    const apply = (pat: string): string | null => {
      if (isSilenceArm(pat)) return null;
      const muted = isMutedArm(pat);
      const next = setVariation(muted ? unmuteArm(pat) : pat, every, kind, half);
      return muted ? muteArm(next) : next;
    };
    const arms = splitArrange(code);
    if (!arms) return setCode(id, apply(code), 'esta pista no tiene patrón');
    const a = arms[arm];
    if (!a) return false;
    const next = apply(a.code);
    return setCode(id, next == null ? null : spliceArm(code, a, next), 'esa sección está en silencio: no hay patrón que variar');
  },
};
export const blockVariation = (blockCode: string) => splitVariation(isMutedArm(blockCode) ? unmuteArm(blockCode) : blockCode);

// --- CLIPS LIBRES (Fase 10.1 · 10.2): mover, estirar, partir, unir, duplicar y pegar en cualquier
// compás y entre pistas. Cada acción es UN paso de deshacer (applyArrangement). `total`: compases de
// la línea de tiempo (la canción, o lo que muestra el DAW sin canción).
function songBounds(): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const st of useSongStore.getState().steps) { out.push(acc); acc += Math.max(1, st.bars); }
  return out;
}
function clipsOf(id: string, total: number): { tl: TL.TrackTimeline; clips: TL.Clip[] } {
  const tl = TL.readTimeline(codeOf(id), total, songBounds());
  return { tl, clips: tl.clips };
}
const clipIndexAt = (clips: TL.Clip[], start: number) => clips.findIndex((c) => Math.abs(c.start - start) < 1e-6);
function commitClips(total: number, changes: Record<string, { tl: TL.TrackTimeline; clips: TL.Clip[] }>): boolean {
  const codes: Record<string, string> = {};
  const b = songBounds();
  for (const [id, { tl, clips }] of Object.entries(changes)) codes[id] = TL.writeTimeline(tl, TL.normalize(TL.clampClips(clips, total), b));
  useGraphStore.getState().applyArrangement(codes);
  return true;
}
export const dawClip = {
  // mover el clip que empieza en `start` a `to` (en la misma pista o en `toTrack`)
  move(id: string, start: number, to: number, total: number, toTrack?: string): boolean {
    const src = clipsOf(id, total);
    const i = clipIndexAt(src.clips, start);
    const c = src.clips[i];
    if (!c || TL.isGap(c)) return false;
    const at = Math.max(0, Math.min(total - c.bars, Math.round(to)));
    if (!toTrack || toTrack === id) {
      if (at === c.start) return false;
      return commitClips(total, { [id]: { tl: src.tl, clips: TL.moveClip(src.clips, i, at) } });
    }
    const dst = clipsOf(toTrack, total);
    return commitClips(total, {
      [id]: { tl: src.tl, clips: TL.clearClip(src.clips, i) },
      [toTrack]: { tl: dst.tl, clips: TL.placeClip(dst.clips, at, c.bars, unmuteArm(c.expr)) },
    });
  },
  // estirar el borde derecho (más largo = el patrón se repite)
  resize(id: string, start: number, bars: number, total: number): boolean {
    const t = clipsOf(id, total);
    const i = clipIndexAt(t.clips, start);
    const c = t.clips[i];
    const b = Math.max(1, Math.min(total - (c?.start ?? 0), Math.round(bars)));
    if (!c || TL.isGap(c) || b === c.bars) return false;
    return commitClips(total, { [id]: { tl: t.tl, clips: TL.resizeClip(t.clips, i, b) } });
  },
  // partir en el compás `bar` (Ctrl+E)
  split(id: string, bar: number, total: number): boolean {
    const t = clipsOf(id, total);
    const next = TL.splitClip(t.clips, Math.round(bar));
    if (next === t.clips) { toast.info('parte un clip por dentro (no en su borde)'); return false; }
    return commitClips(total, { [id]: { tl: t.tl, clips: next } });
  },
  // unir con el clip siguiente
  join(id: string, start: number, total: number): boolean {
    const t = clipsOf(id, total);
    const i = clipIndexAt(t.clips, start);
    if (i < 0 || i >= t.clips.length - 1) { toast.info('no hay un clip después para unir'); return false; }
    return commitClips(total, { [id]: { tl: t.tl, clips: TL.joinClips(t.clips, i) } });
  },
  // duplicar justo detrás (Ctrl+D)
  duplicate(id: string, start: number, total: number): boolean {
    const t = clipsOf(id, total);
    const i = clipIndexAt(t.clips, start);
    const c = t.clips[i];
    if (!c || TL.isGap(c)) return false;
    if (c.start + c.bars >= total) { toast.info('no cabe: el clip llega al final de la canción'); return false; }
    return commitClips(total, { [id]: { tl: t.tl, clips: TL.duplicateClip(t.clips, i) } });
  },
  // copiar el clip (con su largo) y pegarlo en otro compás o pista
  copy(id: string, start: number, total: number): boolean {
    const t = clipsOf(id, total);
    const c = t.clips[clipIndexAt(t.clips, start)];
    if (!c || TL.isGap(c)) return false;
    clip = { expr: unmuteArm(c.expr).trim(), from: `${trackName(id)} · compás ${c.start + 1}`, bars: c.bars };
    toast.info(`copiado: ${clip.from} (${c.bars} c.)`);
    return true;
  },
  paste(id: string, at: number, total: number): boolean {
    if (!clip) { toast.info('primero copia un clip (Ctrl+C)'); return false; }
    const t = clipsOf(id, total);
    const bars = Math.max(1, Math.min(clip.bars ?? 1, total - at));
    return commitClips(total, { [id]: { tl: t.tl, clips: TL.placeClip(t.clips, Math.max(0, Math.round(at)), bars, clip.expr) } });
  },
  clear(id: string, start: number, total: number): boolean {
    const t = clipsOf(id, total);
    const i = clipIndexAt(t.clips, start);
    if (i < 0 || TL.isGap(t.clips[i])) return false;
    return commitClips(total, { [id]: { tl: t.tl, clips: TL.clearClip(t.clips, i) } });
  },
};

// --- GRABAR EL JAM EN LA CANCIÓN (Fase 2.5) ----------------------------------------------
function jamHooks(): JamHooks {
  return {
    // compases de la canción: el reloj menos la cuenta previa (8.3; en la cuenta queda en negativo)
    now: () => Number(getScheduler()?.now?.() ?? 0) - useSongStore.getState().countIn,
    playing: () => useGraphStore.getState().playing,
    snapshot: () => {
      const src = useGraphStore.getState().nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions)); // las transiciones se colocan, no se graban
      const anySolo = src.some((n) => n.data.solo);
      const tracks: Record<string, { audible: boolean; gain: number; filt: number; rev: number; del: number }> = {};
      for (const n of src) {
        tracks[n.id] = {
          audible: !n.data.mute && (!anySolo || !!n.data.solo),
          gain: typeof n.data.gain === 'number' ? n.data.gain : 1,
          filt: typeof n.data.chFilter === 'number' ? n.data.chFilter : 0,
          rev: Number(n.data.sends?.rev) || 0,
          del: Number(n.data.sends?.del) || 0,
        };
      }
      // perillas del máster (7.2): las del panel MIDI y el nivel de los retornos
      const m = useGraphStore.getState().master;
      const master = { filter: m.filter ?? 0, drive: m.drive ?? 0, room: m.room ?? 0, delay: m.delay ?? 0, crush: m.crush ?? 0, rv: m.rvLevel ?? 0, dl: m.dlLevel ?? 0 };
      return { scene: useScenesStore.getState().active, tracks, master };
    },
    onFinish: (take) => applyJamTake(take),
  };
}

// Arranca la toma: transporte desde el compás 1, SIN el modo canción (las escenas las disparas
// tú) y sin bucle de región. Todo lo que hagas en vivo (cualquier vista, MIDI) queda anotado.
export async function startJamRecording(): Promise<void> {
  if (isJamRecording()) return;
  await useGraphStore.getState().stop(); // siempre: la toma arranca con el reloj en el compás 1
  const s = useSongStore.getState();
  s.setRegionOn(false);
  s.setFrom(0);
  s.setPlaying(false);
  const ci = useMetroStore.getState().countIn; // cuenta previa (8.3): clic antes del compás 1
  s.setCountIn(ci);
  await useGraphStore.getState().play();
  startJam(jamHooks());
  toast.info(`● ${ci ? `cuenta de ${ci} compás${ci > 1 ? 'es' : ''} y ` : ''}grabando el jam desde el compás 1: dispara escenas, silencia y enciende pistas, mueve perillas… ■ para armar la canción`);
}

// Para la toma (y el transporte) y arma la canción.
export async function stopJamRecording(): Promise<void> {
  if (!isJamRecording()) return;
  finishJam(jamHooks());
  await useGraphStore.getState().stop();
}

function applyJamTake(take: JamTake): void {
  const st = arrangeState();
  const sc = useScenesStore.getState().scenes;
  const r = buildFromTake(take, st.codes, { freeScene: freeSceneSlots(1)[0], sceneName: (k) => sc[k]?.name });
  if (!r) { toast.warn('la toma duró menos de un compás: no se armó nada'); return; }
  // las curvas grabadas REEMPLAZAN solo los parámetros que moviste (las demás curvas siguen)
  const nodes = useGraphStore.getState().nodes;
  for (const [id, p] of Object.entries(r.patches)) {
    if (!p.auto) continue;
    const prev = cleanAuto(nodes.find((n) => n.id === id)?.data.auto);
    p.auto = { ...prev, ...p.auto };
  }
  // perillas del máster movidas (7.2): sus curvas al nodo Out (lo de antes que no moviste sigue)
  const outNode = nodes.find((n) => n.data.kind === 'out');
  if (r.master && outNode) r.patches[outNode.id] = { auto: { ...cleanAuto(outNode.data.auto), ...r.master.auto } };
  useGraphStore.getState().applyArrangement({ ...st.codes, ...r.codes }, r.steps, r.patches);
  if (r.master && Object.keys(r.master.reset).length) useGraphStore.getState().setMaster(r.master.reset);
  const curves = Object.entries(r.patches).filter(([id, p]) => p.auto && id !== outNode?.id).length;
  if (curves) toast.info(`${curves} pista(s) con curvas grabadas desde las perillas (botón A en el DAW para verlas)`);
  if (r.master) toast.info(`máster: curvas de ${Object.keys(r.master.auto).length} perilla(s) grabadas (fila «máster» del DAW, botón A)`);
  const total = r.steps.reduce((a, x) => a + x.bars, 0);
  toast.ok(`canción armada desde el jam: ${r.steps.length} secciones · ${total} compases. ▶ canción para escucharla (Ctrl+Z la deshace)`);
  if (r.skipped.length) toast.warn(`${r.skipped.slice(0, 3).map(trackName).join(', ')}${r.skipped.length > 3 ? '…' : ''} ya tenía${r.skipped.length > 1 ? 'n' : ''} secciones propias: no se tocó.`);
}
