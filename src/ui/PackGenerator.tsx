import { useEffect, useRef, useState } from 'react';
import { listPacks, getPack, putPack, deletePack, registerPack, registerFile, packToStrudelJson, suggestSoundName, parseNote, type PackFile, type PackMeta, type UserPack } from '../lib/userPacks';
import { parseSpliceName } from '../lib/splice';
import { sampleDuration, sampleSourceCode } from '../lib/audioMeta';
import { useGraphStore } from '../store/useGraphStore';

// GENERADOR DE PACKS: arrastra .wav → se vuelven s("nombre") en Telar, se guardan
// (IndexedDB, sobreviven a recargar) y se pueden exportar como strudel.json para
// hospedarlos. Detecta la nota base del nombre del fichero (p.ej. "Rhodes_C3.wav")
// para multisamples que suenen afinados con note("…").s("nombre").

const AUDIO_RE = /\.(wav|mp3|ogg|flac|aac|m4a|webm)$/i;
const genId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function PackGenerator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pending, setPending] = useState<PackFile[]>([]);
  const [packName, setPackName] = useState('');
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refresh = () => { void listPacks().then(setPacks); };
  useEffect(() => { if (open) refresh(); }, [open]);
  if (!open) return null;

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(null), 2200); };

  const addFiles = (files: FileList | File[]) => {
    const audio = Array.from(files).filter((f) => AUDIO_RE.test(f.name) || f.type.startsWith('audio/'));
    if (!audio.length) { flash('no encontré audio (.wav/.mp3/…)'); return; }
    // lee la convención de Splice: nombre limpio + BPM + tonalidad + loop/one-shot.
    const rows: PackFile[] = audio.map((f) => {
      const meta = parseSpliceName(f.name, (f as { webkitRelativePath?: string }).webkitRelativePath || '');
      return { fileName: f.name, soundName: meta.clean || suggestSoundName(f.name), note: meta.note ?? parseNote(f.name.replace(/\.[^.]+$/, '')), blob: f, bpm: meta.bpm, loop: meta.loop };
    });
    setPending((p) => [...p, ...rows]);
    if (!packName) setPackName('mi_pack');
  };

  // Añade UN archivo al lienzo, listo para sonar. Un LOOP con BPM entra EN TIEMPO y a
  // pitch natural (pone el proyecto a su tempo y calcula loopAt según su duración); un
  // one-shot entra como s("nombre"). Es el "de Splice al beat" en un clic.
  const addToCanvas = async (r: PackFile) => {
    const st = useGraphStore.getState();
    const name = (r.soundName || 'sample').replace(/[^a-z0-9_]/gi, '_');
    const url = await registerFile(name, r.blob);
    const dur = await sampleDuration(url).catch(() => 0);
    // Siempre a TEMPO NATURAL (manda el BPM del sample): sampleSourceCode usa .slow si es
    // largo (loop sin solape, sin varispeed) o s() si es corto. NO cambiamos el BPM del
    // proyecto automáticamente (misma regla que drag / auto-encaje al Play).
    const code = sampleSourceCode(name, dur, st.cps);
    st.addPattern(code, name, {}, undefined, { connectToOut: true });
    flash(code.includes('.slow(') ? `«${name}» al lienzo · loop a su tempo natural` : `«${name}» al lienzo`);
    if (!useGraphStore.getState().playing) void useGraphStore.getState().play();
  };

  const preview = (blob: Blob) => {
    audioRef.current?.pause();
    const a = new Audio(URL.createObjectURL(blob));
    audioRef.current = a;
    a.onended = () => URL.revokeObjectURL(a.src);
    void a.play().catch(() => {});
  };

  const setRow = (i: number, patch: Partial<PackFile>) => setPending((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setPending((p) => p.filter((_, j) => j !== i));

  const currentPack = (): UserPack => ({ id: genId(), name: (packName.trim() || 'mi_pack').replace(/[^a-z0-9_]+/gi, '_'), createdAt: Date.now(), files: pending });

  const loadSession = async () => {
    if (!pending.length) return;
    const names = await registerPack({ ...currentPack(), id: 'session' }, true);
    flash(`cargado en la sesión: ${names.map((n) => `s("${n}")`).join('  ')}`);
  };
  const savePack = async () => {
    if (!pending.length) return;
    const pack = currentPack();
    await putPack(pack);
    await registerPack(pack, true);
    setPending([]); setPackName('');
    refresh();
    flash(`pack guardado (${pack.files.length} sonidos) — ya suena y persiste al recargar`);
  };
  const exportJson = (files: PackFile[], name: string) => {
    const pack: UserPack = { id: 'x', name, createdAt: 0, files };
    const blob = new Blob([packToStrudelJson(pack)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `strudel.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash('strudel.json descargado — súbelo junto a los .wav a tu repo/bucket');
  };
  const loadSaved = async (id: string) => {
    const p = await getPack(id); if (!p) return;
    const names = await registerPack(p, true);
    flash(`«${p.name}» activo: ${names.map((n) => `s("${n}")`).join('  ')}`);
  };
  const exportSaved = async (id: string) => { const p = await getPack(id); if (p) exportJson(p.files, p.name); };
  const removeSaved = async (id: string) => { await deletePack(id); refresh(); flash('pack borrado'); };

  return (
    <>
      <div className="ai-backdrop" onClick={onClose} />
      <div className="ai-panel pg">
        <header className="ai-head">
          <span className="ai-title">packs de sonido · generar</span>
          <button className="ai-x" onClick={onClose} title="cerrar">×</button>
        </header>

        <div
          className={`pg-drop${drag ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
        >
          <p>arrastra aquí tus <b>.wav</b> (o usa los botones)</p>
          <div className="pg-picks">
            <label className="pg-pick">
              elegir archivos
              <input type="file" multiple accept="audio/*,.wav,.mp3,.ogg,.flac,.aac,.m4a" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <label className="pg-pick pg-pick-alt">
              elegir carpeta
              <input ref={(el) => { if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); } }} type="file" multiple style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          <span className="pg-tip">detecta la nota del nombre (ej. «Rhodes_C3.wav») para multisamples afinados · ideal para carpetas de Splice</span>
        </div>

        {pending.length > 0 && (
          <div className="pg-build">
            <div className="pg-name">
              <span>nombre del pack</span>
              <input value={packName} onChange={(e) => setPackName(e.target.value)} placeholder="mi_pack" />
            </div>
            <div className="pg-rows">
              <div className="pg-row pg-row-head"><span>archivo</span><span>sonido s("…")</span><span>nota</span><span></span></div>
              {pending.map((r, i) => (
                <div className="pg-row" key={i}>
                  <span className="pg-file" title={r.fileName}>
                    {r.fileName}
                    {r.bpm ? <i className="pg-badge">{r.bpm}</i> : null}
                    {r.loop ? <i className="pg-badge pg-loop">loop</i> : null}
                  </span>
                  <input className="pg-in" value={r.soundName} onChange={(e) => setRow(i, { soundName: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_') })} />
                  <input className="pg-in pg-note" value={r.note ?? ''} placeholder="—" onChange={(e) => setRow(i, { note: e.target.value.trim() || undefined })} />
                  <span className="pg-rowbtns">
                    <button onClick={() => preview(r.blob)} title="escuchar">▶</button>
                    <button onClick={() => void addToCanvas(r)} title={r.loop ? 'al lienzo en tiempo (loop)' : 'al lienzo'}>▸</button>
                    <button onClick={() => removeRow(i)} title="quitar">×</button>
                  </span>
                </div>
              ))}
            </div>
            <div className="pg-actions">
              <button className="pg-go" onClick={() => void loadSession()} title="registra los sonidos ya (se pierden al recargar)">cargar en la sesión</button>
              <button className="pg-go pg-save" onClick={() => void savePack()} title="guarda en el navegador (persiste) y registra">guardar pack</button>
              <button className="pg-ghost" onClick={() => exportJson(pending, packName || 'mi_pack')} title="descarga strudel.json para hospedarlo tú">exportar strudel.json</button>
              <button className="pg-ghost" onClick={() => setPending([])}>limpiar</button>
            </div>
          </div>
        )}

        <div className="pg-saved">
          <div className="pg-saved-head">mis packs {packs.length ? `(${packs.length})` : ''}</div>
          {packs.length === 0 && <p className="pg-empty">aún no has guardado packs. Arrastra samples arriba y pulsa «guardar pack».</p>}
          {packs.map((p) => (
            <div className="pg-savedrow" key={p.id}>
              <div className="pg-savedinfo">
                <b>{p.name}</b>
                <span>{p.count} archivos · {p.sounds.slice(0, 6).map((s) => `s("${s}")`).join(' ')}{p.sounds.length > 6 ? '…' : ''}</span>
              </div>
              <div className="pg-savedbtns">
                <button onClick={() => void loadSaved(p.id)} title="activar en el motor">cargar</button>
                <button onClick={() => void exportSaved(p.id)} title="exportar strudel.json">json</button>
                <button className="pg-del" onClick={() => void removeSaved(p.id)} title="borrar">×</button>
              </div>
            </div>
          ))}
        </div>

        {note && <div className="pg-note-bar">{note}</div>}
        <p className="pg-legal">Tus samples se guardan solo en tu navegador. Para publicar packs de PAGO (Splice/Loopmasters) en un repo público harías redistribución (prohibida) — para eso usa CC0 (VCSL, Freesound-CC0).</p>
      </div>
    </>
  );
}
