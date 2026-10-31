import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { addTrack, deleteTrack, listMeta, useTrackLib, type TrackMeta } from '../audio/trackStore';
import { deckLoadTrack, newSongDeckFromTrack, referenceDeck, useSongDecks } from '../audio/songDeck';
import { autoGainDb, camelot, camelotCompatible, fmtTime } from '../lib/djDeck';
import { keyShort } from '../lib/songKey';
import { isAudioFile } from '../lib/dropFiles';
import { isDeck } from '../audio/djMix';
import { toast } from '../store/useNotifyStore';
import type { NodeData } from '../graph/types';

// BIBLIOTECA DEL SET (modo DJ, DJ-3): los temas guardados en este navegador con su tempo, tonalidad
// (Camelot), duración y volumen. Marca los que ENCAJAN con el deck que suena (tonalidad compatible:
// la misma, ±1 o su relativa) y cuánto hay que mover el tempo para llevarlos a la sesión. Un tema se
// carga en un deck de tema (botón con su número o arrastrándolo) o abre uno nuevo. Al cargarlo, su
// volumen se iguala solo (a −14 LUFS) y trae sus cues.

type SortKey = 'title' | 'bpm' | 'key' | 'dur' | 'added' | 'played';
const SORT_KEY = 'telar.dj.libsort';
const SORTS: { k: SortKey; label: string; title: string }[] = [
  { k: 'added', label: 'nuevos', title: 'los últimos que guardaste primero' },
  { k: 'played', label: 'tocados', title: 'los que sonaron hace menos primero' },
  { k: 'title', label: 'nombre', title: 'por nombre' },
  { k: 'bpm', label: 'BPM', title: 'por tempo' },
  { k: 'key', label: 'tono', title: 'por tonalidad (rueda Camelot: 1A, 1B, 2A…)' },
  { k: 'dur', label: 'dur.', title: 'por duración' },
];
const readSort = (): { k: SortKey; dir: 1 | -1 } => {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null');
    if (v && SORTS.some((s) => s.k === v.k) && (v.dir === 1 || v.dir === -1)) return v;
  } catch { /* nada guardado */ }
  return { k: 'added', dir: 1 };
};
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const camelotOrder = (m: TrackMeta) => {
  const c = /^(\d+)([AB])$/.exec(camelot(m.key));
  return c ? Number(c[1]) * 2 + (c[2] === 'B' ? 1 : 0) : 99;
};
function ago(t?: number): string {
  if (!t) return 'nunca';
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'recién';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400 * 1.5) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
}

