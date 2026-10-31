// TRACKLIST DEL SET (modo DJ, DJ-4) — lógica PURA (con tests): qué tema entró y cuándo, mientras se
// graba el set. Un tema «entra» cuando SUENA EN LA SALA: tocando y con su tira abierta (no en mute,
// fader/crossfader arriba). Así cuenta cuando lo subes, no cuando lo preparas en los audífonos.

export interface SetEntry {
  t: number; // segundos desde que empezó la grabación
  title: string;
  deck: number; // número del deck en la mesa
  bpm?: number;
  key?: string; // Camelot (8A)
}

export interface DeckNow {
  id: string;
  trackId: string;
  title: string;
  deck: number;
  audible: boolean; // tocando y abierto a la sala
  bpm?: number;
  key?: string;
}

// estado entre consultas: qué tema sonaba en cada deck, y cuándo se anotó cada tema por última vez
export interface SetLogState { on: Record<string, string>; last: Record<string, number> }
export const emptyLog = (): SetLogState => ({ on: {}, last: {} });

// un tema vuelto a subir enseguida (un corte, un spinback) no se anota otra vez
export const RELOG_GAP = 30;

// nuevas entradas a la hora `t`: cada deck que pasó a sonar con un tema que no sonaba ahí
export function logStep(st: SetLogState, decks: DeckNow[], t: number): { st: SetLogState; add: SetEntry[] } {
  const on: Record<string, string> = {};
  const last = { ...st.last };
  const add: SetEntry[] = [];
  for (const d of decks) {
    if (!d.audible || !d.trackId) continue;
    on[d.id] = d.trackId;
    if (st.on[d.id] === d.trackId) continue; // ya sonaba
    const prev = last[d.trackId];
    if (prev != null && t - prev < RELOG_GAP) continue;
    last[d.trackId] = t;
    add.push({ t, title: d.title, deck: d.deck, bpm: d.bpm, key: d.key });
  }
  return { st: { on, last }, add };
}

// 0:00 / 12:34 / 1:02:03
export function fmtStamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

// la lista para pegar (Mixcloud, SoundCloud, una historia)
export function tracklistText(entries: SetEntry[]): string {
  return entries.map((e, i) => `${String(i + 1).padStart(2, '0')}. ${fmtStamp(e.t)} — ${e.title}${e.key || e.bpm ? ` (${[e.key, e.bpm ? `${Math.round(e.bpm * 10) / 10} BPM` : ''].filter(Boolean).join(' · ')})` : ''}`).join('\n');
}

// CUE: los reproductores parten el archivo del set en temas. INDEX en mm:ss:ff (75 cuadros/s)
export function cueSheet(entries: SetEntry[], file: string, title: string, performer = 'Telar'): string {
  const q = (s: string) => s.replace(/"/g, "'");
  const idx = (sec: number) => {
    const f = Math.max(0, Math.round(sec * 75));
    const m = Math.floor(f / (75 * 60)), s = Math.floor((f / 75) % 60), fr = f % 75;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(m)}:${p(s)}:${p(fr)}`;
  };
  const lines = [`PERFORMER "${q(performer)}"`, `TITLE "${q(title)}"`, `FILE "${q(file)}" MP3`];
  entries.forEach((e, i) => {
    lines.push(`  TRACK ${String(i + 1).padStart(2, '0')} AUDIO`, `    TITLE "${q(e.title)}"`, `    PERFORMER "${q(performer)}"`, `    INDEX 01 ${idx(i === 0 ? 0 : e.t)}`);
  });
  return lines.join('\r\n') + '\r\n';
}
