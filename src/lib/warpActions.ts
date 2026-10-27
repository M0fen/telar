// LOOPS AL TEMPO (Fase 5.2) Y A LA TONALIDAD (5.3) — acciones de la interfaz: soltar un loop o un
// one-shot tonal en el lienzo (o mandarlo desde el generador de packs), pasar al tempo del tema un
// sample largo que ya está en el lienzo, corregir el tempo original de un loop (×2, ÷2 o a mano) y
// elegir si sigue la tonalidad del tema y en qué octava.
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../store/useNotifyStore';
import { importLoop, importShot, startWarp, warpOriginalSeconds } from '../audio/warpLoops';
import { parseSpliceName } from './splice';
import { bareSampleName } from './sampleFit';
import { resolveSampleUrl } from './sampleResolve';
import { listPacks, getPack } from './userPacks';
import { songBpmOf, warpCycles, warpName, warpClean, replaceWarpInCode, effectiveSemis, isVoiceName, type WarpInfo } from './loopWarp';
import { keyLong } from './songKey';

const clock = () => {
  const g = useGraphStore.getState();
  return { bpm: songBpmOf(g.cps, g.beatsPerCycle), bpc: g.beatsPerCycle || 4 };
};
const r2 = (x: number) => Math.round(x * 100) / 100;
// el sample con los semitonos que le tocan ahora (tonalidad del tema + tono)
const eff = (w: WarpInfo): WarpInfo => {
  const g = useGraphStore.getState();
  return { ...w, semis: effectiveSemis(w, g.songKey, g.transpose) };
};
const semisText = (n: number) => (n ? ` y lo pasé ${n > 0 ? '+' : ''}${n} semitonos a la tonalidad del tema` : '');

// Un archivo de audio al lienzo: un LOOP al tempo (y tonalidad) del tema, o un ONE-SHOT TONAL a la
// tonalidad del tema. null = ni lo uno ni lo otro (sin BPM ni pulso que encaje, sin tonalidad en
// el nombre): el llamador lo agrega a su tempo natural.
export async function addLoopToCanvas(
  file: Blob,
  fileName: string,
  o: { relPath?: string; hintBpm?: number; clean?: string; pos?: { x: number; y: number }; connectToOut?: boolean } = {},
): Promise<string | null> {
  const meta = parseSpliceName(fileName, o.relPath ?? '');
  const clean = o.clean || meta.clean;
  const { bpm, bpc } = clock();
  const formant = isVoiceName(fileName);
  let r = await importLoop({ blob: file, fileName, clean, hintBpm: o.hintBpm ?? meta.bpm, key: meta.key, formant, songBpm: bpm, beatsPerCycle: bpc });
  if (!r && meta.key && !meta.loop) r = await importShot({ blob: file, fileName, clean, key: meta.key, formant });
  if (!r) return null;
  const g = useGraphStore.getState();
  // tema sin tonalidad + loop que la trae (Splice) → esa es la del tema (5.1; se cambia en la barra)
  const k = meta.key;
  let keyMsg = '';
  if (k && k.minor != null && !g.songKey) {
    g.setSongKey({ root: k.root, minor: k.minor });
    keyMsg = ` Tonalidad del tema: ${keyLong({ root: k.root, minor: k.minor })} (la del ${r.warp.shot ? 'sample' : 'loop'}; la cambias en la barra).`;
  }
  const w = eff(r.warp);
  if (!(await startWarp(w, bpm))) return null;
  const id = g.addPattern(r.code, clean, { warp: r.warp }, o.pos, { connectToOut: o.connectToOut ?? true });
  const semis = w.semis ?? 0;
  let msg: string;
  if (r.warp.shot) msg = semis ? `«${clean}» a la tonalidad del tema: ${semis > 0 ? '+' : ''}${semis} semitonos${formant ? ' (voz: con sus formantes)' : ''}.` : `«${clean}» al lienzo (ya está en la tonalidad del tema).`;
  else if (Math.abs(r.warp.srcBpm - bpm) < 0.05) msg = `«${clean}» en la rejilla (${r.warp.beats / 4} compases a ${r2(bpm)} bpm)${semisText(semis)}.`;
  else msg = `«${clean}» al tempo del tema: ${r.warp.srcBpm} → ${r2(bpm)} bpm, sin cambiar el tono${semisText(semis)}.`;
  toast.ok(msg + keyMsg);
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
  const r = await importLoop({ blob, fileName: pf.fileName ?? name, clean: name, hintBpm: pf.bpm ?? meta.bpm, key: meta.key, formant: isVoiceName(pf.fileName ?? name), songBpm: bpm, beatsPerCycle: bpc });
  if (!r || !(await startWarp(eff(r.warp), bpm))) {
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
  if (!(await startWarp(eff(next), bpm))) {
    toast.warn('Falta el audio original de este loop en este navegador.');
    return false;
  }
  const code = replaceWarpInCode(n.data.code ?? '', w.name, next.name, warpCycles(beats, bpc));
  useGraphStore.getState().updateNodeData(id, { code, warp: next });
  return true;
}

// ¿Sigue la tonalidad del tema? ¿Una octava arriba/abajo? (5.3) Nombre nuevo: si el Source estaba
// duplicado, la copia conserva lo suyo.
export async function setWarpKeyOpts(id: string, patch: { follow?: boolean; oct?: number; st?: number }): Promise<boolean> {
  const g = useGraphStore.getState();
  const n = g.nodes.find((x) => x.id === id);
  const w = n?.data.warp as WarpInfo | undefined;
  if (!n || !w) return false;
  const next: WarpInfo = { ...w, ...patch, name: warpName(warpClean(w.name)) };
  if (next.oct != null) next.oct = Math.max(-2, Math.min(2, Math.round(next.oct)));
  if (next.st != null) next.st = Math.max(-12, Math.min(12, Math.round(next.st)));
  const { bpm, bpc } = clock();
  if (!(await startWarp(eff(next), bpm))) {
    toast.warn('Falta el audio original de este sample en este navegador.');
    return false;
  }
  const code = replaceWarpInCode(n.data.code ?? '', w.name, next.name, warpCycles(w.beats, bpc));
  useGraphStore.getState().updateNodeData(id, { code, warp: next });
  return true;
}
