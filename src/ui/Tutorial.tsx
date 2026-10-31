import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useDetailStore } from '../store/useDetailStore';
import { useMixerStore } from '../store/useMixerStore';
import { useDawUiStore } from '../store/useDawUiStore';
import { TEMPLATES } from '../lib/templates';
import { setExportPrefs } from '../lib/songExport';
import { openLibrary } from '../lib/openLibrary';

// TUTORIAL: hacer un tema en Telar, paso a paso y con botones que lo hacen (no solo lo cuentan).
// Sigue el camino que se usa de verdad: oír un tema hecho, la canción en el DAW, editar en grande,
// clips, sonidos de la biblioteca, mezcla, tocar en vivo y exportar. Se abre solo la primera vez
// (ToolsMenu), desde el menú ⋯ y con Ctrl+K › «tutorial».
interface Step { tag: string; title: string; body: React.ReactNode; action?: { label: string; run: () => void } }

const g = () => useGraphStore.getState();

export function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  if (!open) return null;

  const loadAndPlay = async () => {
    const t = TEMPLATES.find((x) => x.id === 'groove-techno') ?? TEMPLATES[0];
    g().loadSnapshot(t.build(), `tutorial · plantilla ${t.title}`);
    if (t.exportTarget != null) setExportPrefs({ target: t.exportTarget });
    useDawUiStore.getState().setLauncher(false);
    g().setMode('daw');
    try { await g().play(); } catch { /* falta el gesto: ▶ arriba */ }
    setI(1);
  };
  // el bajo en el piano roll (o la primera pista con notas, o la primera que haya)
  const openBig = () => {
    const ns = g().nodes.filter((n) => n.data.kind === 'source' && !Array.isArray(n.data.transitions));
    const melodic = (n: (typeof ns)[number]) => /\b(?:note|n)\(/.test(n.data.code ?? '');
    const t = ns.find((n) => melodic(n) && /bajo|bass/i.test(n.data.name ?? '')) ?? ns.find(melodic) ?? ns[0];
    if (!t) return;
    try { if (melodic(t)) localStorage.setItem('telar.seq.view', 'roll'); } catch { /* la rejilla también sirve */ }
    g().setMode('daw');
    useMixerStore.getState().setOpen(false);
    useDetailStore.getState().close();
    window.setTimeout(() => useDetailStore.getState().open(t.id), 0);
    onClose();
  };

  const steps: Step[] = [
    {
      tag: 'bienvenida',
      title: 'Haz tu tema en Telar',
      body: (
        <>
          <p>Telar tiene tres vistas (arriba): <b>DAW</b>, la canción en compases; <b>standard</b>, el grafo donde cada sonido pasa por sus efectos hasta la salida; y <b>DJ</b>, para tocar en vivo.</p>
          <p>Empieza oyendo un tema hecho aquí: 80 compases de techno con secciones, sidechain y transiciones.</p>
        </>
      ),
      action: { label: '▶ abrir la plantilla y sonar', run: () => void loadAndPlay() },
    },
    {
      tag: 'la canción',
      title: 'La canción, de un vistazo',
      body: (
        <>
          <p>Arriba van las <b>secciones</b> (intro, subida, drop…). Cada fila es un <b>instrumento</b> y sus bloques muestran lo que suena: golpes, notas u onda.</p>
          <p><b>Clic en los números de compás</b>: tocar desde ahí. <b>M</b>: marcador. <b>F</b>: seguir el cabezal. Cada pista tiene M (silencio), S (solo), A (automatización) y su medidor; agranda la fila (arrastra su borde de abajo, o «↕ alto») para ver su volumen y paneo.</p>
        </>
      ),
    },
    {
      tag: 'editar',
      title: 'Edita en grande',
      body: (
        <>
          <p><b>Doble clic en un bloque</b> (o <b>E</b>) lo abre abajo, en grande. Una batería se edita en la <b>rejilla</b> (clic = golpe; clic derecho = acento) o en <b>pads</b>. Una melodía, en el <b>piano roll</b>: notas largas, acordes en el tono del tema y las demás pistas de fantasma.</p>
          <p>Todo suena al instante; no hay que guardar.</p>
        </>
      ),
      action: { label: '🎹 abrir el bajo en grande', run: openBig },
    },
    {
      tag: 'clips',
      title: 'Mueve, estira y duplica',
      body: (
        <>
          <p><b>Un clic elige</b> un clip; <b>otro clic</b> lo apaga o lo enciende. Arrástralo a otro compás (o a otra pista) y <b>estira su borde</b> para repetirlo.</p>
          <p><b>Ctrl+D</b> duplica, <b>Ctrl+E</b> parte, <b>Ctrl+J</b> une y <b>Ctrl+Z</b> deshace (⏱ al lado de deshacer: volver a cualquier paso). Mover una <b>sección</b> mueve todo lo suyo: clips, curvas y transiciones.</p>
        </>
      ),
    },
    {
      tag: 'sonidos',
      title: 'Trae tus sonidos',
      body: (
        <>
          <p>En la <b>biblioteca</b> (izquierda › «explorar sonidos») busca «kick», «909 hh», «caja», «bajo»… <b>▸</b> escucha y <b>♩</b> lo toca a tempo, desde el próximo compás.</p>
          <p><b>Arrástralo</b> a una pista y a un compás, a un pad, o debajo de las pistas para una pista nueva. Un golpe suelto se abre en la rejilla, listo para escribir el patrón.</p>
        </>
      ),
      action: { label: '◉ abrir la biblioteca', run: () => { onClose(); openLibrary(); } },
    },
    {
      tag: 'mezcla',
      title: 'Mezcla viendo lo que pasa',
      body: (
        <>
          <p><b>▥ mezclador</b> (tecla <b>X</b>): una tira por pista con volumen en dB, paneo, envíos a la reverb y al eco, EQ y compresor.</p>
          <p>Al elegir una pista: la <b>EQ</b> sobre su espectro en vivo, el <b>compresor</b> y el bombeo del sidechain, la <b>cadena</b> con macros y el <b>máster</b> con su LUFS.</p>
        </>
      ),
      action: { label: '▥ abrir el mezclador', run: () => { g().setMode('daw'); useMixerStore.getState().setOpen(true); onClose(); } },
    },
    {
      tag: 'en vivo',
      title: 'Toca en vivo',
      body: (
        <>
          <p><b>▦ lanzador</b>: cada pista con sus variaciones; tocar una la lanza en el 1 del próximo compás. Con <b>● grabar la toma</b>, lo que lances queda escrito en la canción.</p>
          <p>La vista <b>DJ</b> es una mesa: decks con volumen, filtro, EQ, crossfader, cue en audífonos y tu controlador MIDI.</p>
        </>
      ),
    },
    {
      tag: 'tu tema',
      title: 'Termina y comparte',
      body: (
        <>
          <p><b>⤓ exportar</b>: WAV de 24 bit para distribuir, MP3 para el celular, a <b>−14 LUFS</b> (streaming) o <b>−8</b> (club). También stems por pista y MIDI.</p>
          <p><b>Ctrl+K</b> busca cualquier acción y <b>?</b> muestra los atajos. Empieza el tuyo: «crear estructura ▾» arma las secciones y la biblioteca pone los sonidos.</p>
        </>
      ),
      action: {
        label: '✎ empezar mi tema (lienzo en blanco)',
        run: () => {
          void g().stop(); // en silencio: el tema de ejemplo no sigue sonando sobre el tuyo
          useMixerStore.getState().setOpen(false);
          useDetailStore.getState().close();
          g().resetProject('tutorial · lienzo en blanco');
          useDawUiStore.getState().setLauncher(false);
          g().setMode('daw');
          onClose();
        },
      },
    },
  ];

  const s = steps[i];
  const last = i === steps.length - 1;

  return (
    <>
      <div className="ai-backdrop" onClick={onClose} />
      <div className="ai-panel tut">
        <header className="ai-head">
          <span className="ai-title">tutorial · haz tu tema en Telar</span>
          <button className="ai-x" onClick={onClose} title="cerrar">×</button>
        </header>

        <div className="tut-dots">
          {steps.map((st, k) => (
            <button key={k} className={`tut-dot${k === i ? ' on' : ''}${k < i ? ' done' : ''}`} onClick={() => setI(k)} title={st.tag} />
          ))}
        </div>

        <div className="tut-body">
          <span className="tut-tag">{s.tag}</span>
          <h3>{s.title}</h3>
          {s.body}
          {s.action && <button className="tut-action" onClick={s.action.run}>{s.action.label}</button>}
        </div>

        <div className="tut-nav">
          <button className="tut-prev" onClick={() => (i === 0 ? onClose() : setI(i - 1))}>{i === 0 ? 'saltar' : '‹ atrás'}</button>
          <span className="tut-count">{i + 1} / {steps.length}</span>
          <button className="tut-next" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'listo ✓' : 'siguiente ›'}</button>
        </div>
      </div>
    </>
  );
}
