// IMPORTAR MIDI (Fase 5.5) — acciones de la interfaz: soltar un .mid en el lienzo (un Source por
// pista, listo para sonar con el synth) o meter un .mid en el Source que estás editando (conserva
// su sonido). Cuantizar a semicorcheas es lo de siempre (editable en la rejilla y el piano roll);
// sin cuantizar suena exacto pero se edita como código.
import { create } from 'zustand';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from '../store/useNotifyStore';
import { DEFAULT_SYNTH } from '../graph/types';
import { parseMidiFile, gridPattern, exactPattern, mergeTracks, type MidiTrackInfo, type MidiFileInfo } from './midiImport';
import { parseSpliceName } from './splice';
import { keyFromFileName, keyLong } from './songKey';

const Q_KEY = 'telar.midiimport.quantize';
const loadQ = () => {
  try {
    return localStorage.getItem(Q_KEY) !== '0';
  } catch {
    return true;
  }
};
export const useMidiImportPrefs = create<{ quantize: boolean; setQuantize: (q: boolean) => void }>((set) => ({
  quantize: loadQ(),
  setQuantize: (q) => {
    try { localStorage.setItem(Q_KEY, q ? '1' : '0'); } catch { /* sin almacenamiento */ }
    set({ quantize: q });
  },
}));

export const isMidiFile = (f: { name: string; type?: string }) => /\.(mid|midi|smf)$/i.test(f.name) || f.type === 'audio/midi' || f.type === 'audio/x-midi';

const pattern = (info: MidiFileInfo, t: MidiTrackInfo, sound: string) =>
  useMidiImportPrefs.getState().quantize ? gridPattern(info, t, 4, sound) : exactPattern(info, t, sound);

// tema sin tonalidad + .mid que la trae en el nombre (Splice) → esa
function keyFromName(fileName: string): string {
  const g = useGraphStore.getState();
  const k = keyFromFileName(fileName);
  if (!k || k.minor == null || g.songKey) return '';
  g.setSongKey({ root: k.root, minor: k.minor });
  return ` Tonalidad del tema: ${keyLong({ root: k.root, minor: k.minor })} (la del MIDI).`;
}

async function readMidi(file: Blob): Promise<MidiFileInfo | null> {
  try {
    const info = parseMidiFile(new Uint8Array(await file.arrayBuffer()));
    if (!info.tracks.length) { toast.warn('El MIDI no tiene notas.'); return null; }
    return info;
  } catch (e) {
    toast.warn(`No pude leer el MIDI: ${String((e as Error)?.message ?? e)}`);
    return null;
  }
}

// Un .mid al lienzo: un Source por pista (melódica → con el synth; batería → samples GM)
export async function addMidiToCanvas(file: File, pos?: { x: number; y: number }): Promise<number> {
  const info = await readMidi(file);
  if (!info) return 0;
  const g = useGraphStore.getState();
  const base = parseSpliceName(file.name).clean || 'midi';
  const q = useMidiImportPrefs.getState().quantize;
  let made = 0;
  const lines: string[] = [];
  info.tracks.forEach((t, i) => {
    const p = pattern(info, t, 'sawtooth');
    const name = (t.name || (info.tracks.length > 1 ? `${base}_${i + 1}` : base)).slice(0, 40);
    const at = pos ? { x: pos.x + i * 28, y: pos.y + i * 28 } : undefined;
    if (t.drum) g.addPattern(p.code, name, { showSeq: q }, at);
    else g.addPattern(p.code, name, { synthOn: true, synth: { ...DEFAULT_SYNTH }, showSeq: q }, at);
    made++;
    lines.push(`«${name}» ${p.bars} compás${p.bars === 1 ? '' : 'es'}, ${p.notes} notas${p.chords ? ' (con acordes)' : ''}`);
  });
  toast.ok(`MIDI al lienzo: ${lines.join(' · ')}${q ? ', cuantizado a semicorcheas' : ', sin cuantizar'}.${keyFromName(file.name)}`);
  return made;
}

// Un .mid dentro del Source que estás editando: sus notas (todas las pistas melódicas juntas) con
// el sonido que ya tenía el Source.
export async function importMidiIntoSource(id: string, file: File): Promise<boolean> {
  const info = await readMidi(file);
  if (!info) return false;
  const g = useGraphStore.getState();
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return false;
  const t = mergeTracks(info.tracks);
  if (!t) return false;
  const code = n.data.code ?? '';
  const sound = /\bs(?:ound)?\(\s*["'`]([A-Za-z0-9_]+)/.exec(code)?.[1] ?? 'sawtooth';
  const bank = /\.bank\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(code)?.[1];
  const p = pattern(info, t, sound);
  const next = p.code + (bank && !t.drum ? `.bank("${bank}")` : '');
  g.updateNodeData(id, { code: next, showSeq: true });
  toast.ok(`MIDI en «${n.data.name || id}»: ${p.bars} compás${p.bars === 1 ? '' : 'es'}, ${p.notes} notas${p.chords ? ' (con acordes)' : ''}${useMidiImportPrefs.getState().quantize ? '' : ', sin cuantizar (se edita en el código)'}.${keyFromName(file.name)}`);
  return true;
}
