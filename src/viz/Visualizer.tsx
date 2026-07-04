import { useEffect, useRef, useState } from 'react';
import { getMasterAnalyser, getAudioCtx, getMasterOutputNode } from '../audio/engine';
import { useGraphStore } from '../store/useGraphStore';
import { renderNodeField, resetNodeField } from './nodeField';
import { tokens } from '../theme/tokens';

// Visualizador WebGL2 multi-modo. Lee del AnalyserNode máster en
// requestAnimationFrame, desacoplado del hilo de audio. (master-prompt §1,§5,§7)
// Modos shader 0..N-1 (máster) + 'nodos' (campo por-source, Canvas2D) + milkdrop.
export const VIZ_MODES = ['scope', 'bars', 'radial', 'aurora', 'vector', 'mirror', 'tunnel', 'nodos', 'milkdrop'] as const;
const MILKDROP = VIZ_MODES.length - 1;
const NODOS = VIZ_MODES.indexOf('nodos');
const AUTO_MS = 16000; // cambia de preset cada 16s, como los visuales de Windows

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_res;
uniform sampler2D u_wave;   // R: muestra de onda [0,1] (centro 0.5)
uniform sampler2D u_fft;    // R: magnitud [0,1]
uniform float u_time;
uniform int u_mode;

const float PI = 3.14159265;
vec3 ACCENT  = vec3(0.239, 0.941, 0.816); // cyan
vec3 ACCENT2 = vec3(0.45, 0.78, 1.0);     // azul
vec3 VIOLET  = vec3(0.62, 0.36, 1.0);

