import { lazy, Suspense, useEffect, useState } from 'react';
import { MidiButton } from './MidiButton';
import { Guide } from './Guide';
// paneles del menú ⋯: su código llega al abrirlos
const AiCopilot = lazy(() => import('./AiCopilot').then((m) => ({ default: m.AiCopilot })));
const VoiceAI = lazy(() => import('./VoiceAI').then((m) => ({ default: m.VoiceAI })));
const AiSong = lazy(() => import('./AiSong').then((m) => ({ default: m.AiSong })));
const AiSfx = lazy(() => import('./AiSfx').then((m) => ({ default: m.AiSfx })));
const Tutorial = lazy(() => import('./Tutorial').then((m) => ({ default: m.Tutorial })));
const PackGenerator = lazy(() => import('./PackGenerator').then((m) => ({ default: m.PackGenerator })));
const SpatialMix = lazy(() => import('./SpatialMix').then((m) => ({ default: m.SpatialMix })));
import { useSamplePacksStore } from '../store/useSamplePacksStore';
import { loadSamplePack } from '../audio/engine';

// «opinar»: un tema nuevo en GitHub con la versión y el navegador ya escritos (sin datos del proyecto)
function feedbackUrl(): string {
  const body = `**Qué pasó o qué propones:**\n\n\n---\nversión ${String(import.meta.env.VITE_COMMIT ?? '')} · ${navigator.userAgent}`;
  return `https://github.com/M0fen/telar/issues/new?body=${encodeURIComponent(body)}`;
}

// Cargador de PACKS de sonidos: el usuario pega `github:usuario/repo` o una URL a un
// strudel.json y quedan disponibles como `s("nombre")`. Persiste y recarga al abrir.
function PacksLoader() {
  const packs = useSamplePacksStore((s) => s.packs);
  const add = useSamplePacksStore((s) => s.add);
  const remove = useSamplePacksStore((s) => s.remove);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const r = ref.trim();
    if (!r) return;
    setBusy(true);
    setErr(null);
    const ok = await loadSamplePack(r);
    setBusy(false);
    if (ok) { add(r); setRef(''); } else setErr('no se pudo cargar ese pack');
  };

  return (
    <div className="packs">
      <div className="packs-head">sonidos · cargar pack</div>
      <div className="packs-in">
        <input
          value={ref}
          placeholder="github:usuario/repo  ·  o URL .json"
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
        />
        <button onClick={() => void load()} disabled={busy}>{busy ? '···' : 'cargar'}</button>
      </div>
      {err && <div className="packs-err">{err}</div>}
      {packs.length > 0 && (
        <div className="packs-list">
          {packs.map((p) => (
            <span className="packs-item" key={p}><span>{p}</span><button onClick={() => remove(p)} title="quitar de la lista (no descarga menos)">×</button></span>
          ))}
        </div>
      )}
      <div className="packs-hint">ej.: tidalcycles/dirt-samples · eddyflux/crate · switchangel/breaks</div>
    </div>
  );
}

