import { useEffect, useRef } from 'react';
import { useRefStore, loadReference, restoreReference, clearReference, setAB, restartReference, mixSpectrumTick } from '../audio/refTrack';
import { BAND_CENTERS, normalizeCurve } from '../lib/refSpectrum';
import { toast } from '../store/useNotifyStore';

// PISTA DE REFERENCIA (Fase 6.3): carga un tema terminado de tu carpeta y compáralo con tu mezcla:
// A = tu mezcla, B = la referencia igualada a tu loudness (también con un pad del MIDI). Debajo,
// las dos curvas tonales con el mismo nivel medio: dónde te sobra o te falta.
const LABELS: [number, string][] = [[60, '60'], [250, '250'], [1000, '1k'], [4000, '4k'], [12000, '12k']];

export function RefTrack() {
  const name = useRefStore((s) => s.name);
  const lufs = useRefStore((s) => s.lufs);
  const spectrum = useRefStore((s) => s.spectrum);
  const ab = useRefStore((s) => s.ab);
  const gainDb = useRefStore((s) => s.gainDb);
  const busy = useRefStore((s) => s.busy);
  const cv = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => { void restoreReference(); }, []);

  // curvas: la de la referencia (fija) y la de tu mezcla (en vivo, ~10 por segundo)
  useEffect(() => {
    if (!name || !spectrum) return;
    let raf = 0;
    let last = 0;
    const ref = normalizeCurve(Float64Array.from(spectrum));
    let mix: Float64Array | null = null;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 100) return;
      last = t;
      const m = mixSpectrumTick();
      if (m) mix = normalizeCurve(Float64Array.from(m));
      const c = cv.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const W = c.width;
      const H = c.height;
      g.clearRect(0, 0, W, H);
      const fx = (f: number) => (Math.log(f / BAND_CENTERS[0]) / Math.log(BAND_CENTERS[BAND_CENTERS.length - 1] / BAND_CENTERS[0])) * W;
      const fy = (db: number) => H / 2 - (Math.max(-24, Math.min(24, db)) / 24) * (H / 2 - 4);
      g.strokeStyle = 'rgba(120,150,165,0.18)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, H / 2);
      g.lineTo(W, H / 2);
      for (const [f] of LABELS) { g.moveTo(fx(f), 0); g.lineTo(fx(f), H); }
      g.stroke();
      g.fillStyle = 'rgba(160,180,190,0.5)';
      g.font = '9px "IBM Plex Mono", monospace';
      for (const [f, l] of LABELS) g.fillText(l, fx(f) + 2, H - 3);
      const line = (d: Float64Array, color: string, w: number) => {
        g.strokeStyle = color;
        g.lineWidth = w;
        g.beginPath();
        d.forEach((v, i) => { const x = fx(BAND_CENTERS[i]); const y = fy(v); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
      };
      line(ref, '#e8a33d', 1.6);
      if (mix) line(mix, '#3df0d0', 1.6);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [name, spectrum]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const ok = await loadReference(f, f.name.replace(/\.[^.]+$/, ''));
    if (ok) toast.ok(`Referencia lista: «${f.name}». B la toca igualada a tu loudness.`);
    else toast.warn('No pude abrir ese archivo como audio (prueba un WAV o MP3).');
  };

  return (
    <div className="ref">
      <div className="ref-head">
        <span className="ref-tag">referencia</span>
        <label className="ref-load" title="un tema terminado de tu carpeta (WAV o MP3) para comparar tu mezcla">
          {busy ? 'analizando…' : name ? 'cambiar' : '⤓ cargar tema'}
          <input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.aac,.ogg" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} />
        </label>
        {name && <span className="ref-name" title={name}>{name}</span>}
        {name && <button className="ref-x" onClick={clearReference} title="quitar la referencia">×</button>}
      </div>
      {name && (
        <>
          <div className="ref-ab">
            <button className={ab === 'A' ? 'on' : ''} onClick={() => void setAB('A')} title="tu mezcla">A · tu mezcla</button>
            <button className={ab === 'B' ? 'on b' : ''} onClick={() => void setAB('B')} title="la referencia, igualada al loudness de tu mezcla (también con un pad: MIDI en vivo → A/B)">B · referencia</button>
            <button className="ref-rw" onClick={restartReference} title="la referencia desde el principio">⟲</button>
          </div>
          <div className="ref-info">
            {lufs != null ? `ref ${lufs.toFixed(1)} LUFS · ${ab === 'B' ? 'suena' : 'sonará'} ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB para igualarla` : 'sin medida de loudness'}
          </div>
          <canvas ref={cv} className="ref-spec" width={480} height={110} />
          <p className="ref-hint"><b className="ref-c-mix">tu mezcla</b> y <b className="ref-c-ref">la referencia</b> con el mismo nivel medio: donde tu curva va por encima, te sobra; por debajo, te falta.</p>
        </>
      )}
    </div>
  );
}
