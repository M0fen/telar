import { useState } from 'react';
import { OPS } from '../graph/ops';
import { SYNTH_PRESETS } from '../graph/synthPresets';
import { URBAN_KITS } from '../graph/instrumentKits';
import {
  DRUM_MACHINES, DRUM_MACHINES_TOTAL, DRUM_SOUNDS, OTHER_SAMPLES,
  WAVES, WAVETABLES, SIGNALS, MININOTATION, RECIPES,
} from '../docs/catalog';

// Guía / documentación en el sitio: explica cómo funciona Telar y, sobre todo,
// QUÉ contenido hay disponible para hacer canciones (samples, sintes, FX, kits,
// recetas). Se nutre del mismo catálogo que la referencia para la IA (CONTENIDO.md).
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="gd-sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Guide() {
  const [open, setOpen] = useState(false);
  const transforms = OPS.filter((o) => o.kind === 'transform');
  const fx = OPS.filter((o) => o.kind === 'fx');
  const opLine = (o: (typeof OPS)[number]) =>
    o.params.length ? `${o.label} (${o.params.map((p) => p.key).join(', ')})` : o.label;

  return (
    <div className="gd">
      <button className={`gd-btn${open ? ' on' : ''}`} onClick={() => setOpen(true)} title="guía y contenido disponible">
        guía
      </button>
      {open && (
        <>
          <div className="gd-backdrop" onClick={() => setOpen(false)} />
          <div className="gd-panel">
            <header className="gd-head">
              <span className="gd-title">Telar · guía y contenido</span>
              <button className="gd-x" onClick={() => setOpen(false)} title="cerrar">×</button>
            </header>
            <div className="gd-body">
              <Section title="cómo funciona">
                <p>
                  Telar es un <b>grafo de nodos</b>: <code>source</code> (un patrón) → <code>fx</code> →{' '}
                  <code>out</code>. Arrastra FX de la paleta sobre un cable para insertarlos en vivo. Modo{' '}
                  <b>standard</b> = lienzo de nodos; modo <b>dj</b> = canales lado a lado. Todo suena en vivo
                  (hot-swap): editas y cambia al instante.
                </p>
              </Section>

              <Section title="hacer una canción">
                <ol className="gd-ol">
                  <li>Crea <code>source</code> (o arrastra un kit urbano) y conéctalos al <code>out</code>.</li>
                  <li>Para estructura usa <code>arrange([4, patrónA], [8, patrónB], …)</code>: los números son ciclos; deben sumar lo mismo en todas las fuentes para ir sincronizadas. Usa <code>silence</code> para que un elemento entre más tarde.</li>
                  <li>Pon el tempo (BPM) y, si hace falta, el compás <code>/N</code> y el <b>tono</b>.</li>
                  <li>Añade FX entre nodos (lpf, room, delay, sidechain…) y macros en el master.</li>
                </ol>
              </Section>

              <Section title="sintetizadores">
                <p className="gd-mut">osciladores (en <code>.s("…")</code> o el panel synth de cada source):</p>
                <ul className="gd-chips">
                  {WAVES.map((w) => <li key={w.id} title={w.name}><code>{w.id}</code> · {w.name}</li>)}
                </ul>
                <p className="gd-mut">wavetables propias:</p>
                <ul className="gd-chips">{WAVETABLES.map((w) => <li key={w}><code>{w}</code></li>)}</ul>
                <p className="gd-mut">presets de timbre (panel synth):</p>
                <div className="gd-tags">{SYNTH_PRESETS.map((p) => <span key={p.name}>{p.name}</span>)}</div>
              </Section>

              <Section title="samples · baterías">
                <p>
                  Bancos de cajas de ritmo: úsalos con <code>s("bd sd hh").bank("RolandTR808")</code>. Sin{' '}
                  <code>.bank()</code> suenan los del banco por defecto. Los samples se <b>afinan</b> con{' '}
                  <code>note()</code> (así se hace el cencerro melódico del phonk).
                </p>
                <p className="gd-mut">sonidos comunes:</p>
                <ul className="gd-chips">
                  {DRUM_SOUNDS.map((d) => <li key={d.abbr} title={d.name}><code>{d.abbr}</code> · {d.name}</li>)}
                </ul>
                <p className="gd-mut">{DRUM_MACHINES_TOTAL} bancos disponibles (algunos):</p>
                <div className="gd-tags gd-tags-sm">
                  {DRUM_MACHINES.map((m) => <span key={m}>{m}</span>)}
                  <span className="gd-more">+{DRUM_MACHINES_TOTAL - DRUM_MACHINES.length} más</span>
                </div>
              </Section>

              <Section title="samples · otros">
                <ul className="gd-list">
                  {OTHER_SAMPLES.map((s) => (
                    <li key={s.pack}><b>{s.pack}</b> — {s.desc}<br /><span className="gd-mut">{s.sounds}</span></li>
                  ))}
                </ul>
              </Section>

              <Section title="voz (grabaciones / vocal chops)">
                <p>
                  El grabador crea un source de voz con tres modos: <b>natural</b> (pitch real, por
                  defecto), <b>granular</b> (loopAt+chop, texturas) y <b>melodía / autotune</b> (la voz
                  canta una melodía; con <b>escala</b> los grados se cuantizan a la tonalidad).
                </p>
                <p className="gd-mut">
                  + <code>formante</code> (vocal), <code>room</code>, <code>delay</code>, <code>shape</code>,{' '}
                  <code>speed</code>, <code>pos</code>, <code>spread</code>, <code>gain</code>. El "tono" global transpone la melodía.
                </p>
              </Section>

              <Section title="señales (automatización)">
                <p className="gd-mut">crudas dentro de cualquier parámetro: <code>lpf(sine.range(300,2000).slow(8))</code></p>
                <ul className="gd-list">
                  {SIGNALS.map((s) => <li key={s.id}><code>{s.id}</code> — {s.desc}</li>)}
                </ul>
              </Section>

              <Section title="fx y transforms">
                <p className="gd-mut">fx (arrástralos sobre un cable):</p>
                <div className="gd-tags">{fx.map((o) => <span key={o.id} title={opLine(o)}>{opLine(o)}</span>)}</div>
                <p className="gd-mut">transforms (tiempo / estructura):</p>
                <div className="gd-tags">{transforms.map((o) => <span key={o.id} title={opLine(o)}>{opLine(o)}</span>)}</div>
              </Section>

              <Section title="kits urbanos (paleta · clic para añadir)">
                {URBAN_KITS.map((g) => (
                  <div key={g.genre} className="gd-kit">
                    <span className="gd-mut">{g.genre}:</span>{' '}
                    {g.items.map((it) => it.label).join(' · ')}
                  </div>
                ))}
              </Section>

              <Section title="master y performance">
                <p>
                  Macros del master: <code>gain · filter · room · drive · delay · crush</code>. FX momentáneos
                  (mantén pulsado; <kbd>shift</kbd>+clic = fija): <code>roll ×2/4/8/16 · gate · rev · echo · wash</code>.
                </p>
                <p className="gd-mut">
                  <b>escenas</b> (modo dj): captura/dispara estados con <kbd>1–9</kbd> (⇧ para capturar).
                  <b> solo/mute</b> por canal. <b>sidechain</b> para el pump EBM/reggaetón.
                </p>
              </Section>

              <Section title="mini-notación">
                <ul className="gd-list">
                  {MININOTATION.map((m) => <li key={m.token}><code>{m.token}</code> — {m.desc}</li>)}
                </ul>
              </Section>

              <Section title="tempo · tono · atajos">
                <p>
                  <b>BPM</b> con perilla o tap (<kbd>T</kbd>). <b>/N</b> opcional = tiempos por compás.
                  <b> tono</b> = transpone en semitonos (solo afecta lo que tiene <code>note()</code>).
                </p>
                <p className="gd-mut">
                  <kbd>espacio</kbd> play/stop · <kbd>M</kbd> mute · <kbd>S</kbd> solo · <kbd>esc</kbd> quita solos · <kbd>1–9</kbd> escenas.
                </p>
              </Section>

              <Section title="recetas por género">
                <ul className="gd-list">
                  {RECIPES.map((r) => (
                    <li key={r.genre}><b>{r.genre}</b> <span className="gd-mut">({r.bpm} bpm)</span><br />{r.recipe}</li>
                  ))}
                </ul>
              </Section>

              <Section title="guardar y compartir">
                <p>
                  <b>proyecto ▾</b>: guarda/abre <code>.json</code>, galería, ejemplos, y <b>compartir por URL</b>
                  (genera un enlace corto que carga el patch al abrirlo; los samples locales no viajan).
                </p>
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