export function SetLibrary() {
  const v = useTrackLib((s) => s.v);
  const nodes = useGraphStore((s) => s.nodes);
  const cps = useGraphStore((s) => s.cps) || 0.5;
  const bpc = useGraphStore((s) => s.beatsPerCycle) || 4;
  const decksUi = useSongDecks((s) => s.d);
  const [list, setList] = useState<TrackMeta[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSortState] = useState(readSort);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { let on = true; void listMeta().then((l) => { if (on) setList(l); }); return () => { on = false; }; }, [v]);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(null), 3000); return () => window.clearTimeout(t); }, [armed]);
  const setSort = (k: SortKey) => {
    const next = { k, dir: (sort.k === k ? -sort.dir : 1) as 1 | -1 };
    setSortState(next);
    try { localStorage.setItem(SORT_KEY, JSON.stringify(next)); } catch { /* solo esta sesión */ }
  };

  // decks (con su número en la mesa) y los de tema
  const decks = nodes.filter((n) => isDeck(n as { id: string; data: NodeData }));
  const songDecks = decks.map((n, i) => ({ id: n.id, num: i + 1, data: n.data as NodeData })).filter((d) => d.data.djTrack);
  const sessionBpm = cps * 60 * bpc;
  const refId = referenceDeck();
  void decksUi; // la referencia cambia cuando un deck arranca o para
  const ref = songDecks.find((d) => d.id === refId)?.data.djTrack ?? null;
  const refCam = camelot(ref?.key);

  const rows = useMemo(() => {
    if (!list) return [];
    const nq = norm(q.trim());
    const f = nq ? list.filter((m) => norm(`${m.title} ${m.name} ${camelot(m.key)} ${m.key ? keyShort(m.key) : ''}`).includes(nq)) : list;
    const val = (m: TrackMeta): number | string => {
      switch (sort.k) {
        case 'title': return norm(m.title);
        case 'bpm': return m.bpm;
        case 'key': return camelotOrder(m);
        case 'dur': return m.dur;
        case 'played': return -(m.played ?? 0);
        default: return -m.at;
      }
    };
    return [...f].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [list, q, sort]);

  const importFiles = async (files: File[]) => {
    const audio = files.filter(isAudioFile);
    if (!audio.length) { toast.warn('Suelta temas de audio (mp3, wav, m4a…).'); return; }
    let ok = 0;
    for (let i = 0; i < audio.length; i++) {
      setBusy(`analizando ${i + 1} de ${audio.length}: ${audio[i].name}`);
      const r = await addTrack(audio[i], audio[i].name);
      if (r) ok++;
      else toast.warn(`No pude leer «${audio[i].name}» como audio.`);
    }
    setBusy(null);
    if (ok) toast.info(ok === 1 ? 'Tema guardado en la biblioteca.' : `${ok} temas guardados en la biblioteca.`);
  };
  const remove = async (m: TrackMeta) => {
    if (armed !== m.id) { setArmed(m.id); return; }
    setArmed(null);
    await deleteTrack(m.id);
    toast.info(`«${m.title}» salió de la biblioteca (los decks que lo tienen lo siguen tocando hasta recargar).`);
  };

  return (
    <div className={`lib${over ? ' over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); if (!e.dataTransfer.files?.length) return; e.preventDefault(); e.stopPropagation(); void importFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="lib-top">
        <input className="lib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar tema, tono (8A)…" aria-label="buscar en la biblioteca" />
        <button className="sd-btn" onClick={() => fileRef.current?.click()} title="guardar temas en la biblioteca (se analizan una vez: tempo, rejilla, tonalidad y volumen)">+ temas</button>
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void importFiles(fs); }} />
      </div>
      <p className="lib-ref">
        {ref ? <>encajan con <b>«{ref.title}»</b> · <span className="lib-cam">{refCam || '—'}</span> · sesión a {sessionBpm.toFixed(1)} BPM</>
          : <>dale ▶ a un deck de tema y aquí se marcan los que encajan con él (tonalidad y tempo)</>}
      </p>
      {busy && <p className="lib-busy">{busy}…</p>}
      <div className="lib-sort" role="group" aria-label="ordenar">
        {SORTS.map((s) => (
          <button key={s.k} className={`sd-btn${sort.k === s.k ? ' on' : ''}`} onClick={() => setSort(s.k)} title={s.title}>
            {s.label}{sort.k === s.k ? (sort.dir === 1 ? ' ▾' : ' ▴') : ''}
          </button>
        ))}
      </div>
      {list && !list.length && (
        <p className="lib-empty">Aún no hay temas. Suéltalos aquí o usa «+ temas»: se analizan una vez (tempo, rejilla, tonalidad y volumen) y quedan guardados en este navegador.</p>
      )}
      <ul className="lib-list">
        {rows.map((m) => {
          const cam = camelot(m.key);
          const compat = !!(refCam && cam && camelotCompatible(refCam, cam));
          const same = !!(ref && ref.id === m.id);
          const dPct = (sessionBpm / m.bpm - 1) * 100;
          const far = Math.abs(dPct) > 8;
          const gain = autoGainDb(m.lufs);
          const inDecks = songDecks.filter((d) => d.data.djTrack?.id === m.id).map((d) => d.num);
          return (
            <li key={m.id} className={`lib-row${compat && !same ? ' compat' : ''}${same ? ' ref' : ''}`} draggable
              onDragStart={(e) => { e.dataTransfer.setData('application/telar-track', m.id); e.dataTransfer.effectAllowed = 'copy'; }}
              title={`${m.name} · ${m.lufs != null ? `${m.lufs} LUFS → ${gain >= 0 ? '+' : ''}${gain} dB al cargarlo (igualado a −14)` : 'sin medida de volumen'} · tocado ${ago(m.played)} · arrástralo a un deck`}>
              <span className={`lib-dot${compat && !same ? ' on' : ''}`} title={compat && !same ? `tonalidad compatible con ${refCam}` : ''} />
              <span className="lib-cam" title={m.key ? `${keyShort(m.key)} (Camelot ${cam})` : 'sin tonalidad detectada'}>{cam || '—'}</span>
              <span className="lib-title">{m.title}{inDecks.length > 0 && <i className="lib-in">{inDecks.map((n) => `en ${n}`).join(' · ')}</i>}</span>
              <span className="lib-bpm">{m.bpm.toFixed(1)}<i className={far ? 'far' : ''} title={`para ir a la sesión (${sessionBpm.toFixed(1)}) hay que moverlo ${dPct >= 0 ? '+' : ''}${dPct.toFixed(1)} %`}>{dPct >= 0 ? '+' : ''}{dPct.toFixed(1)}%</i></span>
              <span className="lib-dur">{fmtTime(m.dur)}</span>
              <span className="lib-acts">
                {songDecks.map((d) => {
                  const busyDeck = !!decksUi[d.id]?.playing && !decksUi[d.id]?.preview;
                  return (
                    <button key={d.id} className="sd-btn" disabled={busyDeck} onClick={() => void deckLoadTrack(d.id, m.id)}
                      title={busyDeck ? `el deck ${d.num} está sonando` : `cargar en el deck ${d.num}`}>→{d.num}</button>
                  );
                })}
                <button className="sd-btn" onClick={() => void newSongDeckFromTrack(m.id)} title="abrir un deck nuevo con este tema">+</button>
                <button className={`sd-btn lib-del${armed === m.id ? ' armed' : ''}`} onClick={() => void remove(m)}
                  title={armed === m.id ? 'toca otra vez para borrarlo de la biblioteca' : 'borrar de la biblioteca (pide confirmación)'}>{armed === m.id ? '¿borrar?' : '×'}</button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
