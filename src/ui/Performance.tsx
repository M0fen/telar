import { useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import type { MasterFx } from '../graph/compile';
import { Knob } from './Knob';
import { Fader } from './Fader';
import { Scenes } from './Scenes';
import { SongTimeline } from './SongTimeline';
import { LufsMeter } from './LufsMeter';
import { Vu } from '../nodes/Vu';
import { IR_SPACES, registerIrFiles } from '../audio/irReverb';
import { useIrStore } from '../store/useIrStore';

// Botón de FX MOMENTÁNEO (DJ): aplica mientras lo mantienes pulsado y se quita al
// soltar (aunque sueltes fuera). Con SHIFT+clic se FIJA (latch): queda activo hasta
// que sueltes Shift, dejando el cursor libre para mover otras cosas a la vez.
function HoldFx({ label, title, active, onDown, onUp }: { label: string; title: string; active: boolean; onDown: () => void; onUp: () => void }) {
  const [latched, setLatched] = useState(false);
  const press = (e: React.PointerEvent) => {
    e.preventDefault();
    onDown();
    if (e.shiftKey) {
      // fijado: permanece hasta soltar Shift (cursor libre)
      setLatched(true);
      const onKeyUp = (ke: KeyboardEvent) => {
        if (ke.key === 'Shift') {
          setLatched(false);
          onUp();
          window.removeEventListener('keyup', onKeyUp);
        }
      };
      window.addEventListener('keyup', onKeyUp);
    } else {
      const up = () => {
        onUp();
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointerup', up);
    }
  };
  return (
    <button
      className={`perf-fx${active ? ' on' : ''}${latched ? ' latched' : ''}`}
      title={`${title} · shift+clic = fijar`}
      onPointerDown={press}
      onMouseDown={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

// Fila de FX de performance: loop roll, gate, reverse y throws de eco/reverb.
function PerfFxRow({ master, setMaster }: { master: MasterFx; setMaster: (p: Partial<MasterFx>) => void }) {
  // throws de eco/reverb: recuerdan el valor previo del knob para restaurarlo.
  const prevDelay = useRef(0);
  const prevRoom = useRef(0);
  return (
    <div className="perf-fx-wrap">
      <div className="perf-fx-grp">
        <span className="perf-fx-tag">roll</span>
        {[2, 4, 8, 16].map((n) => (
          <HoldFx key={n} label={`${n}`} title={`loop roll ×${n} (mantén)`} active={master.roll === n} onDown={() => setMaster({ roll: n })} onUp={() => setMaster({ roll: 0 })} />
        ))}
      </div>
      <div className="perf-fx-grp">
        <HoldFx label="gate" title="gate rítmico (mantén)" active={!!master.gate} onDown={() => setMaster({ gate: 8 })} onUp={() => setMaster({ gate: 0 })} />
        <HoldFx label="rev" title="reverse throw (mantén)" active={!!master.rev} onDown={() => setMaster({ rev: true })} onUp={() => setMaster({ rev: false })} />
        <HoldFx label="echo" title="echo throw (mantén)" active={(master.delay ?? 0) > 0.5} onDown={() => { prevDelay.current = master.delay ?? 0; setMaster({ delay: 0.7 }); }} onUp={() => setMaster({ delay: prevDelay.current })} />
        <HoldFx label="wash" title="reverb wash (mantén)" active={(master.room ?? 0) > 0.5} onDown={() => { prevRoom.current = master.room ?? 0; setMaster({ room: 0.7 }); }} onUp={() => setMaster({ room: prevRoom.current })} />
      </div>
    </div>
  );
}

// Capa de performance / máster. En STANDARD solo el máster (gain + filtro + room +
// drive/delay/crush): macros de mezcla en vivo sobre el Out, sin saturar el lienzo.
// En DJ se suma el lanzador de ESCENAS (los canales ya están en la consola DJ).
export function Performance() {
  const master = useGraphStore((s) => s.master);
  const setMaster = useGraphStore((s) => s.setMaster);
  const mode = useGraphStore((s) => s.mode);
  const userIrs = useIrStore((s) => s.userIrs);
  const irInput = useRef<HTMLInputElement | null>(null);
  const [irBusy, setIrBusy] = useState(false);

  // Carga IRs reales (Bricasti M7, OpenAIR, etc.) y selecciona el primero.
  const loadIrs = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setIrBusy(true);
    try {
      const added = await registerIrFiles(files);
      if (added[0]) setMaster({ space: added[0].name, room: Math.max(master.room ?? 0, 0.3) });
    } finally {
      setIrBusy(false);
      if (irInput.current) irInput.current.value = '';
    }
  };

  return (
    <aside className="perf">
      <section className="perf-sec perf-master">
        <h3>master</h3>
        <div className="perf-master-row">
          <div className="perf-fader-cell">
            <div className="perf-meter">
              <Fader value={master.gain} min={0} max={1.5} step={0.01} defaultValue={1} height={92} label="gain maestro" onChange={(v) => setMaster({ gain: v })} />
              <Vu id="master" className="vu-vert" />
            </div>
            <span className="perf-cap">gain</span>
          </div>
          <div className="perf-knobs">
            <div className="perf-cell">
              <Knob value={master.filter} min={-1} max={1} step={0.01} size={40} defaultValue={0} label="filtro DJ" onChange={(v) => setMaster({ filter: v })} />
              <span className="perf-cap">filter</span>
              <span className="perf-sub">lp ◄ ► hp</span>
            </div>
            <div className="perf-cell">
              <Knob value={master.room} min={0} max={0.8} step={0.01} size={40} defaultValue={0} label="reverb send" onChange={(v) => setMaster({ room: v })} />
              <span className="perf-cap">room</span>
              <span className="perf-sub">send</span>
            </div>
            <div className="perf-cell">
              <Knob value={master.drive ?? 0} min={0} max={1} step={0.01} size={40} defaultValue={0} label="drive (saturación)" onChange={(v) => setMaster({ drive: v })} />
              <span className="perf-cap">drive</span>
              <span className="perf-sub">sat</span>
            </div>
            <div className="perf-cell">
              <Knob value={master.delay ?? 0} min={0} max={1} step={0.01} size={40} defaultValue={0} label="delay (eco)" onChange={(v) => setMaster({ delay: v })} />
              <span className="perf-cap">delay</span>
              <span className="perf-sub">echo</span>
            </div>
            <div className="perf-cell">
              <Knob value={master.crush ?? 0} min={0} max={1} step={0.01} size={40} defaultValue={0} label="crush (lo-fi)" onChange={(v) => setMaster({ crush: v })} />
              <span className="perf-cap">crush</span>
              <span className="perf-sub">lo-fi</span>
            </div>
            <div className="perf-cell">
              <Knob value={master.swing ?? 0} min={0} max={0.6} step={0.01} size={40} defaultValue={0} label="swing (groove)" onChange={(v) => setMaster({ swing: v })} />
              <span className="perf-cap">swing</span>
              <span className="perf-sub">groove</span>
            </div>
            <div className="perf-cell">
              <Knob value={master.humanize ?? 0} min={0} max={1} step={0.01} size={40} defaultValue={0} label="humanize (micro-random)" onChange={(v) => setMaster({ humanize: v })} />
              <span className="perf-cap">human</span>
              <span className="perf-sub">feel</span>
            </div>
          </div>
        </div>
        <PerfFxRow master={master} setMaster={setMaster} />
        <div className="perf-space">
          <span className="perf-space-tag">espacio</span>
          <select
            className="perf-space-sel"
            value={master.space ?? ''}
            onChange={(e) => setMaster({ space: e.target.value })}
            title="reverb por IR (convolución): tipo de sala. Sube 'room' para oírlo. Carga tus IRs reales con ＋"
          >
            <option value="">algorítmico</option>
            <optgroup label="espacios (built-in)">
              {IR_SPACES.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
            </optgroup>
            {userIrs.length > 0 && (
              <optgroup label="IRs reales (tuyos)">
                {userIrs.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
              </optgroup>
            )}
          </select>
          <button
            className="perf-space-load"
            title="cargar IRs reales (WAV/AIFF): Bricasti M7, OpenAIR, salas capturadas…"
            disabled={irBusy}
            onClick={() => irInput.current?.click()}
          >{irBusy ? '…' : '＋ IR'}</button>
          <input
            ref={irInput}
            type="file"
            accept=".wav,.aif,.aiff,.flac,.ogg,.mp3,audio/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void loadIrs(e.target.files)}
          />
          <span className="perf-space-hint">{(master.room ?? 0) < 0.02 ? 'sube «room» ▸' : 'IR activo'}</span>
        </div>
        <div className="perf-bus">
          <span className="perf-bus-tag">bus</span>
          <div className="perf-cell">
            <Knob value={master.limit ?? 0} min={0} max={1} step={0.01} size={34} defaultValue={0} label="limiter (evita clipping + loudness)" onChange={(v) => setMaster({ limit: v })} />
            <span className="perf-cap">limiter</span>
          </div>
          <div className="perf-cell">
            <Knob value={master.glue ?? 0} min={0} max={1} step={0.01} size={34} defaultValue={0} label="glue (compresor de bus: pega la mezcla, da cuerpo)" onChange={(v) => setMaster({ glue: v })} />
            <span className="perf-cap">glue</span>
          </div>
          <div className="perf-cell">
            <Knob value={master.sat ?? 0} min={0} max={1} step={0.01} size={34} defaultValue={0} label="saturación (calor analógico, oversampled sin aliasing)" onChange={(v) => setMaster({ sat: v })} />
            <span className="perf-cap">sat</span>
          </div>
          <div className="perf-cell">
            <Knob value={master.width ?? 1} min={0} max={2} step={0.01} size={34} defaultValue={1} label="ancho estéreo Mid-Side (1 normal · 0 mono · 2 ancho)" onChange={(v) => setMaster({ width: v })} />
            <span className="perf-cap">width</span>
          </div>
          <div className="perf-cell">
            <Knob value={master.punch ?? 0} min={-1} max={1} step={0.01} size={34} defaultValue={0} label="punch (transient shaper: + realza el ataque de la batería, − lo suaviza)" onChange={(v) => setMaster({ punch: v })} />
            <span className="perf-cap">punch</span>
          </div>
          <div className="perf-cell">
            <Knob value={master.eqLow ?? 0} min={-12} max={12} step={0.5} size={34} defaultValue={0} label="EQ graves (dB)" onChange={(v) => setMaster({ eqLow: v })} />
            <span className="perf-cap">low</span>
          </div>
          <div className="perf-cell">
            <Knob value={master.eqMid ?? 0} min={-12} max={12} step={0.5} size={34} defaultValue={0} label="EQ medios (dB)" onChange={(v) => setMaster({ eqMid: v })} />
            <span className="perf-cap">mid</span>
          </div>
          <div className="perf-cell">
            <Knob value={master.eqHigh ?? 0} min={-12} max={12} step={0.5} size={34} defaultValue={0} label="EQ agudos (dB)" onChange={(v) => setMaster({ eqHigh: v })} />
            <span className="perf-cap">high</span>
          </div>
        </div>
        <LufsMeter />
      </section>

      {mode === 'dj' && (
        <section className="perf-sec">
          <Scenes />
        </section>
      )}

      <section className="perf-sec">
        <SongTimeline />
      </section>
    </aside>
  );
}
