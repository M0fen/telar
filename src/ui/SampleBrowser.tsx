import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { soundMap } from '@strudel/web';
import { ensureEngine, loadSamplePack } from '../audio/engine';
import { useGraphStore } from '../store/useGraphStore';
import { useSamplePacksStore } from '../store/useSamplePacksStore';
import { useSoundFavStore } from '../store/useSoundFavStore';
import { playPreview, preloadPreview, stopPreview } from '../audio/previewSample';
import { getWaveInfo, drawWave } from '../audio/waveformPeaks';
import { CURATED_PACKS } from '../lib/curatedPacks';
import { categorize } from '../lib/sampleCategory';

// color de acento por categoría (coincide con las clases .sb-c-* del CSS) para la onda.
const CAT_COLOR: Record<string, string> = {
  kick: '#ff6b6b', snare: '#ffa94d', hat: '#ffd43b', cymbal: '#a9e34b', perc: '#69db7c',
  bass: '#4dabf7', synth: '#b197fc', inst: '#f783ac', vocal: '#ff8787', loop: '#74c0fc', fx: '#63e6be', other: '#868e96',
};

// Miniatura de onda + duración. Solo decodifica cuando la tarjeta entra en pantalla
// (IntersectionObserver) → no bloquea con cientos de tarjetas.
function Waveform({ name, color }: { name: string; color: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [dur, setDur] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void getWaveInfo(name).then((info) => {
            if (!alive || !info) return;
            if (ref.current) drawWave(ref.current, info.peaks, color);
            setDur(info.duration);
          });
        }
      },
      { rootMargin: '100px' },
    );
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [name, color]);
  return (
    <div className="sb-card-wave">
      <canvas ref={ref} className="sb-wave-c" />
      {dur != null && <span className="sb-card-dur">{dur < 1 ? `${Math.round(dur * 1000)}ms` : `${dur.toFixed(1)}s`}</span>}
    </div>
  );
}

// Osciladores/ruidos/wavetables: no son "samples que explorar", los ocultamos.
const HIDE = new Set(['triangle', 'sawtooth', 'square', 'sine', 'pulse', 'supersaw', 'white', 'pink', 'brown']);

// categorización por INSTRUMENTO/rol: lógica pura en src/lib/sampleCategory.ts (testeable).
const CAT_LABEL: Record<string, string> = {
  kick: 'bombos', snare: 'cajas·clap', hat: 'hats', cymbal: 'platos', perc: 'percusión',
  bass: 'bajos', inst: 'instrumentos', synth: 'sintes·leads', vocal: 'voces', loop: 'loops·breaks', fx: 'fx·atmos', other: 'otros',
  fav: 'favoritos', recent: 'recientes',
};
// icono (emoji) por categoría, para una vista escaneable de un vistazo.
const CAT_ICON: Record<string, string> = {
  kick: '🥁', snare: '👏', hat: '🎩', cymbal: '💥', perc: '🪘',
  bass: '🔊', inst: '🎹', synth: '🎛️', vocal: '🎤', loop: '🔁', fx: '✨', other: '📦',
};
const CAT_ORDER = ['kick', 'snare', 'hat', 'cymbal', 'perc', 'bass', 'synth', 'inst', 'vocal', 'loop', 'fx', 'other'];

