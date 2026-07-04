import { useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { DEMOS } from '../lib/demos';

// TUTORIAL guiado que INVITA a hacer música: pasos cortos y accionables. Puede cargar
// un ejemplo y reproducirlo de verdad, para que el primer contacto sea "sonar en 1 clic".
// Se abre solo la primera vez (localStorage) y desde el menú ⋯.
interface Step { tag: string; title: string; body: React.ReactNode; action?: { label: string; run: () => void } }

export function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  if (!open) return null;

  const loadAndPlay = async () => {
    const demo = DEMOS.find((d) => d.id === 'reggaeton-clasico') ?? DEMOS[0];
    useGraphStore.getState().loadSnapshot(demo.snap);
    try { await useGraphStore.getState().play(); } catch { /* gesto pendiente */ }
  };

  const steps: Step[] = [
    {
      tag: 'bienvenida',
      title: 'Haz música, sin saber código',
      body: (
        <>
          <p>Telar es un <b>grafo de nodos que suena</b>: un <b>source</b> (un instrumento/patrón) pasa por <b>efectos</b> y llega al <b>Out</b> (los altavoces).</p>
          <p>No necesitas escribir nada: cada instrumento se toca con <b>herramientas visuales</b>. Empecemos sonando.</p>
        </>
      ),
      action: { label: '▶ cargar un ejemplo y sonar', run: () => void loadAndPlay() },
    },
    {
      tag: 'escuchar',
      title: 'Cada instrumento muestra su onda',
      body: (
        <>
          <p>Ya suena. Fíjate en las tarjetas de la izquierda: cada una es un <b>instrumento</b> y muestra su <b>onda en vivo</b> — así lo identificas de un vistazo.</p>
          <p>Con <b>▶ / ■</b> arriba reproduces o paras. El <b>tempo</b> y el máster (volumen, EQ, LUFS) están a la derecha.</p>
        </>
      ),
    },
    {
      tag: 'abrir',
      title: 'Abre un instrumento y sus herramientas',
      body: (
        <>
          <p>En cualquier tarjeta pulsa <b>«vista ▾»</b> para desplegar sus herramientas. Con <b>«&lt;/&gt;»</b> muestras u ocultas el código (por defecto ves el instrumento, no el código, para trabajar despejado).</p>
        </>
      ),
    },
    {
      tag: 'sin código',
      title: 'Edita sin tocar código',
      body: (
        <>
          <p>Herramientas visuales de cada source:</p>
          <ul>
            <li><b>mezcla</b>: volumen, filtro y <b>EQ de 3 bandas</b> del canal.</li>
            <li><b>entradas</b>: cuándo ENTRA cada sonido y cuántos ciclos dura (secciones).</li>
            <li><b>rejilla de silencios</b>: apaga pasos para abrir <b>huecos/silencios</b> exactos.</li>
            <li><b>estudio de voz / synth</b>: piano roll, autotune, timbre, envolventes…</li>
          </ul>
        </>
      ),
    },
    {
      tag: 'IA',
      title: 'La IA te acompaña',
      body: (
        <>
          <p>En el menú <b>⋯</b> (arriba a la derecha):</p>
          <ul>
            <li><b>copiloto</b>: describe un beat y te arma el grafo.</li>
            <li><b>voz IA</b> y <b>sfx IA</b>: texto → voz cantada / efectos.</li>
            <li><b>Nod-IA</b>: te dice por qué algo no suena o se pitchea, y lo <b>arregla con un clic</b>.</li>
          </ul>
        </>
      ),
    },
    {
      tag: 'tu turno',
      title: '¡Ahora tú!',
      body: (
        <>
          <p>Arrastra sonidos desde la <b>paleta</b> (izquierda): se conectan solos al Out y suenan. Cambia patrones con las herramientas, añade efectos arrastrándolos sobre los cables, y <b>graba/exporta</b> tu tema.</p>
          <p>¿En blanco? Abre el <b>copiloto IA</b> y pídele una base. A partir de ahí, todo tuyo.</p>
        </>
      ),
      action: { label: '✎ empezar un proyecto en blanco', run: () => { useGraphStore.getState().resetProject(); onClose(); } },
    },
  ];

  const s = steps[i];
  const last = i === steps.length - 1;

  return (
    <>
      <div className="ai-backdrop" onClick={onClose} />
      <div className="ai-panel tut">
        <header className="ai-head">
          <span className="ai-title">tutorial · empieza a hacer música</span>
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
          <button className="tut-next" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'empezar ✓' : 'siguiente ›'}</button>
        </div>
      </div>
    </>
  );
}
