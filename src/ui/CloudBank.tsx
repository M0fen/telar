import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../store/useGraphStore';
import { useCloudBankStore } from '../store/useCloudBankStore';
import { registerCloudItem, registerCloudBank, cloudProxyUrl, cloudName } from '../lib/cloudBank';
import { playPreview, preloadPreview } from '../audio/previewSample';
import { sampleDuration, sampleSourceCode } from '../lib/audioMeta';
import { hasCloudUnlock, unlockCloud } from '../lib/cloudAuth';

// MI NUBE ☁ — banco propio autohospedado (Cloudflare R2). Panel APARTE del navegador de
// sonidos: aquí gestionas TU bucket (URL base + tus samples). El audio se sirve por el
// proxy /api/sample (la URL r2.dev no aplica CORS). Se guarda en el navegador y se
// re-registra al reproducir → s("nombre") suena desde tu bucket sin arrastrar nada.
export function CloudBank() {
  const [open, setOpen] = useState(false);
  const baseUrl = useCloudBankStore((s) => s.baseUrl);
  const items = useCloudBankStore((s) => s.items);
  const setBaseUrl = useCloudBankStore((s) => s.setBaseUrl);
  const addItem = useCloudBankStore((s) => s.addItem);
  const removeItem = useCloudBankStore((s) => s.removeItem);
  const addPattern = useGraphStore((s) => s.addPattern);
  const cps = useGraphStore((s) => s.cps);

  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // candado por contraseña
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUnlocked(hasCloudUnlock());
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  // registra el banco solo cuando está desbloqueado (si no, el proxy responde 401).
  useEffect(() => {
    if (open && unlocked) void registerCloudBank();
  }, [open, unlocked]);

  const doUnlock = async () => {
    if (pwBusy || !pw.trim()) return;
    setPwBusy(true); setPwErr(null);
    const ok = await unlockCloud(pw.trim());
    setPwBusy(false);
    if (ok) { setUnlocked(true); setPw(''); }
    else setPwErr('contraseña incorrecta');
  };

  const add = async () => {
    const f = file.trim();
    if (busy || !f) return;
    if (!baseUrl.trim()) { setErr('pon primero la URL base de tu bucket'); return; }
    setBusy(true); setErr(null);
    try {
      const nm = await registerCloudItem(baseUrl, f);
      addItem({ name: nm, file: f });
      setFile('');
    } catch {
      setErr('no se pudo registrar — revisa el nombre EXACTO (R2 distingue mayúsculas) y que el bucket sea público');
    } finally {
      setBusy(false);
    }
  };

  // escucha un sample del banco (instantáneo; hasta 6 s para oír loops enteros).
  const preview = (name: string) => void playPreview(name, 0.95, 6);

  // añade al lienzo midiendo la duración real → loops largos entran a su BPM natural
  // (.slow) sin solaparse; one-shots quedan pelados.
  const toCanvas = async (name: string, f: string) => {
    let dur = 0;
    try { dur = await sampleDuration(cloudProxyUrl(baseUrl, f)); } catch { /* usa pelado */ }
    addPattern(sampleSourceCode(name, dur, cps), name);
    setOpen(false);
  };

  return (
    <>
      <button className="sb-open cb-open" onClick={() => setOpen(true)} title="tu banco de samples en la nube (Cloudflare R2)">
        ☁ mi nube{items.length ? ` (${items.length})` : ''}
      </button>
      {open && createPortal(
        <>
          <div className="vs-backdrop" onClick={() => setOpen(false)} />
          <div className="cb-panel">
            <header className="vs-head">
              <span className="vs-title">mi nube ☁</span>
              <button className="vs-x" onClick={() => setOpen(false)} title="cerrar (Esc)">×</button>
            </header>

            {!unlocked ? (
              <div className="cb-lock">
                <p className="cb-intro">🔒 Banco privado. Introduce la contraseña para acceder.</p>
                <div className="cb-add">
                  <input
                    type="password"
                    autoFocus
                    value={pw}
                    placeholder="contraseña"
                    onChange={(e) => setPw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void doUnlock(); }}
                  />
                  <button onClick={() => void doUnlock()} disabled={pwBusy || !pw.trim()}>{pwBusy ? '···' : 'entrar'}</button>
                </div>
                {pwErr && <div className="cb-err">⚠ {pwErr}</div>}
              </div>
            ) : (
            <>
            <p className="cb-intro">Tus samples, autohospedados en tu bucket. Suenan como <code>s("nombre")</code> y se guardan aquí entre sesiones.</p>

            <label className="cb-field">
              <span>URL base del bucket</span>
              <input
                value={baseUrl}
                placeholder="https://pub-….r2.dev"
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>

            <div className="cb-add">
              <input
                value={file}
                placeholder="nombre EXACTO del archivo (ej. phonk-groove-largo1.wav)"
                onChange={(e) => setFile(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              />
              <button onClick={() => void add()} disabled={busy || !file.trim()}>{busy ? '···' : '+ añadir'}</button>
            </div>
            {file.trim() && <div className="cb-preview-name">sonará como <b>s("{cloudName(file)}")</b></div>}
            {err && <div className="cb-err">⚠ {err}</div>}

            <div className="cb-list">
              {items.length === 0 && <div className="cb-empty">aún no has añadido samples. Pega tu URL base y el nombre de un archivo de tu bucket.</div>}
              {items.map((it) => (
                <div className="cb-item" key={it.name} onMouseEnter={() => preloadPreview(it.name)}>
                  <button className="cb-play" onClick={() => preview(it.name)} title="escuchar">▸</button>
                  <span className="cb-name" title={it.file}>{it.name}</span>
                  <button className="cb-to" onClick={() => void toCanvas(it.name, it.file)} title="añadir al lienzo (loops largos entran a su BPM natural)">+ lienzo</button>
                  <button className="cb-del" onClick={() => removeItem(it.name)} title="quitar del banco">×</button>
                </div>
              ))}
            </div>

            <p className="cb-help">
              ¿De dónde saco el nombre? En Cloudflare → tu bucket → pestaña <b>Objects</b>. Cópialo <b>tal cual</b> (R2 distingue mayúsculas; ojo, la extensión suele ir en minúscula <code>.wav</code>).
            </p>
            </>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
