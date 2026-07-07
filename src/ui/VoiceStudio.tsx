import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useDownloadsStore } from '../store/useDownloadsStore';
import { getAudioCtx, registerSample } from '../audio/engine';
import type { NodeData, VoiceParams } from '../graph/types';
import { DEFAULT_VOICE } from '../graph/types';
import { getVoiceUrl, setVoiceUrl } from '../lib/voiceUrls';
import { audioBufferToWav } from '../lib/wavEncode';
import { playVoiceSample, playVoiceNote, playVoiceMelody } from '../audio/playNote';
import { toast } from '../store/useNotifyStore';
import { clamp01, peaksOf, sliceBuffer, AT_ROOTS, melodyTokenToNote } from './voice/voiceUtils';
import { MelodySection } from './voice/MelodyRoll';
import { VoiceWave } from './voice/VoiceWave';
import { AutotuneSection, type AtState } from './voice/AutotuneSection';
import { CompingSection, type Take } from './voice/CompingSection';
import { PlaybackSection, SoundDesignSection } from './voice/DesignSections';

// Estudio de voz DEDICADO (área propia, sustituye al mini-panel del nodo). Pro:
//   • vista previa REPRODUCIBLE de la onda con cabezal (play/loop, clic = scrub),
//     recorte por manijas (begin/end en vivo) para editar el audio de un vistazo;
//   • PIANO ROLL para acomodar las notas de melodía/autotune (clic = poner nota,
//     arrastrar = dibujar la línea; con escala = autotune por grados);
//   • modos natural/granular, formante y controles finos.
// Edita node.data.voice / begin / end del Source seleccionado.
//
// Este archivo es el SHELL: estado + transporte + lógica async (warp/autotune/comping/
// bake). Las secciones visuales viven en src/ui/voice/* como componentes presentacionales
// y los helpers puros en src/ui/voice/voiceUtils.ts (testeables en Node).