// Menú "⋯ más": agrupa lo ocasional (midi, guía, packs de sonidos) para descongestionar
// la barra superior. Los controles frecuentes (transporte, modos, grabar, deshacer)
// se quedan siempre visibles.
export function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [voxOpen, setVoxOpen] = useState(false);
  const [songOpen, setSongOpen] = useState(false);
  const [sfxOpen, setSfxOpen] = useState(false);
  const [tutOpen, setTutOpen] = useState(false);
  const [pgOpen, setPgOpen] = useState(false);
  const [mixOpen, setMixOpen] = useState(false);
  // Ctrl+K › «tutorial»
  useEffect(() => {
    const onTut = () => setTutOpen(true);
    window.addEventListener('telar:tutorial', onTut);
    return () => window.removeEventListener('telar:tutorial', onTut);
  }, []);
  // se abre solo la PRIMERA vez (invita a hacer música); luego, desde este menú.
  useEffect(() => {
    try {
      if (!localStorage.getItem('telar-tutorial-seen')) {
        // se marca al ABRIRSE (antes se marcaba al montar: si el menú se montaba dos veces, el
        // primer montaje lo daba por visto y el tutorial no salía nunca)
        const t = setTimeout(() => { try { localStorage.setItem('telar-tutorial-seen', '1'); } catch { /* */ } setTutOpen(true); }, 700);
        return () => clearTimeout(t);
      }
    } catch { /* sin localStorage */ }
  }, []);
  return (
    <div className="tools-menu">
      <button className={`tools-btn${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} title="más: componer canción · copiloto IA · voz IA · midi · guía · packs">⋯</button>
      {open && (
        <>
          <div className="tools-backdrop" onClick={() => setOpen(false)} />
          <div className="tools-pop">
            <button className="tools-row tools-ai tools-song" onClick={() => { setSongOpen(true); setOpen(false); }} title="componer una canción completa (pista + letra + voz) desde una descripción">
              {/* nota musical = componer canción */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l10-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="16" cy="16" r="3" />
              </svg>
              <span>componer canción · pipeline IA</span>
            </button>
            <button className="tools-row tools-ai" onClick={() => { setAiOpen(true); setOpen(false); }} title="copiloto IA: describe un beat y arma el grafo">
              {/* chispa = IA */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" />
                <path d="M18 14l.9 2.3L21 17l-2.1.7L18 20l-.9-2.3L15 17l2.1-.7z" />
              </svg>
              <span>copiloto IA · prompt → grafo</span>
            </button>
            <button className="tools-row tools-ai" onClick={() => { setVoxOpen(true); setOpen(false); }} title="voz IA: escribe una letra y se sintetiza; entra al estudio de voz">
              {/* micrófono = voz IA */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2.5" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <line x1="12" y1="18" x2="12" y2="21.5" />
              </svg>
              <span>voz IA · texto → voz</span>
            </button>
            <button className="tools-row tools-ai" onClick={() => { setSfxOpen(true); setOpen(false); }} title="sfx IA: describe un sonido (riser, impacto, textura) y se genera">
              {/* onda = sfx generativo */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h3l2-7 3 16 3-11 2 5h7" />
              </svg>
              <span>sfx IA · texto → sonido</span>
            </button>
            <div className="tools-sep" />
            <button className="tools-row" onClick={() => { setMixOpen(true); setOpen(false); }} title="superficie de mezcla espacial: cada instrumento es un punto (paneo × frecuencia); arrástralos para que no choquen">
              {/* diana = superficie espacial (paneo × frecuencia) */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4" />
                <line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" />
                <line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" />
              </svg>
              <span>superficie de mezcla · pan × frecuencia</span>
            </button>
            <button className="tools-row" onClick={() => { setPgOpen(true); setOpen(false); }} title="generar packs de sonido: arrastra tus .wav y quedan como s(&quot;nombre&quot;), persisten y se exportan">
              {/* cajas/paquete = pack de sonidos */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8V16a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8" />
                <path d="M3.3 7 12 12l8.7-5M12 22V12" />
                <path d="m7.5 4.3 9 5.4" />
              </svg>
              <span>packs de sonido · generar</span>
            </button>
            <button className="tools-row tools-tut" onClick={() => { setTutOpen(true); setOpen(false); }} title="tutorial: cómo hacer música con Telar, paso a paso">
              {/* brújula = tutorial/empezar */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polygon points="15.5 8.5 10.5 10.5 8.5 15.5 13.5 13.5" />
              </svg>
              <span>tutorial · empezar a hacer música</span>
            </button>
            <div className="tools-row" onClick={() => setOpen(false)}><MidiButton /><span>midi</span></div>
            <div className="tools-row" onClick={() => setOpen(false)}><Guide /><span>guía / documentación</span></div>
            <div className="tools-sep" />
            <PacksLoader />
            <div className="tools-sep" />
            <div className="tools-legal">
              <a href="/licencias.html" target="_blank" rel="noopener">código · licencias · créditos</a>
              <a href="/privacidad.html" target="_blank" rel="noopener">privacidad · términos</a>
              <a href={feedbackUrl()} target="_blank" rel="noopener">opinar · reportar un error</a>
            </div>
          </div>
        </>
      )}
      <Suspense fallback={null}>
        {aiOpen && <AiCopilot open onClose={() => setAiOpen(false)} />}
        {voxOpen && <VoiceAI open onClose={() => setVoxOpen(false)} />}
        {songOpen && <AiSong open onClose={() => setSongOpen(false)} />}
        {sfxOpen && <AiSfx open onClose={() => setSfxOpen(false)} />}
        {tutOpen && <Tutorial open onClose={() => setTutOpen(false)} />}
        {pgOpen && <PackGenerator open onClose={() => setPgOpen(false)} />}
        {mixOpen && <SpatialMix open onClose={() => setMixOpen(false)} />}
      </Suspense>
    </div>
  );
}
