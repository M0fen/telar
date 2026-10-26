// LOOPS AL TEMPO (Fase 5.2) — acciones de la interfaz: soltar un loop en el lienzo (o mandarlo
// desde el generador de packs), pasar al tempo del tema un sample largo que ya está en el lienzo
// y corregir el tempo original de un loop (×2, ÷2 o a mano).
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../store/useNotifyStore';
import { importLoop, startWarp, warpOriginalSeconds } from '../audio/warpLoops';
import { parseSpliceName } from './splice';
import { bareSampleName } from './sampleFit';
import { resolveSampleUrl } from './sampleResolve';
import { listPacks, getPack } from './userPacks';
import { songBpmOf, warpCycles, warpName, warpClean, replaceWarpInCode, type WarpInfo } from './loopWarp';
import { keyLong } from './songKey';

const clock = () => {
  const g = useGraphStore.getState();
  return { bpm: songBpmOf(g.cps, g.beatsPerCycle), bpc: g.beatsPerCycle || 4 };
};
const r2 = (x: number) => Math.round(x * 100) / 100;

// Un archivo de audio al lienzo como LOOP AL TEMPO del tema. null = no es un loop (sin BPM en el
// nombre y sin un pulso que encaje con su duración): el llamador lo agrega a su tempo natural.
export async function addLoopToCanvas(
  file: Blob,
  fileName: string,
  o: { relPath?: string; hintBpm?: number; clean?: string; pos?: { x: number; y: number }; connectToOut?: boolean } = {},
): Promise<string | null> {
  const meta = parseSpliceName(fileName, o.relPath ?? '');
  const { bpm, bpc } = clock();
  const r = await importLoop({ blob: file, fileName, clean: o.clean || meta.clean, hintBpm: o.hintBpm ?? meta.bpm, key: meta.key, songBpm: bpm, beatsPerCycle: bpc });
  if (!r) return null;
  if (!(await startWarp(r.warp, bpm))) return null;
  const g = useGraphStore.getState();
  const id = g.addPattern(r.code, o.clean || meta.clean, { warp: r.warp }, o.pos, { connectToOut: o.connectToOut ?? true });
  const same = Math.abs(r.warp.srcBpm - bpm) < 0.05;
  let msg = same
    ? `«${o.clean || meta.clean}» en la rejilla (${r.warp.beats / 4} compases a ${r2(bpm)} bpm).`
    : `«${o.clean || meta.clean}» al tempo del tema: ${r.warp.srcBpm} → ${r2(bpm)} bpm, sin cambiar el tono.`;
  // tema sin tonalidad + loop que la trae (Splice) → esa es la del tema (5.1; se cambia en la barra)
  const k = meta.key;
  if (k && k.minor != null && !g.songKey) {
    g.setSongKey({ root: k.root, minor: k.minor });
    msg += ` Tonalidad del tema: ${keyLong({ root: k.root, minor: k.minor })} (la del loop; la cambias en la barra).`;
  }
  toast.ok(msg);
  return id;
}

// archivo original de un sonido de tus packs (su nombre de Splice trae BPM y tonalidad)
async function packFile(sound: string): Promise<{ bpm?: number; fileName?: string }> {
  try {
    for (const m of await listPacks()) {
      if (!m.sounds.includes(sound)) continue;
      const f = (await getPack(m.id))?.files.find((x) => x.soundName === sound);
      if (f) return { bpm: f.bpm, fileName: f.fileName };
    }
  } catch { /* sin packs */ }
  return {};
}

// Un sample que ya está en el lienzo (s("nombre")) → loop al tempo del tema
export async function warpExistingSource(id: string): Promise<boolean> {
  const g = useGraphStore.getState();
  const n = g.nodes.find((x) => x.id === id);
  const name = bareSampleName((n?.data.code ?? '').trim());
  if (!n || !name) {
    toast.warn('Para ajustarlo al tempo, el Source tiene que ser un sample solo: s("nombre").');
    return false;
  }
  const url = resolveSampleUrl(name);
  let blob: Blob | null = null;
  try {
    if (url) blob = await (await fetch(url)).blob();
  } catch { /* abajo */ }
  if (!blob) {
    toast.warn(`No encuentro el audio de «${name}». Dale ▶ una vez (para que cargue) y vuelve a probar.`);
    return false;
  }
  const { bpm, bpc } = clock();
  const pf = await packFile(name);
  const meta = parseSpliceName(pf.fileName ?? name);
  const r = await importLoop({ blob, fileName: pf.fileName ?? name, clean: name, hintBpm: pf.bpm ?? meta.bpm, key: meta.key, songBpm: bpm, beatsPerCycle: bpc });
  if (!r || !(await startWarp(r.warp, bpm))) {
    toast.warn(`«${name}» no parece un loop: no le encontré un tempo que encaje con su duración.`);
    return false;
  }
  useGraphStore.getState().updateNodeData(id, { code: r.code, warp: r.warp });
  toast.ok(`«${name}» al tempo del tema: ${r.warp.srcBpm} → ${r2(bpm)} bpm (${r.warp.beats / 4} compases), sin cambiar el tono.`);
  return true;
}

// Corrige el tempo ORIGINAL de un loop (la detección o el nombre se equivocaron: ×2, ÷2 o a mano).
// El largo se recalcula con la duración real del archivo. Nombre nuevo: si el Source estaba
// duplicado, la copia conserva lo suyo.
export async function retuneWarp(id: string, srcBpm: number): Promise<boolean> {
  const g = useGraphStore.getState();
  const n = g.nodes.find((x) => x.id === id);
  const w = n?.data.warp as WarpInfo | undefined;
  if (!n || !w || !(srcBpm >= 40 && srcBpm <= 300)) return false;
  const secs = (await warpOriginalSeconds(w)) || (w.beats * 60) / w.srcBpm;
  const beats = Math.round((secs * srcBpm) / 60);
  if (beats < 1) {
    toast.warn('Con ese tempo el loop dura menos de un tiempo.');
    return false;
  }
  const { bpm, bpc } = clock();
  const next: WarpInfo = { ...w, name: warpName(warpClean(w.name)), srcBpm: r2(srcBpm), beats };
  if (!(await startWarp(next, bpm))) {
    toast.warn('Falta el audio original de este loop en este navegador.');
    return false;
  }
  const code = replaceWarpInCode(n.data.code ?? '', w.name, next.name, warpCycles(beats, bpc));
  useGraphStore.getState().updateNodeData(id, { code, warp: next });
  return true;
}
