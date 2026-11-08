// NÚCLEO DEL REPRODUCTOR CON TONO FIJO (key lock) del modo DJ. Es JavaScript en texto: el MISMO
// código corre en el AudioWorklet (deckPlayer.ts lo inyecta) y en las pruebas (tests/deckCore.test.ts
// lo evalúa), así lo que se prueba es lo que suena.
//
// Cómo: WSOLA leyendo directo del tema. La salida se arma con segmentos de S muestras que se funden
// O muestras con el anterior; cada segmento empieza donde el MODELO de reproducción (el mismo que
// usa el modo DJ: t0, pos0, velocidad, loop) dice que debería ir el tema, corrido ±W muestras hasta
// donde mejor encaja con lo que venía sonando (correlación). Dentro de un segmento el tema se lee a
// velocidad 1: el tono no cambia, y el tempo sale de dónde arranca cada segmento. A velocidad 1 es
// transparente (el mejor encaje es justo la continuación). El desvío respecto del modelo nunca se
// acumula: queda dentro de ±(W + |1 − velocidad|·S/2) — unos pocos ms, centrado en 0.
export const DECK_CORE_SRC = String.raw`
class DeckCore {
  // pcm: canales (Int16Array o Float32Array), scale: multiplicador a flotante, sr: muestras por segundo
  constructor(pcm, scale, sr) {
    this.pcm = pcm;
    this.scale = scale;
    this.sr = sr;
    this.len = pcm[0] ? pcm[0].length : 0;
    this.S = Math.round(0.04 * sr); // segmento (40 ms)
    this.O = Math.round(0.01 * sr); // fundido entre segmentos (10 ms)
    this.H = this.S - this.O;
    this.W = Math.round(0.005 * sr); // búsqueda del mejor encaje: ±5 ms
    this.models = []; // [{at, m}] en orden de at (segundos del contexto)
    this.segOut = -1; // muestra de salida donde empieza el segmento actual (su fundido de entrada)
    this.segIn = 0; // muestra del tema que suena en segOut
    this.prevIn = -1; // la continuación del segmento anterior durante el fundido (-1: no hay)
    this.ended = false;
    // ventana de fundido (coseno alzado: la suma de las dos es 1)
    this.fade = new Float32Array(this.O);
    for (let j = 0; j < this.O; j++) this.fade[j] = 0.5 - 0.5 * Math.cos((Math.PI * (j + 0.5)) / this.O);
  }
  // un modelo nuevo vale desde el segundo at (un cambio de velocidad, entrar o salir de un loop)
  setModel(at, m) {
    const list = this.models.filter((x) => x.at < at);
    list.push({ at, m });
    this.models = list;
  }
  modelAt(t) {
    let cur = this.models[0] ? this.models[0].m : null;
    for (const x of this.models) { if (x.at <= t) cur = x.m; else break; }
    return cur;
  }
  // posición del modelo (segundos del tema) en el segundo t — igual que posAt de lib/djDeck.ts
  posAt(m, t) {
    let p = m.pos0 + (t - m.t0) * m.rate;
    const L = m.loop;
    if (L && L.b > L.a && m.pos0 < L.b && p >= L.b) p = L.a + ((p - L.a) % (L.b - L.a));
    return p;
  }
  // índice del tema con el loop del modelo (leer más allá del final del loop vuelve a su inicio)
  wrap(i, m) {
    const L = m && m.loop;
    if (L && L.b > L.a) {
      const a = Math.round(L.a * this.sr), b = Math.round(L.b * this.sr);
      if (i >= b && b > a && Math.round(m.pos0 * this.sr) < b) i = a + ((i - a) % (b - a));
    }
    return i;
  }
  mono(i, m) {
    i = this.wrap(i, m);
    if (i < 0 || i >= this.len) return 0;
    let s = 0;
    for (let c = 0; c < this.pcm.length; c++) s += this.pcm[c][i];
    return s;
  }
  // el comienzo del segmento que mejor sigue a la continuación «cont», cerca de «nom». La
  // continuación misma encaja perfecto: sin freno, el tema se quedaría en ella hasta el borde de la
  // búsqueda y los golpes caerían corridos (medio W, siempre hacia el mismo lado). Por eso el encaje
  // (correlación normalizada, −1…1) paga un poco por alejarse del modelo: entre encajes parecidos
  // gana el que está a tiempo.
  bestStart(cont, nom, m) {
    const O = this.O, W = this.W;
    const x = new Float32Array(O);
    for (let j = 0; j < O; j++) x[j] = this.mono(cont + j, m);
    const energy = (step) => { let e = 0; for (let j = 0; j < O; j += step) e += x[j] * x[j]; return e; };
    const ex2 = energy(2), ex1 = energy(1);
    if (ex2 < 1e-9) return nom; // silencio: no hay nada que encajar
    const score = (d, step) => {
      let xy = 0, yy = 0;
      for (let j = 0; j < O; j += step) { const y = this.mono(nom + d + j, m); xy += x[j] * y; yy += y * y; }
      if (yy <= 1e-9) return -Infinity;
      const r = d / W;
      return xy / Math.sqrt(yy * (step === 2 ? ex2 : ex1)) - 0.25 * r * r;
    };
    let best = 0, bs = -Infinity;
    for (let d = -W; d <= W; d += 2) { const s = score(d, 2); if (s > bs) { bs = s; best = d; } }
    let fine = best; bs = -Infinity;
    for (let d = best - 2; d <= best + 2; d++) { const s = score(d, 1); if (s > bs) { bs = s; fine = d; } }
    return nom + fine;
  }
  read(c, i, m) {
    i = this.wrap(i, m);
    return i >= 0 && i < this.len ? this.pcm[c][i] * this.scale : 0;
  }
  // llena out (canales Float32Array) con n muestras desde el segundo t del contexto. false = terminó
  render(out, n, t) {
    const sr = this.sr;
    const o0 = Math.round(t * sr);
    // los modelos que ya pasaron se olvidan (queda el vigente): el guardián cambia la velocidad
    // varias veces por segundo y la lista no puede crecer sin fin
    let keep = 0;
    for (let i = 0; i < this.models.length; i++) if (this.models[i].at <= t) keep = i;
    if (keep > 0) this.models = this.models.slice(keep);
    for (let k = 0; k < n; k++) {
      const o = o0 + k;
      const m = this.modelAt(o / sr);
      if (!m || this.ended) { for (let c = 0; c < out.length; c++) out[c][k] = 0; continue; }
      if (this.segOut < 0) {
        // arranque: el tema donde dice el modelo, sin fundido (el fundido de entrada lo hace el deck)
        this.segOut = o;
        this.segIn = Math.round(this.posAt(m, o / sr) * sr);
        this.prevIn = -1;
      } else if (o - this.segOut >= this.H) {
        // segmento nuevo: donde lo pone el modelo, con el mejor encaje. Se ancla en el CENTRO del
        // segmento: adentro el tema va a velocidad 1 y el modelo a la suya, así el desvío va de −x a +x
        // y en promedio es 0 (anclado al comienzo, los golpes caían corridos unos ms siempre al mismo lado)
        this.prevIn = this.segIn + this.H;
        this.segOut += this.H;
        const mid = (this.segOut + this.H / 2) / sr;
        const mm = this.modelAt(mid) || m;
        const nom = Math.round(this.posAt(mm, mid) * sr - this.H / 2);
        this.segIn = this.bestStart(this.prevIn, nom, mm);
      }
      const j = o - this.segOut;
      const cur = this.segIn + j;
      if (!m.loop && cur >= this.len && (this.prevIn < 0 || j >= this.O || this.prevIn + j >= this.len)) {
        this.ended = true;
        for (let c = 0; c < out.length; c++) out[c][k] = 0;
        continue;
      }
      if (j < this.O && this.prevIn >= 0) {
        const w = this.fade[j];
        for (let c = 0; c < out.length; c++) {
          const ch = Math.min(c, this.pcm.length - 1);
          out[c][k] = (1 - w) * this.read(ch, this.prevIn + j, m) + w * this.read(ch, cur, m);
        }
      } else {
        for (let c = 0; c < out.length; c++) out[c][k] = this.read(Math.min(c, this.pcm.length - 1), cur, m);
      }
    }
    return !this.ended;
  }
}
`;