float fftAt(float x){ return texture(u_fft, vec2(x, 0.5)).r; }
float waveAt(float x){ return texture(u_wave, vec2(x, 0.5)).r; }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 col = vec3(0.018, 0.024, 0.031);

  if (u_mode == 0) {
    // --- SCOPE + SPECTRUM (osciloscopio de laboratorio) ---
    vec2 g = abs(fract(uv * vec2(16.0, 8.0)) - 0.5);
    float grid = smoothstep(0.48, 0.5, max(g.x, g.y));
    col += vec3(0.03, 0.05, 0.06) * grid * 0.35;
    if (abs(uv.y - 0.75) < 0.0012) col += vec3(0.05);
    if (uv.y < 0.5) {
      float mag = fftAt(pow(uv.x, 1.4));
      float h = mag * 0.48;
      float bar = smoothstep(h, h - 0.006, uv.y);
      float glow = exp(-abs(uv.y - h) * 36.0) * mag;
      col += ACCENT2 * (bar * 0.35 + glow * 0.9);
    }
    float s = waveAt(uv.x);
    float y = 0.75 + (s - 0.5) * 0.42;
    float d = abs(uv.y - y);
    col += ACCENT * (smoothstep(0.006, 0.0, d) + exp(-d * 70.0) * 0.6);

  } else if (u_mode == 1) {
    // --- BARS (espectro en barras con brillo glossy) ---
    float bins = 56.0;
    float idx = floor(uv.x * bins);
    float mag = fftAt(pow((idx + 0.5) / bins, 1.3));
    float gap = smoothstep(0.06, 0.12, fract(uv.x * bins)) * smoothstep(0.94, 0.88, fract(uv.x * bins));
    float bar = smoothstep(mag, mag - 0.004, uv.y) * gap;
    vec3 grad = mix(ACCENT, VIOLET, uv.y / max(mag, 0.001));
    col += grad * bar * (0.35 + 0.65 * mag);
    float cap = exp(-abs(uv.y - mag) * 60.0) * gap;
    col += vec3(1.0) * cap * 0.5;

  } else if (u_mode == 2) {
    // --- RADIAL (espectro circular + scope interior) ---
    vec2 p = uv - 0.5; p.x *= u_res.x / u_res.y;
    float ang = atan(p.y, p.x) / (2.0 * PI) + 0.5;
    float rad = length(p);
    float mag = fftAt(abs(ang * 2.0 - 1.0));
    float ring = 0.16 + mag * 0.26;
    col += ACCENT * exp(-abs(rad - ring) * 42.0) * (0.5 + mag);
    col += VIOLET * exp(-abs(rad - ring) * 14.0) * mag * 0.4;
    float s = waveAt(ang);
    float sr = 0.12 + (s - 0.5) * 0.14;
    col += ACCENT2 * exp(-abs(rad - sr) * 60.0) * 0.7;

  } else if (u_mode == 3) {
    // --- AURORA (cortinas boreales suaves, reactivas) ---
    float bass = fftAt(0.04), mid = fftAt(0.3), high = fftAt(0.7);
    // cielo de fondo: degradado frío de arriba (violeta) a abajo (cian profundo)
    col += mix(vec3(0.015,0.02,0.03), VIOLET*0.05, smoothstep(0.0,1.0,uv.y));
    vec3 aur = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float spd = 0.18 + fi * 0.16;
      float amp = 0.085 + fi * 0.02;
      // línea base ondulante: suma de senos = flujo orgánico (no rígido)
      float base = 0.46 + fi * 0.08
        + sin(uv.x * (2.0 + fi) + u_time * spd) * amp
        + sin(uv.x * (5.0 + fi * 2.0) - u_time * spd * 1.7 + bass * 2.5) * amp * 0.5;
      float react = i == 0 ? bass : (i == 1 ? mid : high);
      float width = 0.085 + react * 0.16;        // la cortina se ensancha con el audio
      float d = (uv.y - base) / width;
      float curtain = exp(-d * d);                // gaussiana suave (sin bordes duros)
      // estrías verticales muy tenues dentro de la cortina (textura de aurora)
      curtain *= 0.85 + 0.15 * sin(uv.x * 90.0 + u_time * 1.5 + fi);
      vec3 cc = mix(ACCENT, VIOLET, clamp(fi * 0.45 + (uv.y - base) * 0.8, 0.0, 1.0));
      cc = mix(cc, ACCENT2, react * 0.3);
      aur += cc * curtain * (0.5 + react * 1.2);
    }
    col += aur;
    col += ACCENT * 0.025 * smoothstep(1.0, 0.35, uv.y); // resplandor del horizonte
    col *= 1.0 + 0.2 * bass;                              // pulso sutil con el bombo

  } else if (u_mode == 4) {
    // --- VECTOR (vectorscopio/lissajous: x = onda, y = onda desfasada) ---
    vec2 q = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
    if (abs(q.x) < 0.0012 || abs(q.y) < 0.0012) col += vec3(0.03, 0.05, 0.06);
    float best = 1.0;
    for (int i = 0; i < 110; i++) {
      float t = float(i) / 110.0;
      vec2 p = vec2(waveAt(t) - 0.5, waveAt(fract(t + 0.07)) - 0.5) * 1.5;
      best = min(best, length(q - p));
    }
    col += ACCENT * exp(-best * best * 1400.0);
    col += ACCENT2 * exp(-best * 90.0) * 0.25;

  } else if (u_mode == 5) {
    // --- MIRROR (espectro simétrico tipo mariposa) ---
    float x = abs(uv.x * 2.0 - 1.0);
    float yy = abs(uv.y * 2.0 - 1.0);
    float bins = 48.0;
    float idx = floor(x * bins);
    float mag = fftAt(pow((idx + 0.5) / bins, 1.25));
    float bar = smoothstep(mag, mag - 0.012, yy);
    float gap = smoothstep(0.05, 0.12, fract(x * bins));
    vec3 grad = mix(ACCENT, VIOLET, x);
    col += grad * bar * gap * (0.4 + 0.6 * mag);
    col += vec3(1.0) * exp(-abs(yy - mag) * 50.0) * gap * 0.4;

  } else {
    // --- TUNNEL (túnel plasma reactivo al bombo) ---
    vec2 p = uv - 0.5; p.x *= u_res.x / u_res.y;
    float r = length(p);
    float a = atan(p.y, p.x);
    float bass = fftAt(0.04), mid = fftAt(0.3);
    float depth = 0.3 / (r + 0.06) + u_time * 0.7 + bass * 2.2;
    float spokes = sin(a * 8.0 + u_time * 1.3);
    float v = 0.5 + 0.5 * sin(depth * 6.2831 + spokes * 1.4);
    vec3 c = mix(ACCENT * 0.15, ACCENT, v);
    c += VIOLET * (0.5 + 0.5 * sin(depth * 3.0 + u_time)) * (0.3 + mid);
    col += c * (0.35 + bass * 0.9) * smoothstep(0.0, 0.12, r);
  }

  col *= 1.0 - 0.32 * length(uv - 0.5); // viñeta
  fragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile error');
  }
  return sh;
}

