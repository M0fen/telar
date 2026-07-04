import { useEffect, useState } from 'react';
import { useDownloadsStore, type Track } from '../store/useDownloadsStore';
import { useGraphStore } from '../store/useGraphStore';
import { registerSample } from '../audio/engine';
import { sampleDuration, naturalLoop } from '../lib/audioMeta';
import { detectBpm } from '../lib/bpm';
import { analyzeStructure, type StructureResult } from '../lib/structure';

// Descargador de YouTube: pega un enlace → baja el audio en máxima calidad
// (bestaudio nativo) vía el endpoint del servidor (yt-dlp) y lo deja disponible
// como sample para usarlo en un nodo Source: s("yt_…"). (requiere yt-dlp)
export function Downloader() {
  const tracks = useDownloadsStore((s) => s.tracks);
  const busy = useDownloadsStore((s) => s.busy);
  const error = useDownloadsStore((s) => s.error);
  const status = useDownloadsStore((s) => s.status);
  const download = useDownloadsStore((s) => s.download);
  const refresh = useDownloadsStore((s) => s.refresh);
  const remove = useDownloadsStore((s) => s.remove);
  const addPattern = useGraphStore((s) => s.addPattern);
  const setCpsValue = useGraphStore((s) => s.setCpsValue);
  const [url, setUrl] = useState('');
  // BPM por track: undefined = sin detectar · 'wait' = detectando · number = ok · 'na' = no
  const [bpms, setBpms] = useState<Record<string, number | 'wait' | 'na'>>({});
  // estructura (mapa de energía) por track
  const [structs, setStructs] = useState<Record<string, StructureResult | 'wait' | 'na'>>({});

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 1er clic: detecta el BPM del audio. Si ya está detectado, clic = fija el tempo
  // del proyecto (cps = bpm / (60·tiempos_por_ciclo)).
  const onBpm = async (t: Track) => {
    const cur = bpms[t.id];
    if (typeof cur === 'number') {
      const bpc = useGraphStore.getState().beatsPerCycle || 4;
      setCpsValue(cur / (60 * bpc));
      return;
    }
    if (cur === 'wait') return;
    setBpms((b) => ({ ...b, [t.id]: 'wait' }));
    const bpm = await detectBpm(t.file);
    setBpms((b) => ({ ...b, [t.id]: bpm ?? 'na' }));
  };
  const bpmLabel = (v: number | 'wait' | 'na' | undefined) =>
    v === undefined ? 'bpm?' : v === 'wait' ? '···' : v === 'na' ? 'n/a' : `${v}♪`;
  // corrección manual del BPM (errores de octava: la autodetección a veces da el
  // doble o la mitad). Ajusta el valor guardado sin re-analizar.
  const adjustBpm = (t: Track, factor: number) =>
    setBpms((b) => {
      const v = b[t.id];
      if (typeof v !== 'number') return b;
      return { ...b, [t.id]: Math.max(20, Math.min(400, Math.round(v * factor))) };
    });

  // Analiza la estructura (mapa de energía por compás). Reusa el BPM ya detectado
  // para alinear los compases; si no hay, lo estima. Segundo clic = oculta.
  const onStruct = async (t: Track) => {
    const cur = structs[t.id];
    if (cur && cur !== 'wait') { setStructs((s) => ({ ...s, [t.id]: undefined as never })); return; }
    if (cur === 'wait') return;
    setStructs((s) => ({ ...s, [t.id]: 'wait' }));
    const bpm = typeof bpms[t.id] === 'number' ? (bpms[t.id] as number) : await detectBpm(t.file);
    const res = await analyzeStructure(t.file, bpm);
    setStructs((s) => ({ ...s, [t.id]: res ?? 'na' }));
  };

  const onDownload = async () => {
    const link = url.trim();
    if (!link) return;
    const t = await download(link);
    if (t) setUrl('');
  };

  // Registra el sample y crea un Source. Para que suene BIEN (y no se retrigee
  // solapado cada ciclo), medimos la duración real del audio y calculamos cuántos
  // ciclos abarca al cps actual → loopAt(n) lo reproduce una vez a velocidad
  // natural. Desde ahí se puede cortar/editar: .begin/.end, .chop(n), .slice(n,…).
  const useTrack = async (t: Track) => {
    await registerSample(t.name, t.file);
    const cycles = naturalLoop(await sampleDuration(t.file), useGraphStore.getState().cps);
    // .chop(cycles) → un disparo por ciclo: gain/cut/filtro responden enseguida
    // (con una sola voz larga sólo cambiaban al re-disparar, minutos después).
    addPattern(`s("${t.name}").loopAt(${cycles}).chop(${cycles})`, t.title.slice(0, 28));
  };

  // Descarga el audio a la carpeta de Descargas del PC (calidad máxima nativa, sin
  // recodificar). El archivo ya está en el servidor; lo bajamos con nombre legible.
  const downloadToPC = (t: Track) => {
    const ext = t.file.split('.').pop() || 'm4a';
    const safe = (t.title || t.name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 90);
    const a = document.createElement('a');
    a.href = t.file;
    a.download = `${safe}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <section className="dl">
      <h3>descargar de youtube</h3>
      <div className="dl-input">
        <input
          type="text"
          value={url}
          placeholder="pega un enlace de youtube…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onDownload();
          }}
        />
        <button onClick={() => void onDownload()} disabled={busy}>
          {busy ? '···' : '↓'}
        </button>
      </div>
      {status && !error && <p className="dl-status">{status}</p>}
      {error && <p className="dl-error">{error}</p>}
      {tracks.length > 0 && (
        <div className="dl-list">
          {tracks.map((t) => {
            const st = structs[t.id];
            const hasStruct = !!st && st !== 'wait' && st !== 'na';
            return (
            <div key={t.id} className="dl-track-wrap">
            <div className="dl-track">
              <button className="dl-track-use" title={`usar como source · ${t.name}`} onClick={() => void useTrack(t)}>
                <span className="dl-track-name">{t.title}</span>
                <span className="dl-track-add">+ source</span>
              </button>
              <span className="dl-bpm-grp">
                {typeof bpms[t.id] === 'number' && (
                  <button className="dl-bpm-adj" title="corregir: mitad del BPM" onClick={() => adjustBpm(t, 0.5)}>÷2</button>
                )}
                <button
                  className={`dl-track-bpm${typeof bpms[t.id] === 'number' ? ' ok' : ''}`}
                  title={typeof bpms[t.id] === 'number' ? 'clic: fijar el tempo del proyecto (÷2/×2 si la octava está mal)' : 'detectar BPM'}
                  onClick={() => void onBpm(t)}
                >
                  {bpmLabel(bpms[t.id])}
                </button>
                {typeof bpms[t.id] === 'number' && (
                  <button className="dl-bpm-adj" title="corregir: doble del BPM" onClick={() => adjustBpm(t, 2)}>×2</button>
                )}
              </span>
              <button
                className={`dl-track-str${hasStruct ? ' ok' : ''}`}
                title="analizar estructura (mapa de energía por compás)"
                onClick={() => void onStruct(t)}
              >
                {st === 'wait' ? '···' : st === 'na' ? 'n/a' : 'str'}
              </button>
              <button className="dl-track-dl" title="descargar al PC (máxima calidad)" onClick={() => downloadToPC(t)}>⤓</button>
              <button className="dl-track-x" title="eliminar descarga" onClick={() => void remove(t.id)}>×</button>
            </div>
            {hasStruct && (
              <div className="dl-struct" title={`${(st as StructureResult).bars.length} compases · ${(st as StructureResult).bpm ? (st as StructureResult).bpm + ' bpm' : 'bpm estimado'} · las líneas = cambios de sección`}>
                {(st as StructureResult).bars.map((v, i) => (
                  <span key={i} className={(st as StructureResult).boundaries.includes(i) ? 'bnd' : ''} style={{ height: `${Math.max(6, v * 100)}%` }} />
                ))}
              </div>
            )}
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