export function VoiceStudio() {
  const voiceEditId = useGraphStore((s) => s.voiceEditId);
  const setVoiceEdit = useGraphStore((s) => s.setVoiceEdit);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === s.voiceEditId));
  const update = useGraphStore((s) => s.updateNodeData);
  const tracks = useDownloadsStore((s) => s.tracks);

  const code = (node?.data as NodeData | undefined)?.code ?? '';
  const name = useMemo(() => {
    const m = /s\(\s*["'`]([^"'`]+)/.exec(code);
    if (!m) return null;
    const tok = /[A-Za-z0-9_]+/.exec(m[1]);
    return tok ? tok[0] : null;
  }, [code]);
  // override local tras un RECORTE destructivo (WAV recortado en objectURL). Tiene
  // prioridad sobre el registro; se resetea al cambiar de voz.
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  // URL del audio de la voz: override local (recorte) → registro propio (voiceUrls,
  // funciona en prod para voz IA y demo) → fallback a downloadsStore (grabaciones dev).
  // De aquí sale la ONDA y el preview — ya NO dependemos de que la voz esté en downloadsStore.
  const audioUrl = useMemo(
    () => localUrl ?? getVoiceUrl(name) ?? tracks.find((t) => t.name === name)?.file ?? null,
    [localUrl, tracks, name],
  );
  useEffect(() => { setLocalUrl(null); }, [name]); // al cambiar de voz, olvida el recorte local

  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [decodeErr, setDecodeErr] = useState<string | null>(null); // fallo al descargar/decodificar
  // preview reproducible
  const bufRef = useRef<AudioBuffer | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef(0);
  const loopRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loopPrev, setLoopPrev] = useState(false);
  const [head, setHead] = useState<number | null>(null); // cabezal (fracción 0..1)
  const [live, setLive] = useState(true); // audición en vivo: oye cada ajuste al instante
  const auditionTimer = useRef(0);
  useEffect(() => () => clearTimeout(auditionTimer.current), []);
  // B1 — warp Rubber Band (offline): reproductor + estado + diagnóstico + semitonos propios
  const warpSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const bakedUrlRef = useRef<string | null>(null); // objectURL del último bake, para revocar el anterior (anti-leak)
  const [warpBusy, setWarpBusy] = useState(false);
  const [warpMsg, setWarpMsg] = useState('');
  const [warpSemi, setWarpSemi] = useState(5); // control de afinado propio del warp (autónomo)
  // preview EN CONTEXTO: aísla el source y reproduce el patrón compilado REAL (tempo,
  // granular, vibrato, recorte… todo lo que un disparo estático no puede mostrar).
  const [ctxPreview, setCtxPreview] = useState(false);
  // B2 — autotune real (corrección de tono): escala/raíz/velocidad de retune + B5 gate.
  const [at, setAt] = useState<AtState>({ root: 0, scale: 'menor', speed: 0, gate: 0.4, deEss: 0.4 });
  const [atBusy, setAtBusy] = useState(false);
  // B4 — comping: varias tomas + qué toma suena en cada tramo
  const [takes, setTakes] = useState<Take[]>([]);
  const [nSeg, setNSeg] = useState(4);
  const [selection, setSelection] = useState<number[]>([0, 0, 0, 0]);
  const [recording, setRecording] = useState(false);
  const takeRecRef = useRef<{ rec: MediaRecorder; stream: MediaStream } | null>(null);

  // decodifica el audio → ~360 picos para el trazo + guarda el buffer para el preview
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    setDecodeErr(null);
    bufRef.current = null;
    if (!audioUrl) return;
    (async () => {
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw new Error(`no se pudo descargar el audio (HTTP ${res.status})`);
        const ab = await res.arrayBuffer();
        const buf = await getAudioCtx().decodeAudioData(ab);
        if (!alive) return;
        bufRef.current = buf;
        const p = peaksOf(buf, 360);
        if (alive) { setPeaks(p); setHead(bufRef.current ? (node?.data.begin ?? 0) : null); }
      } catch (err) {
        if (alive) { setPeaks(null); setDecodeErr(err instanceof Error ? err.message : 'no se pudo cargar el audio'); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // asegura que la voz esté registrada como sample del motor (s(name)) para que la
  // audición CON FX (piano roll / escucha viva) suene aunque no se haya reproducido el
  // grafo. Idempotente. Sin esto, una voz recién descargada tenía onda pero no audición.
  useEffect(() => {
    if (name && audioUrl) void registerSample(name, audioUrl).catch(() => {});
  }, [name, audioUrl]);

  const stopPreview = () => {
    if (srcRef.current) { try { srcRef.current.onended = null; srcRef.current.stop(); } catch { /* ya parado */ } srcRef.current = null; }
    if (warpSrcRef.current) { try { warpSrcRef.current.stop(); } catch { /* ya parado */ } warpSrcRef.current = null; }
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  };
  // B1 — precarga el WASM de Rubber Band al haber audio, para que el 1er warp no espere.
  useEffect(() => {
    if (audioUrl) void import('../audio/rubberband').then((m) => m.preloadRubberband()).catch(() => {});
  }, [audioUrl]);
  // B4 — detener la grabación de tomas y soltar el micrófono al desmontar el estudio.
  useEffect(() => () => { try { takeRecRef.current?.rec.stop(); takeRecRef.current?.stream.getTracks().forEach((t) => t.stop()); } catch { /* ya parado */ } }, []);
  // detener el preview al cerrar / cambiar de voz
  useEffect(() => stopPreview, [voiceEditId]);
  useEffect(() => { loopRef.current = loopPrev; }, [loopPrev]);

  const playPreview = (from?: number) => {
    const buf = bufRef.current;
    if (!buf) { setWarpMsg(decodeErr ? `⚠ ${decodeErr}` : '⚠ aún no hay audio decodificado para reproducir.'); return; }
    stopPreview();
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    // valores en vivo del nodo (recorte/velocidad/gain pueden haber cambiado)
    const d = useGraphStore.getState().nodes.find((n) => n.id === voiceEditId)?.data as NodeData | undefined;
    const b = clamp01(d?.begin ?? 0);
    const e = Math.max(b + 0.01, clamp01(d?.end ?? 1));
    const speed = Number(d?.voice?.speed ?? 1) || 1;
    // ▶ es el preview CRUDO (sin efectos) → NO aplica la ganancia de FX. Así el slider
    // «gain» en 0 no deja el preview en silencio (era la trampa: bajar gain enmudecía
    // ▶ y «con FX» a la vez). «con FX» sí respeta gain (es con efectos).
    const gain = 1;
    const dur = buf.duration;
    const start = Math.min(Math.max(from ?? b, b), e);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ctx.destination);
    const offsetSec = start * dur;
    const playSec = Math.max(0.02, e * dur - offsetSec);
    try { src.start(0, offsetSec, playSec); } catch { return; }
    srcRef.current = src;
    setPlaying(true);
    const t0 = ctx.currentTime;
    const tick = () => {
      const frac = start + ((ctx.currentTime - t0) * speed) / dur;
      if (frac >= e) {
        if (loopRef.current) { playPreview(b); return; }
        setHead(e); stopPreview(); return;
      }
      setHead(frac);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // preview en contexto: aísla (solo) este source y arranca el transporte → suena la voz
  // por el patrón compilado real (tempo/granular/vibrato/recorte). El disparo estático no
  // puede mostrar loopAt/chop. Al desactivar, quita el aislado.
  const toggleCtxPreview = () => {
    if (!voiceEditId) return;
    const s = useGraphStore.getState();
    const next = !ctxPreview;
    setCtxPreview(next);
    stopPreview();
    s.updateNodeData(voiceEditId, { solo: next });
    if (next && !s.playing) void s.play();
  };
  // al cerrar / cambiar de voz, retira el aislado del preview en contexto.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => () => { if (ctxPreview && voiceEditId) useGraphStore.getState().updateNodeData(voiceEditId, { solo: false }); }, [voiceEditId, ctxPreview]);

  if (!voiceEditId || !node) return null;
  const data = node.data as NodeData;
  const v: VoiceParams = { ...DEFAULT_VOICE, ...(data.voice ?? {}) };
  const melodic = !!(v.melody ?? '').trim();
  const b = data.begin ?? 0;
  const e = data.end ?? 1;
  // set con AUDICIÓN EN VIVO: al cambiar un control, oyes el resultado procesado (con
  // sus FX) al instante — un fragmento corto desde el recorte, sin esperar el ciclo. Es
  // lo que hace que editar la voz se sienta orgánico. Debounce para no solapar al arrastrar.
  const set = (patch: Partial<VoiceParams>) => {
    const nv: VoiceParams = { ...v, ...patch };
    update(voiceEditId, { voice: nv });
    // La audición (playVoiceSample) es un DISPARO ESTÁTICO del recorte con FX: refleja
    // afinar/room/delay/shape/vowel/pulir/vibrato/speed/gain. NO puede reflejar cosas
    // que dependen del patrón/tiempo o de varias notas → para esas NO re-disparamos una
    // preview idéntica (confundía: "se repite sin cambio"). Se oyen al reproducir el grafo.
    const noPreview = ['melody', 'scale', 'harmony', 'glide', 'spread', 'granular', 'grain', 'tempo', 'tempoCycles', 'loop']
      .some((k) => k in patch);
    if (live && name && !noPreview) {
      clearTimeout(auditionTimer.current);
      auditionTimer.current = window.setTimeout(() => {
        const dur = bufRef.current?.duration ?? 3;
        const endSnip = Math.min(e, b + Math.max(0.3, 1.9 / dur)); // ~1.9s audibles
        void playVoiceSample(name, nv, b, endSnip, 2.2);
      }, 220);
    }
  };

  // audición del piano roll: suena la voz PROCESADA (con sus FX) a una nota concreta,
  // por el MISMO motor que produce el resultado final → el preview es idéntico a lo que
  // se oirá. `force` = pulsar la tecla (siempre suena, para probar); sin force respeta
  // el toggle «escucha viva». Fragmento corto desde el recorte para respuesta inmediata.
  const audition = (note: string, force = false) => {
    if (!name || (!force && !live)) return;
    const d = useGraphStore.getState().nodes.find((n) => n.id === voiceEditId)?.data as NodeData | undefined;
    const vv: VoiceParams = { ...DEFAULT_VOICE, ...(d?.voice ?? {}) };
    const bb = clamp01(d?.begin ?? 0);
    const dur = bufRef.current?.duration ?? 3;
    const ee = Math.min(Math.max(bb + 0.02, clamp01(d?.end ?? 1)), bb + Math.max(0.35, 1.6 / dur));
    void playVoiceNote(name, vv, note, bb, ee, 1.5);
  };
  // ▶ MELODÍA: reproduce la melodía COMPLETA del sampler (la voz cantándola) como preview
  // aislado — no toca el transporte. Abarca 1 ciclo al tempo del proyecto.
  const playMelody = () => {
    if (!name) { setWarpMsg('⚠ esta voz no tiene un sample s("…") reconocible → no se puede oír.'); return; }
    const toks = (v.melody ?? '').trim() ? (v.melody ?? '').trim().split(/\s+/) : [];
    if (!toks.length) { setWarpMsg('⚠ no hay melodía pintada todavía.'); return; }
    const notes = toks.map((t) => melodyTokenToNote(t, v.scale ?? ''));
    const cps = useGraphStore.getState().cps || 0.5;
    const stepSec = Math.max(0.12, 1 / cps / toks.length); // la melodía abarca 1 ciclo
    setWarpMsg('▶ melodía (preview) · se guarda sola en el proyecto');
    void playVoiceMelody(name, v, notes, stepSec, Math.min(stepSec * 1.05, 0.7), b, e);
  };
  // «con FX»: audiciona con efectos, PERO antes detecta las causas comunes de silencio y
  // avisa (en vez de sonar mudo sin explicación): sin sample, gain en 0, o «pos» empujando
  // el inicio más allá del recorte.
  const playFx = () => {
    if (!name) { setWarpMsg('⚠ esta voz no tiene un sample s("…") reconocible → no se puede oír con FX.'); toast.warn('Esta voz no tiene un sample editable (s("…")).'); return; }
    if (Number(v.gain ?? 1) < 0.001) { setWarpMsg('⚠ «gain» (diseño de sonido → carácter) está en 0 → sin sonido. Súbelo o pulsa «restablecer».'); return; }
    const pos = clamp01(Number(v.position ?? 0));
    if (pos >= Math.max(0, e) - 0.004) { setWarpMsg('⚠ «pos» está tan a la derecha que no queda región para sonar. Bájalo.'); return; }
    setWarpMsg('');
    void playVoiceSample(name, v, b, e, bufRef.current?.duration ?? 6);
  };
  // reproduce un AudioBuffer arbitrario (el resultado del warp) directo a la salida.
  const playAudioBuffer = (buf: AudioBuffer) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    if (warpSrcRef.current) { try { warpSrcRef.current.stop(); } catch { /* ya parado */ } }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Number(v.gain ?? 1);
    src.connect(g).connect(ctx.destination);
    try { src.start(); } catch { /* noop */ }
    warpSrcRef.current = src;
  };
  // B1 — prueba del warp Rubber Band: afina el fragmento recortado por «afinar» semitonos
  // SIN cambiar la duración (formantes preservados) y lo reproduce. A/B contra «con FX»
  // (que usa el .stretch crudo del motor) para oír la diferencia de calidad.
  const warpTest = async () => {
    const buf = bufRef.current;
    if (!buf || warpBusy) return;
    const semi = warpSemi;
    if (Math.abs(semi) < 0.001) { setWarpMsg('pon los semitonos ≠ 0 (usa −/+ al lado del botón).'); return; }
    setWarpBusy(true);
    setWarpMsg('warpeando…');
    try {
      const { warpVoz } = await import('../audio/voiceDsp'); // worker + R3: no congela la UI
      const region = sliceBuffer(buf, b, e);
      const warped = await warpVoz(region, { semitones: semi, timeRatio: 1, formant: true });
      // warpBuffer devuelve el MISMO buffer si no procesó (no-op o fallo del WASM).
      if (warped === region) setWarpMsg('⚠ el WASM no procesó (¿no cargó?) — abre la consola (F12) y busca [rubberband]');
      else setWarpMsg(`✓ warp OK · ${semi > 0 ? '+' : ''}${semi} semis · ${(warped.length / warped.sampleRate).toFixed(2)}s (misma duración)`);
      playAudioBuffer(warped);
    } catch (err) {
      { const m = err instanceof Error ? err.message : String(err); setWarpMsg('✗ error: ' + m); toast.err('Warp RB: ' + m); }
    } finally {
      setWarpBusy(false);
    }
  };
  // RECORTE DESTRUCTIVO: corta físicamente la grabación a la región [begin,end], descarta
  // el resto y la re-registra como el sample de esta voz (grafo + estudio la usan ya
  // recortada). Resetea el recorte. Así al-tempo/loop usan solo el audio útil.
  const emsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  // "Hornea" un buffer procesado como el sample de esta voz: lo registra en el motor y en
  // el estudio, y REVOCA el objectURL del bake anterior (anti-leak: antes se acumulaban).
  const bakeBuffer = async (buf: AudioBuffer) => {
    if (!name || !voiceEditId) return;
    const url = URL.createObjectURL(audioBufferToWav(buf));
    await registerSample(name, url); // el grafo/superdough usan el resultado
    setVoiceUrl(name, url); // registro de voz (onda/preview)
    bufRef.current = buf;
    if (bakedUrlRef.current) { try { URL.revokeObjectURL(bakedUrlRef.current); } catch { /* noop */ } }
    bakedUrlRef.current = url; // el anterior ya no lo referencia nadie → revocado
    setLocalUrl(url); // fuerza re-decodificar/redibujar
    update(voiceEditId, { begin: 0, end: 1 });
    setHead(0);
  };
  const cropDestructive = async () => {
    const buf = bufRef.current;
    if (!buf || !name || !voiceEditId || atBusy) return;
    if (b < 0.001 && e > 0.999) { setWarpMsg('no hay nada que recortar (mueve las manijas de la onda primero).'); return; }
    setAtBusy(true);
    try {
      const region = sliceBuffer(buf, b, e);
      await bakeBuffer(region);
      setWarpMsg(`✂ recortado a ${(region.length / region.sampleRate).toFixed(2)}s (espacio no usado eliminado).`);
    } catch (err) {
      const m = emsg(err); setWarpMsg('✗ no se pudo recortar: ' + m); toast.err('Recorte: ' + m);
    } finally {
      setAtBusy(false);
    }
  };
  // B2 — AUTOTUNE REAL: corrige el tono de la toma (región recortada) hacia la escala.
  // `bake` = hornear en el sample (destructivo, suena corregido en todo el proyecto);
  // sin bake = solo previsualiza el resultado (A/B de escala/velocidad sin comprometer).
  const runAutotune = async (bake: boolean) => {
    const buf = bufRef.current;
    if (!buf || atBusy) return;
    setAtBusy(true);
    setWarpMsg(bake ? 'aplicando autotune…' : 'corrigiendo (previa)…');
    try {
      const { autotuneVoz } = await import('../audio/voiceDsp'); // worker + R3: tomas largas sin congelar
      const region = sliceBuffer(buf, b, e);
      const corrected = await autotuneVoz(region, { scale: at.scale, root: at.root, retuneSpeed: at.speed, strength: 1, formant: true });
      if (corrected === region) { setWarpMsg('⚠ autotune no procesó (¿voz muy corta o WASM no cargó?) — consola F12'); playAudioBuffer(region); return; }
      playAudioBuffer(corrected);
      if (bake && name && voiceEditId) {
        await bakeBuffer(corrected);
        setWarpMsg(`✓ tono corregido y aplicado · ${AT_ROOTS[at.root]} ${at.scale} · ${at.speed < 0.1 ? 'duro' : at.speed > 0.6 ? 'natural' : 'medio'}`);
      } else {
        setWarpMsg(`▶ previa de autotune · ${AT_ROOTS[at.root]} ${at.scale} · ${at.speed < 0.1 ? 'duro' : at.speed > 0.6 ? 'natural' : 'medio'} (pulsa «aplicar» para hornear)`);
      }
    } catch (err) {
      const m = emsg(err); setWarpMsg('✗ error de autotune: ' + m); toast.err('Autotune: ' + m);
    } finally {
      setAtBusy(false);
    }
  };
  // B5 — LIMPIAR: aplica el noise gate a la toma (región) y lo hornea en el sample.
  const applyClean = async () => {
    const buf = bufRef.current;
    if (!buf || !name || !voiceEditId || atBusy) return;
    setAtBusy(true);
    setWarpMsg('limpiando…');
    try {
      const { cleanVoice } = await import('../audio/voiceClean');
      const region = sliceBuffer(buf, b, e);
      const cleaned = cleanVoice(region, { gate: at.gate, deEss: at.deEss });
      await bakeBuffer(cleaned);
      playAudioBuffer(cleaned);
      setWarpMsg('✓ voz limpiada (ruido de fondo silenciado).');
    } catch (err) {
      const m = emsg(err); setWarpMsg('✗ error al limpiar: ' + m); toast.err('Limpiar: ' + m);
    } finally {
      setAtBusy(false);
    }
  };
  // PREVISUALIZAR la limpieza (gate + de-esser) SIN hornear → así puedes DIALAR el de-ess/ruido
  // y oírlo, iterando sin destruir la toma. («limpiar» sí hornea, e irreversible: re-aplicarlo
  // sobre una voz YA limpia no hace nada — por eso hace falta este preview para ajustar.)
  const previewClean = async () => {
    const buf = bufRef.current;
    if (!buf || atBusy) return;
    setAtBusy(true);
    setWarpMsg('probando limpieza…');
    try {
      const { cleanVoice } = await import('../audio/voiceClean');
      playAudioBuffer(cleanVoice(sliceBuffer(buf, b, e), { gate: at.gate, deEss: at.deEss }));
      setWarpMsg('▶ previsualización (sin hornear) · «limpiar» lo aplica de verdad.');
    } catch (err) {
      const m = emsg(err); setWarpMsg('✗ error al probar: ' + m);
    } finally {
      setAtBusy(false);
    }
  };

  // B4 — COMPING: grabar tomas (mic), elegir por tramo, componer la final.
  const startTakeRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        try {
          stream.getTracks().forEach((t) => t.stop());
          const ab = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
          const buf = await getAudioCtx().decodeAudioData(ab);
          setTakes((ts) => [...ts, { id: Date.now(), buf, peaks: peaksOf(buf) }]);
          toast.ok('toma grabada');
        } catch (err) { toast.err('No se pudo procesar la toma: ' + emsg(err)); }
      };
      rec.start();
      takeRecRef.current = { rec, stream };
      setRecording(true);
    } catch (err) {
      toast.err('Micrófono no disponible: ' + emsg(err));
    }
  };
  const stopTakeRec = () => { try { takeRecRef.current?.rec.stop(); } catch { /* ya parado */ } setRecording(false); };
  const pickSeg = (seg: number, takeIdx: number) => setSelection((sel) => sel.map((v, i) => (i === seg ? takeIdx : v)));
  const changeNSeg = (n: number) => {
    const c = Math.max(1, Math.min(12, n));
    setNSeg(c);
    setSelection((sel) => { const s = sel.slice(0, c); while (s.length < c) s.push(0); return s; });
  };
  const removeTake = (recIdx: number) => {
    const ci = recIdx + 1; // índice combinado (0 = voz actual)
    setTakes((ts) => ts.filter((_, i) => i !== recIdx));
    setSelection((sel) => sel.map((v) => (v === ci ? 0 : v > ci ? v - 1 : v)));
  };
  const composeTakes = async () => {
    if (!bufRef.current || !name || !voiceEditId || atBusy) { if (!bufRef.current) toast.warn('No hay voz base para componer.'); return; }
    const bufs = [bufRef.current, ...takes.map((t) => t.buf)];
    const sel = selection.map((v) => Math.max(0, Math.min(bufs.length - 1, v)));
    setAtBusy(true);
    setWarpMsg('componiendo…');
    try {
      const { compTakes } = await import('../audio/compTakes');
      const comp = compTakes(bufs, sel, 0.008);
      await bakeBuffer(comp);
      setTakes([]);
      setSelection(Array(nSeg).fill(0));
      playAudioBuffer(comp);
      setWarpMsg('✓ comping aplicado (toma final compuesta por tramos).');
      toast.ok('Comping aplicado.');
    } catch (err) {
      const m = emsg(err); setWarpMsg('✗ comping: ' + m); toast.err('Comping: ' + m);
    } finally {
      setAtBusy(false);
    }
  };

  return (
    <>
      <div className="vs-backdrop" onClick={() => setVoiceEdit(null)} />
      <div className="vs-panel">
        <header className="vs-head">
          <input
            className="vs-name"
            value={data.name ?? ''}
            placeholder="voz…"
            onChange={(ev) => update(voiceEditId, { name: ev.target.value })}
          />
          <span className="vs-title">estudio de voz</span>
          <button
            className={`vs-live${live ? ' on' : ''}`}
            onClick={() => setLive((x) => !x)}
            title="escucha viva: al mover cualquier control, oyes el resultado al instante (con sus efectos)"
          >{live ? '◉ escucha viva' : '○ escucha viva'}</button>
          <button
            className="vs-reset"
            onClick={() => { update(voiceEditId, { voice: { ...DEFAULT_VOICE }, begin: undefined, end: undefined }); setHead(0); stopPreview(); }}
            title="restablecer la voz a valores por defecto (melodía, recorte y controles)"
          >restablecer</button>
          <button className="vs-x" onClick={() => setVoiceEdit(null)} title="cerrar">×</button>
        </header>

        {/* onda grande + preview reproducible + recorte por manijas */}
        <VoiceWave
          audioUrl={audioUrl}
          decodeErr={decodeErr}
          peaks={peaks}
          b={b}
          e={e}
          head={head}
          onScrub={(f) => { if (bufRef.current) setHead(f); }}
          onBegin={(f) => update(voiceEditId, { begin: Math.min(f, (data.end ?? 1) - 0.02) })}
          onEnd={(f) => update(voiceEditId, { end: Math.max(f, (data.begin ?? 0) + 0.02) })}
        />
        {audioUrl && (
          <div className="vs-wave-foot">
            <div className="vs-transport">
              <button
                className={`vs-play${playing ? ' on' : ''}`}
                onClick={() => (playing ? stopPreview() : playPreview(head ?? b))}
                title={playing ? 'detener' : 'reproducir la región recortada (crudo, sin efectos)'}
              >{playing ? '■' : '▶'}</button>
              <button
                className={`vs-loopbtn${loopPrev ? ' on' : ''}`}
                onClick={() => setLoopPrev((x) => !x)}
                title="repetir el preview en bucle"
              >⟳</button>
              <button
                className="vs-fxbtn"
                onClick={playFx}
                title="escuchar la voz CON sus efectos (formante, espacio, afinar, pulir) — disparo estático, al instante. NO muestra al-tempo/granular/melodía (eso es del patrón)."
              >◈ con FX</button>
              <button
                className={`vs-fxbtn${ctxPreview ? ' on' : ''}`}
                onClick={toggleCtxPreview}
                title="reproducir la voz EN CONTEXTO: aísla este source y suena por el patrón real, al tempo de la canción. Es lo ÚNICO que muestra «al tempo», «granular», melodía y el recorte aplicados. Vuelve a pulsar para parar."
              >{ctxPreview ? '◎ parar' : '◎ en el tempo'}</button>
              <span className="vs-warpgrp" title="B1 · warp Rubber Band (alta calidad): afina el recorte estos semitonos SIN cambiar la duración y preservando formantes (voz natural, no ardilla). Autónomo: no depende de otros controles. Compara con «con FX».">
                <button className="vs-warpstep" onClick={() => setWarpSemi((s) => Math.max(-12, s - 1))} title="menos semitonos">−</button>
                <b className="vs-warpsemi">{warpSemi > 0 ? '+' : ''}{warpSemi}</b>
                <button className="vs-warpstep" onClick={() => setWarpSemi((s) => Math.min(12, s + 1))} title="más semitonos">+</button>
                <button
                  className={`vs-fxbtn${warpBusy ? ' on' : ''}`}
                  disabled={warpBusy}
                  onClick={() => void warpTest()}
                >{warpBusy ? '⋯ warp' : '◆ warp RB'}</button>
              </span>
              <span className="vs-region">recorte {(b * 100).toFixed(0)}%–{(e * 100).toFixed(0)}%</span>
            </div>
            <span className="vs-trim-actions">
              <button className="vs-crop" onClick={() => void cropDestructive()} title="RECORTAR de verdad: corta la grabación a la región elegida, descarta el resto y la deja como nuevo audio (limpia el espacio no usado). Irreversible en la sesión.">✂ recortar</button>
              <button onClick={() => { update(voiceEditId, { begin: 0, end: 1 }); setHead(0); }}>reset recorte</button>
            </span>
          </div>
        )}
        {audioUrl && warpMsg && (
          <div className="vs-warpmsg" title="resultado del warp Rubber Band (B1)">{warpMsg}</div>
        )}

        {/* melodía con piano roll (SAMPLER: re-dispara la voz por notas — no corrige el tono) */}
        <MelodySection v={v} melodic={melodic} set={set} audition={audition} onPlayMelody={playMelody} />

        {/* B2 — AUTOTUNE REAL: corrige el tono de la toma grabada (tus palabras, tu tiempo) */}
        {audioUrl && (
          <AutotuneSection
            at={at}
            busy={atBusy}
            onAt={(patch) => setAt((x) => ({ ...x, ...patch }))}
            onRun={(bake) => void runAutotune(bake)}
            onClean={() => void applyClean()}
            onCleanPreview={() => void previewClean()}
          />
        )}

        {/* B4 — COMPING: graba varias tomas y arma la mejor eligiendo por tramos */}
        {audioUrl && (
          <CompingSection
            baseBuf={bufRef.current}
            basePeaks={peaks}
            takes={takes}
            nSeg={nSeg}
            selection={selection}
            recording={recording}
            onRec={() => void startTakeRec()}
            onStopRec={stopTakeRec}
            onNSeg={changeNSeg}
            onPick={pickSeg}
            onRemoveTake={removeTake}
            onCompose={() => void composeTakes()}
          />
        )}

        {/* modo de reproducción + formante */}
        <PlaybackSection v={v} melodic={melodic} set={set} />

        {/* diseño de sonido — agrupado por función para una edición coherente */}
        <SoundDesignSection v={v} melodic={melodic} set={set} />
      </div>
    </>
  );
}