export function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mcanvasRef = useRef<HTMLCanvasElement>(null); // canvas dedicado de butterchurn
  const ncanvasRef = useRef<HTMLCanvasElement>(null); // canvas 2D del campo de nodos
  const screenRef = useRef<HTMLDivElement>(null); // contenedor de medida (siempre visible)
  const vizMode = useGraphStore((s) => s.vizMode);
  const setVizMode = useGraphStore((s) => s.setVizMode);
  const setVizHeight = useGraphStore((s) => s.setVizHeight);
  const vizVisible = useGraphStore((s) => s.vizVisible);
  const vizHeadless = useGraphStore((s) => s.vizHeadless);
  const vizMilkStyle = useGraphStore((s) => s.vizMilkStyle);
  const setVizVisible = useGraphStore((s) => s.setVizVisible);
  const setVizHeadless = useGraphStore((s) => s.setVizHeadless);
  const setVizMilkStyle = useGraphStore((s) => s.setVizMilkStyle);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const recTapRef = useRef<{ out: AudioNode; dest: MediaStreamAudioDestinationNode } | null>(null);

  // Arrastre del borde superior para agrandar/encoger la pantalla. CLAVE para que
  // NO se interrumpa la música: durante el arrastre actualizamos la variable CSS
  // --viz-h de forma imperativa (puro reflow CSS, coalescido a 1/frame) en vez de
  // escribir el store en cada pointermove — eso re-renderizaba ReactFlow entero y
  // bloqueaba el hilo principal, glitcheando el audio. Sólo confirmamos al soltar.
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const appEl = (e.currentTarget as HTMLElement).closest('.app') as HTMLElement | null;
    const clamp = (h: number) => Math.max(150, Math.min(Math.round(window.innerHeight * 0.85), h));
    let latest = useGraphStore.getState().vizHeight;
    let raf = 0;
    const move = (ev: PointerEvent) => {
      latest = clamp(Math.round(window.innerHeight - ev.clientY));
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          appEl?.style.setProperty('--viz-h', `${latest}px`);
        });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      document.body.style.cursor = '';
      setVizHeight(latest); // commit: un único re-render + persistencia
    };
    document.body.style.cursor = 'ns-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const modeRef = useRef(vizMode);
  modeRef.current = vizMode;
  const visibleRef = useRef(vizVisible); // el bucle rAF salta el render cuando se oculta
  visibleRef.current = vizVisible;

  // Pantalla completa real de la pantalla (para proyectar). En fullscreen el canvas
  // llena la pantalla y el ResizeObserver reajusta su resolución.
  const goFullscreen = () => {
    const el = screenRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  // Minimizar: si seguimos en pantalla completa hay que SALIR antes de ocultar el
  // dock. Ocultar (.viz-dock display:none) mientras su .viz-screen es el elemento
  // fullscreen deja la página atascada / en negro ("no se sale bien"). Salimos del
  // fullscreen y luego minimizamos.
  const minimize = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setVizVisible(false);
  };

  // Seguridad: si la pantalla se oculta por cualquier vía (botón, escena…), nunca
  // dejamos un elemento en pantalla completa oculto.
  useEffect(() => {
    if (!vizVisible && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [vizVisible]);

  // Graba video (canvas activo) + audio (master) a un .webm. El video sale del
  // canvas que se está dibujando; el audio, de un MediaStreamDestination conectado
  // al nodo de salida (no altera lo que se oye). Al parar, descarga el clip.
  const toggleRecord = () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const srcCanvas = modeRef.current === MILKDROP ? mcanvasRef.current : canvasRef.current;
      if (!srcCanvas) return;
      const vstream = srcCanvas.captureStream(30);
      const tracks = [...vstream.getVideoTracks()];
      // audio del master (best-effort; si no hay salida aún, graba solo video)
      const out = getMasterOutputNode();
      if (out) {
        const dest = getAudioCtx().createMediaStreamDestination();
        out.connect(dest);
        recTapRef.current = { out, dest };
        tracks.push(...dest.stream.getAudioTracks());
      }
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
        (m) => MediaRecorder.isTypeSupported(m)
      );
      const rec = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        videoBitsPerSecond: 8_000_000,
      });
      recChunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) recChunks.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(recChunks.current, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `telar-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        const tap = recTapRef.current;
        if (tap) {
          try {
            tap.out.disconnect(tap.dest);
          } catch {
            /* nodo en transición */
          }
          recTapRef.current = null;
        }
        setRecording(false);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      console.warn('record:', e);
    }
  };

  // --- estado butterchurn / MilkDrop ---
  const bcRef = useRef<import('butterchurn').ButterchurnVisualizer | null>(null);
  const bcLoading = useRef(false);
  const bcConnected = useRef(false);
  const presetsRef = useRef<unknown[]>([]);
  const presetNamesRef = useRef<string[]>([]);
  const presetIdx = useRef(0);
  const badPresets = useRef<Set<number>>(new Set()); // presets que lanzan error → se saltan
  const lastSwitch = useRef(0);
  const [presetName, setPresetName] = useState('');
  const nextPresetRef = useRef<(delta: number) => void>(() => {});
  const gotoRef = useRef<(idx: number, blend?: number) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current!;
    const mcanvas = mcanvasRef.current!;
    const ncanvas = ncanvasRef.current!;
    const nctx = ncanvas.getContext('2d');
    const screen = screenRef.current!;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) {
      console.warn('WebGL2 no disponible');
      return;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uWave = gl.getUniformLocation(prog, 'u_wave');
    const uFft = gl.getUniformLocation(prog, 'u_fft');
    const uMode = gl.getUniformLocation(prog, 'u_mode');

    const makeTex = (unit: number) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const waveTex = makeTex(0);
    const fftTex = makeTex(1);
    gl.uniform1i(uWave, 0);
    gl.uniform1i(uFft, 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    let waveData = new Uint8Array(0);
    let fftData = new Uint8Array(0);

    // Medimos desde el contenedor (.viz-screen), que SIEMPRE está visible. Antes
    // medíamos desde el canvas WebGL, pero al activar milkdrop ese canvas pasa a
    // display:none → clientWidth 0 → butterchurn quedaba en 0×0 (se veía roto).
    const dprOf = () => Math.min(window.devicePixelRatio || 1, 2);
    // Reasigna los buffers de dibujo (caro: realloc de texturas/framebuffers).
    const applyBuffers = () => {
      const dpr = dprOf();
      const w = Math.max(1, Math.floor(screen.clientWidth * dpr));
      const h = Math.max(1, Math.floor(screen.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      if (mcanvas.width !== w || mcanvas.height !== h) {
        mcanvas.width = w;
        mcanvas.height = h;
        bcRef.current?.setRendererSize(w, h);
      }
      if (ncanvas.width !== w || ncanvas.height !== h) {
        ncanvas.width = w;
        ncanvas.height = h;
      }
    };
    // Durante el arrastre el canvas se estira por CSS (100%); sólo reasignamos el
    // buffer 90 ms tras asentarse el tamaño → cero realloc por frame, audio fluido.
    let resizeTimer = 0;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(applyBuffers, 90);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(screen);
    applyBuffers();

    // Carga perezosa de butterchurn (~MB): sólo cuando se activa milkdrop.
    const ensureButterchurn = async () => {
      if (bcRef.current || bcLoading.current) return;
      bcLoading.current = true;
      try {
        const [{ default: butterchurn }, { default: presets }] = await Promise.all([
          import('butterchurn'),
          import('butterchurn-presets'),
        ]);
        const ctx = getAudioCtx();
        const viz = butterchurn.createVisualizer(ctx, mcanvas, {
          width: mcanvas.width || 800,
          height: mcanvas.height || 300,
          pixelRatio: 1,
          textureRatio: 1,
        });
        viz.setRendererSize(mcanvas.width || 800, mcanvas.height || 300);
        const entries = Object.entries(presets.getPresets());
        presetsRef.current = entries.map(([, p]) => p);
        presetNamesRef.current = entries.map(([n]) => n);
        // Carga un preset saltando los marcados como defectuosos. loadPreset puede
        // lanzar si el shader del preset no compila → lo blacklisteamos y seguimos.
        const goto = (idx: number, blend = 2.7) => {
          const ps = presetsRef.current;
          const n = ps.length;
          if (!n) return;
          let i = ((idx % n) + n) % n;
          for (let k = 0; k < n; k++) {
            if (!badPresets.current.has(i)) {
              try {
                viz.loadPreset(ps[i], blend);
                presetIdx.current = i;
                setPresetName(presetNamesRef.current[i] ?? '');
                return;
              } catch (e) {
                console.warn('preset roto:', presetNamesRef.current[i], e);
                badPresets.current.add(i);
              }
            }
            i = (i + 1) % n;
          }
        };
        gotoRef.current = goto;
        nextPresetRef.current = (delta) => goto(presetIdx.current + delta);
        goto(Math.floor(Math.random() * presetsRef.current.length), 0);
        lastSwitch.current = performance.now();
        bcRef.current = viz;
      } catch (e) {
        console.warn('butterchurn:', e);
      } finally {
        bcLoading.current = false;
      }
    };

    let raf = 0;
    const start = performance.now();
    const upload = (unit: number, tex: WebGLTexture, data: Uint8Array) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, data.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    };

    const renderMilk = (now: number) => {
      void ensureButterchurn();
      const bc = bcRef.current;
      if (!bc) return;
      if (!bcConnected.current) {
        const an = getMasterAnalyser();
        if (an) {
          bc.connectAudio(an);
          bcConnected.current = true;
        }
      }
      if (now - lastSwitch.current > AUTO_MS && presetsRef.current.length > 1) {
        nextPresetRef.current(1 + Math.floor(Math.random() * 3));
        lastSwitch.current = now;
      }
      // Un preset puede lanzar en render (shader/eval). Lo aislamos: blacklist +
      // salto al siguiente, para que NUNCA tumbe el bucle ni el scope WebGL.
      try {
        bc.render();
      } catch (e) {
        console.warn('preset roto en render:', presetNamesRef.current[presetIdx.current], e);
        badPresets.current.add(presetIdx.current);
        gotoRef.current(presetIdx.current + 1, 0);
        lastSwitch.current = now;
      }
    };

    // Campo de nodos (Canvas2D): un cúmulo por source, reactivo a su propio audio.
    const renderNodes = (now: number) => {
      if (!nctx) return;
      const ids = useGraphStore
        .getState()
        .nodes.filter((nd) => nd.data.kind === 'source')
        .map((nd) => nd.id);
      renderNodeField(nctx, ncanvas.width, ncanvas.height, (now - start) / 1000, ids);
    };

    const renderScope = (now: number) => {
      const an = getMasterAnalyser();
      if (an) {
        if (waveData.length !== an.fftSize) waveData = new Uint8Array(an.fftSize);
        if (fftData.length !== an.frequencyBinCount) fftData = new Uint8Array(an.frequencyBinCount);
        an.getByteTimeDomainData(waveData);
        an.getByteFrequencyData(fftData);
      } else {
        if (waveData.length === 0) waveData = new Uint8Array(1024).fill(128);
        if (fftData.length === 0) fftData = new Uint8Array(512);
      }
      upload(0, waveTex!, waveData);
      upload(1, fftTex!, fftData);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform1i(uMode, modeRef.current);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // Bucle único y a prueba de fallos: cualquier excepción (preset MilkDrop roto,
    // error WebGL…) se atrapa y el rAF SIEMPRE se reprograma en `finally`, así el
    // visualizador nunca se congela. (antes un preset malo tumbaba todo el scope)
    const render = () => {
      // Oculto: no gastamos GPU/CPU dibujando (el dock está en display:none).
      if (!visibleRef.current) {
        raf = requestAnimationFrame(render);
        return;
      }
      try {
        const now = performance.now();
        if (modeRef.current === MILKDROP) renderMilk(now);
        else if (modeRef.current === NODOS) renderNodes(now);
        else renderScope(now);
      } catch (e) {
        console.warn('viz render:', e);
      } finally {
        raf = requestAnimationFrame(render);
      }
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      ro.disconnect();
      gl.deleteProgram(prog);
      resetNodeField();
    };
  }, []);

  const isMilk = vizMode === MILKDROP;
  const isNodes = vizMode === NODOS;
  const milkTelar = isMilk && vizMilkStyle === 'telar';
  return (
    <div className={`viz-dock${!vizVisible ? ' is-hidden' : ''}${vizHeadless ? ' is-headless' : ''}`}>
      <div className="viz-resize" onPointerDown={onResizeDown} title="arrastra para redimensionar la pantalla">
        <span className="viz-grip" />
      </div>
      <div className="viz-bezel">
        <div className="viz-rail">
          <span className="viz-led" />
          <span className="viz-rail-txt">master</span>
        </div>
        <div className="viz-screen" ref={screenRef} style={{ background: tokens.bg }}>
          <canvas ref={canvasRef} className="viz-canvas" style={{ display: isMilk || isNodes ? 'none' : 'block' }} />
          <canvas ref={mcanvasRef} className="viz-canvas" style={{ display: isMilk ? 'block' : 'none' }} />
          <canvas ref={ncanvasRef} className="viz-canvas" style={{ display: isNodes ? 'block' : 'none' }} />
          {/* tinte Telar sobre milkdrop: recolorea la luminancia del preset hacia la
              paleta (mix-blend-mode: color). 0 coste por frame, conserva el movimiento. */}
          {milkTelar && <div className="viz-milk-tint" />}
          <div className="viz-modes">
            {VIZ_MODES.map((m, i) => (
              <button key={m} className={i === vizMode ? 'on' : ''} onClick={() => setVizMode(i)}>
                {m}
              </button>
            ))}
          </div>
          {/* herramientas del contenedor (siempre accesibles, también en headless) */}
          <div className="viz-tools">
            <button
              className={`viz-tool rec${recording ? ' on' : ''}`}
              onClick={toggleRecord}
              title={recording ? 'detener grabación' : 'grabar video + audio (.webm)'}
            >
              <span className="viz-rec-dot" />
            </button>
            <button className="viz-tool" onClick={goFullscreen} title="pantalla completa">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </button>
            <button
              className={`viz-tool${vizHeadless ? ' on' : ''}`}
              onClick={() => setVizHeadless(!vizHeadless)}
              title={vizHeadless ? 'mostrar bisel' : 'modo limpio (sin bisel/HUD)'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="1.5" />
              </svg>
            </button>
            <button className="viz-tool" onClick={minimize} title="minimizar (ocultar pantalla)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          {isMilk && (
            <div className="viz-presets">
              <button onClick={() => nextPresetRef.current(-1)} title="preset anterior">‹</button>
              <span className="viz-preset-name" title={presetName}>{presetName || 'cargando…'}</span>
              <button onClick={() => nextPresetRef.current(1)} title="siguiente preset">›</button>
              <span className="viz-milk-style">
                <button className={vizMilkStyle === 'free' ? 'on' : ''} onClick={() => setVizMilkStyle('free')} title="presets originales">free</button>
                <button className={vizMilkStyle === 'telar' ? 'on' : ''} onClick={() => setVizMilkStyle('telar')} title="teñido a la paleta Telar">telar</button>
              </span>
            </div>
          )}
          <div className="viz-corner br">{VIZ_MODES[vizMode]}</div>
        </div>
        <div className="viz-rail right">
          <span className="viz-rail-txt">telar · v1</span>
          <span className="viz-led dim" />
        </div>
      </div>
    </div>
  );
}