// Navegador de SONIDOS: lista todos los samples cargados (prebake + packs del usuario),
// BUSCAR, filtrar por INSTRUMENTO, ESCUCHAR y AÑADIR (plano o afinado). El "+mel" es la
// vía para tocar instrumentos realistas (VCSL: cello/flute/marimba… repitchados por nota).
export function SampleBrowser() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [names, setNames] = useState<string[]>([]);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [packErr, setPackErr] = useState<string | null>(null);
  const addPattern = useGraphStore((s) => s.addPattern);
  const loadedPacks = useSamplePacksStore((s) => s.packs);
  const addPack = useSamplePacksStore((s) => s.add);
  const favs = useSoundFavStore((s) => s.favs);
  const recents = useSoundFavStore((s) => s.recents);
  const toggleFav = useSoundFavStore((s) => s.toggleFav);
  const addRecent = useSoundFavStore((s) => s.addRecent);

  // relee el mapa de sonidos cargados (prebake + packs) → refresca la galería.
  const refreshNames = useCallback(() => {
    try {
      const m = (soundMap as unknown as { get?: () => Record<string, unknown> }).get?.() ?? {};
      const keys = Object.keys(m).filter((k) => !HIDE.has(k) && !k.startsWith('wt_') && !k.startsWith('z_')).sort();
      setNames(keys);
    } catch {
      setNames([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void ensureEngine().then(() => { if (alive) refreshNames(); });
    return () => { alive = false; };
  }, [open, refreshNames]);

  // carga un pack curado de un clic; al terminar, refresca la lista y lo recuerda.
  const loadPack = async (ref: string) => {
    if (busyPack) return;
    setBusyPack(ref);
    setPackErr(null);
    const ok = await loadSamplePack(ref);
    setBusyPack(null);
    if (ok) { addPack(ref); refreshNames(); } else setPackErr('no se pudo cargar ' + ref);
  };

  // categoría por nombre (memo) + qué categorías existen realmente
  const catOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of names) m.set(n, categorize(n));
    return m;
  }, [names]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of catOf.values()) m[c] = (m[c] ?? 0) + 1;
    return m;
  }, [catOf]);
  const present = useMemo(() => CAT_ORDER.filter((c) => counts[c] > 0), [counts]);

  const nameSet = useMemo(() => new Set(names), [names]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let base: string[];
    if (cat === 'fav') base = favs.filter((n) => nameSet.has(n));
    else if (cat === 'recent') base = recents.filter((n) => nameSet.has(n));
    else base = names.filter((n) => cat === 'all' || catOf.get(n) === cat);
    return base.filter((n) => !s || n.toLowerCase().includes(s)).slice(0, 600);
  }, [names, nameSet, q, cat, catOf, favs, recents]);

  // Al ver "todos", agrupa por categoría (secciones con cabecera) en vez de un muro plano.
  const groups = useMemo(() => {
    if (cat !== 'all') return [{ cat, items: filtered }];
    const byCat = new Map<string, string[]>();
    for (const n of filtered) {
      const c = catOf.get(n) ?? 'other';
      (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(n);
    }
    return CAT_ORDER.filter((c) => byCat.has(c)).map((c) => ({ cat: c, items: byCat.get(c)! }));
  }, [filtered, cat, catOf]);

  // preview INSTANTÁNEO (buffer cacheado + AudioBufferSourceNode). preloadPreview en
  // hover deja el clic sin latencia.
  const preview = (name: string) => void playPreview(name, 0.95);
  const close = () => { stopPreview(); setOpen(false); };
  const add = (name: string, tuned: boolean) => {
    addRecent(name);
    addPattern(tuned ? `s("${name}").note("c3 eb3 g3 eb3")` : `s("${name}")`, name);
    close();
  };

  const [packsOpen, setPacksOpen] = useState(false);

  const Card = (name: string) => {
    const c = catOf.get(name) ?? 'other';
    const fav = favs.includes(name);
    return (
      <div className={`sb-card sb-c-${c}`} key={name} onMouseEnter={() => preloadPreview(name)}>
        <button className="sb-card-play" onClick={() => preview(name)} title="escuchar (instantáneo)">▸</button>
        <div className="sb-card-body">
          <div className="sb-card-top">
            <span className="sb-card-name" title={name}>{name}</span>
            <button className={`sb-card-fav${fav ? ' on' : ''}`} onClick={() => toggleFav(name)} title={fav ? 'quitar de favoritos' : 'marcar favorito'}>{fav ? '★' : '☆'}</button>
          </div>
          <Waveform name={name} color={CAT_COLOR[c] ?? '#63e6be'} />
        </div>
        <div className="sb-card-adds">
          <button className="sb-card-add" onClick={() => add(name, false)} title="añadir al lienzo como sonido">añadir</button>
          <button className="sb-card-add mel" onClick={() => add(name, true)} title="añadir afinado (melódico) — ideal para instrumentos reales (piano, cello, marimba…)">♪</button>
        </div>
      </div>
    );
  };

  return (
    <>
      <button className="sb-open" onClick={() => setOpen(true)} title="biblioteca de sonidos: explora por categoría, escucha y añade">
        ◉ explorar sonidos{names.length ? ` (${names.length})` : ''}
      </button>
      {open && createPortal(
        <>
          <div className="vs-backdrop" onClick={close} />
          <div className="sb-panel">
            <header className="sb-head">
              <span className="sb-title">biblioteca de sonidos</span>
              <input className="sb-search" autoFocus value={q} placeholder="buscar… piano · 808 · cello · amen · marimba" onChange={(e) => setQ(e.target.value)} />
              <button className="vs-x" onClick={close} title="cerrar (Esc)">×</button>
            </header>

            <div className="sb-body">
              {/* rail de categorías */}
              <nav className="sb-rail">
                <button className={`sb-railcat${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>
                  <span className="sb-railcat-ico">◉</span>
                  <span className="sb-railcat-lbl">todos</span>
                  <span className="sb-railcat-n">{names.length}</span>
                </button>
                {favs.length > 0 && (
                  <button className={`sb-railcat${cat === 'fav' ? ' on' : ''}`} onClick={() => setCat('fav')}>
                    <span className="sb-railcat-ico">★</span>
                    <span className="sb-railcat-lbl">favoritos</span>
                    <span className="sb-railcat-n">{favs.filter((n) => nameSet.has(n)).length}</span>
                  </button>
                )}
                {recents.length > 0 && (
                  <button className={`sb-railcat${cat === 'recent' ? ' on' : ''}`} onClick={() => setCat('recent')}>
                    <span className="sb-railcat-ico">🕐</span>
                    <span className="sb-railcat-lbl">recientes</span>
                    <span className="sb-railcat-n">{recents.filter((n) => nameSet.has(n)).length}</span>
                  </button>
                )}
                {present.map((c) => (
                  <button key={c} className={`sb-railcat${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>
                    <span className="sb-railcat-ico">{CAT_ICON[c] ?? '📦'}</span>
                    <span className="sb-railcat-lbl">{CAT_LABEL[c] ?? c}</span>
                    <span className="sb-railcat-n">{counts[c]}</span>
                  </button>
                ))}
                <button className={`sb-railpacks${packsOpen ? ' on' : ''}`} onClick={() => setPacksOpen((v) => !v)} title="cargar más bancos de sonidos gratis">
                  <span className="sb-railcat-ico">➕</span>
                  <span className="sb-railcat-lbl">más packs</span>
                </button>
              </nav>

              {/* contenido */}
              <div className="sb-main">
                {packsOpen && (
                  <div className="sb-packs">
                    {CURATED_PACKS.map((p) => {
                      const loaded = loadedPacks.includes(p.ref);
                      const busy = busyPack === p.ref;
                      return (
                        <button
                          key={p.ref}
                          className={`sb-pack${loaded ? ' loaded' : ''}${busy ? ' busy' : ''}`}
                          onClick={() => !loaded && void loadPack(p.ref)}
                          disabled={busy || !!busyPack}
                          title={`${p.desc}\n${p.tags.join(' · ')}${loaded ? '\n(ya cargado)' : ''}`}
                        >
                          {loaded ? '✓ ' : busy ? '··· ' : '↓ '}{p.title}
                        </button>
                      );
                    })}
                    {packErr && <span className="sb-packs-err">{packErr}</span>}
                  </div>
                )}
                <div className="sb-scroll">
                  {names.length === 0 && <div className="sb-empty">cargando sonidos…</div>}
                  {names.length > 0 && filtered.length === 0 && <div className="sb-empty">nada con «{q}» en {cat === 'all' ? 'toda la biblioteca' : CAT_LABEL[cat]}. Prueba otra búsqueda o categoría.</div>}
                  {groups.map((g) => (
                    <section className="sb-group" key={g.cat}>
                      {cat === 'all' && (
                        <button className="sb-group-h" onClick={() => setCat(g.cat)} title={`ver solo ${CAT_LABEL[g.cat] ?? g.cat}`}>
                          <span className="sb-group-ico">{CAT_ICON[g.cat] ?? '📦'}</span>
                          {CAT_LABEL[g.cat] ?? g.cat}
                          <i>{g.items.length}</i>
                        </button>
                      )}
                      <div className="sb-grid">
                        {(cat === 'all' ? g.items.slice(0, 60) : g.items).map((name) => Card(name))}
                      </div>
                      {cat === 'all' && g.items.length > 60 && (
                        <button className="sb-more" onClick={() => setCat(g.cat)}>ver los {g.items.length} de {CAT_LABEL[g.cat] ?? g.cat} →</button>
                      )}
                    </section>
                  ))}
                </div>
                <div className="sb-count"><b>▸</b> escuchar (instantáneo, precarga en hover) · <b>añadir</b> como sonido · <b>♪</b> afinado, para instrumentos</div>
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
