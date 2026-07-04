# Telar — Catálogo de contenido (referencia para componer)

Lista única y **verídica** de lo que hay disponible en Telar para hacer canciones.
Pensada para que la IA (y el usuario) sepan exactamente con qué trabajar sin inventar
nombres. Verificado contra los packs que carga el prebake (`src/audio/engine.ts`,
repo `felixroos/dough-samples`) y contra el motor `@strudel/web`.

> Fuente de datos en código: `src/docs/catalog.ts` (lo que ve la Guía del sitio) y
> `src/graph/ops.ts` / `synthPresets.ts` / `instrumentKits.ts`. Mantener en sync.

---

## 1. Modelo: grafo de nodos → código Strudel

Telar compila un grafo a un patrón de Strudel. Tipos de nodo:
- **source**: un patrón (`data.code`, mini-notación/Strudel). Opcional `synthOn`+`synth`
  (synth nativo), `gain`, `chFilter`, `mute`, `solo`, `begin`/`end` (recorte de sample).
- **fx / transform**: una operación con `opId` + `params` (ver §6).
- **out**: la mezcla (stack de todo lo conectado).

Un source puede llevar marcadores de visualización inline que NO afectan el sonido:
`._scope()` (osciloscopio) y `._pianoroll()` — el compilador los quita.

### Formato del proyecto (.json / snapshot)
```jsonc
{
  "cps": 0.5,              // ciclos/seg. BPM = cps*60*beatsPerCycle
  "beatsPerCycle": 4,      // tiempos por compás ("/N")
  "transpose": 0,          // "tono" global en semitonos (solo afecta note(...))
  "master": { "gain":1, "filter":0, "room":0, "drive":0, "delay":0, "crush":0 },
  "mode": "standard",      // standard | dj
  "vizMode": 7,            // 7 = visualizador de nodos
  "nodes": [ { "id":"src_1","type":"source","position":{"x":40,"y":20},
               "data":{ "kind":"source","name":"kick","code":"s(\"bd*4\")" } }, ... ],
  "edges": [ { "id":"e1","source":"src_1","target":"out_1" }, ... ]
}
```

---

## 2. Samples de batería — bancos (cajas de ritmo)

Uso: `s("bd sd hh").bank("RolandTR808")`. Sin `.bank()` suenan los del banco por
defecto (EmuSP12). **71 bancos** disponibles:

```
AJKPercusyn, AkaiLinn, AkaiMPC60, AkaiXR10, AlesisHR16, AlesisSR16, BossDR110,
BossDR220, BossDR55, BossDR550, CasioRZ1, CasioSK1, CasioVL1, DoepferMS404,
EmuDrumulator, EmuModular, EmuSP12, KorgDDM110, KorgKPR77, KorgKR55, KorgKRZ,
KorgM1, KorgMinipops, KorgPoly800, KorgT3, Linn9000, LinnDrum, LinnLM1, LinnLM2,
MFB512, MPC1000, MoogConcertMateMG1, OberheimDMX, RhodesPolaris, RhythmAce,
RolandCompurhythm1000, RolandCompurhythm78, RolandCompurhythm8000, RolandD110,
RolandD70, RolandDDR30, RolandJD990, RolandMC202, RolandMC303, RolandMT32,
RolandR8, RolandS50, RolandSH09, RolandSystem100, RolandTR505, RolandTR606,
RolandTR626, RolandTR707, RolandTR727, RolandTR808, RolandTR909, SakataDPM48,
SequentialCircuitsDrumtracks, SequentialCircuitsTom, SergeModular, SimmonsSDS400,
SimmonsSDS5, SoundmastersR88, UnivoxMicroRhythmer12, ViscoSpaceDrum, XdrumLM8953,
YamahaRM50, YamahaRX21, YamahaRX5, YamahaRY30, YamahaTG33
```

### Sonidos (abreviaturas) — presentes en casi todos los bancos
`bd` bombo · `sd` caja · `hh` hi-hat cerrado · `oh` hi-hat abierto · `cp` clap ·
`cr` crash · `rd` ride · `rim` rimshot · `cb` **cencerro** · `lt`/`mt`/`ht` toms ·
`sh` shaker · `perc` percusión · `tb` · `fx` · `misc`.

- RolandTR808: `bd cb cp cr hh ht lt mt oh perc rim sd sh`
- RolandTR909: `bd cp cr hh ht lt mt oh rd rim sd`
- EmuSP12 (banco por defecto): `bd cb cp cr hh ht lt misc mt oh perc rd rim sd`

**Afinar samples**: `s("cb").bank("RolandTR808").note("c5 eb5 g5")` re-afina el sample
por nota (así se hace el cencerro melódico del phonk, o un 808 de bombo afinado).
Variante de un mismo sonido: `s("bd:3")` (índice 3 dentro de la carpeta).

---

## 3. Otros packs de samples (afinables con note())

- **piano** — `s("piano").note("c4 e4 g4")`.
- **vcsl** (orquestal / mundo, 128 sonidos). Melódicos/afinables destacados:
  `marimba, kalimba, vibraphone, xylophone_hard_ff, glockenspiel, tubularbells,
  handbells, balafon, sax, sax_sus, saxello, organ_full, pipeorgan_loud, harp,
  folkharp, harmonica, ocarina, recorder_soprano_sus, didgeridoo, kawai, steinway,
  fmpiano, clavisynth, psaltery_pluck, dantranh, wineglass`.
  Percusión/FX: `conga, bongo, darbuka, cajon, clave, cowbell, agogo, woodblock,
  guiro, cabasa, shaker_large, tambourine, gong, anvil, siren, trainwhistle,
  oceandrum, vibraslap, sleighbells, sus_cymbal`.
- **mridangam** (percusión india): `ta ka ki dhin na thom dhi tha dhum ardha chaapu gumki nam`.
- **Dirt-Samples (extras/texturas)**: `casio, metal, jazz, space, east, wind, insect, crow, numbers`.

---

## 4. Sintetizadores nativos

Osciladores (en `.s("…")` o el panel synth): `sine` (sub limpio), `sawtooth`
(brillante/ácido), `square` (hueca/stab), `triangle` (suave/pluck), `supersaw`
(ancho, con `.spread()` → reese/hoover).

**Wavetables propias** (registradas en runtime): `wt_telar_organ`, `wt_telar_buzz`,
`wt_telar_hollow`, `wt_telar_vocal`, `wt_telar_metal`. Uso como onda: `.s("wt_telar_hollow")`.

### Parámetros del synth (panel `synthOn`+`synth`, o escríbelos a mano)
`wave, spread (supersaw), noise, fm + fmh (índice/ratio), attack decay sustain release,
cutoff (lpf base), lpq (resonancia), lpenv + lpa/lpd (envolvente de filtro), vib + vibmod,
drive (→ .distort), coarse (→ submuestreo lo-fi)`.

### Presets de timbre (`src/graph/synthPresets.ts`)
`acid 303, reese bass, fm bell, fm growl, hoover, pluck, stab, sub, dark pad, lo-fi,
metallic, noise hit` · **urbano**: `808 sub, 808 dist, reggaeton bass, dembow stab,
trap bell, phonk lead`.

---

## 4b. Editor de voz (grabaciones / vocal chops)

Un source de voz (`s("voz_…")`, del grabador) tiene panel propio (`VoicePanel`) con
tres modos de reproducción:
- **natural** (por defecto): suena a su **pitch real**. Emite `.slow(span)` (NO `loopAt`)
  para darle su duración sin desafinar ni bucle infinito. `span` = ciclos que abarca el
  sample (lo fija el grabador). *(loopAt es varispeed: estira el sample → desafina; por eso
  el grabador ya NO lo usa por defecto.)*
- **granular** (opt-in): `.loopAt(loop).chop(grain)` para texturas/grano (sí afina).
- **melódico** (campo melodía): la voz "canta" una melodía. Con **escala**, los números
  son grados cuantizados a la tonalidad (autotune) → `.n("…").scale("…")`; sin escala,
  notas literales → `.note("c4 eb4 g4")`.

Además: **formante** (`vowel`), **room**, **delay**, **shape**, **speed** (pitch manual),
**pos** (begin), **spread** (paneo), **gain**. El "tono" global transpone la melodía.

## 5. Señales de modulación (automatización sin tocar)

Crudas dentro de cualquier parámetro: `lpf(sine.range(300,2000).slow(8))`.
`sine, cosine, saw, isaw, tri, square, rand, perlin`. Ruido como fuente sonora:
`s("white")`, `s("pink")`, `s("brown")`.

---

## 6. FX y transforms (nodos · `src/graph/ops.ts`)

**FX** (se insertan sobre un cable): `lpf(cutoff)`, `hpf(cutoff)`, `bpf(cutoff)`,
`room(amt)`, `delay(amt)`, `crush(bits 1–16)`, `vowel(a/e/i/o/u)`, `midi(device,channel)`,
`stut(count,fb,time)`, **`sidechain(depth,rate)`** (emite
`.gain(saw.range(1-depth,1).fast(rate))` — pump EBM/reggaetón; se muestrea por evento,
ideal para material rítmico, no para pads sostenidos).

**Transform** (tiempo/estructura): `fast(n)`, `slow(n)`, `rev`, `jux(rev)`, `chop(n)`,
`degradeBy(prob)`, `every(n,rev)`, `euclid(pulses,steps,rot)`, `scale(name p.ej. C:minor)`,
`arp(mode up/down/updown)`, `ply(n)`.

### Master + FX de performance
Macros del master: `gain, filter (DJ ±), room, drive (shape), delay, crush`.
Momentáneos (mantén pulsado; ⇧+clic fija): `roll ×2/4/8/16 (.ply), gate, rev, echo, wash`.

---

## 7. Mini-notación (dentro de "…")

`a b` secuencia · `a*4` repetir · `~` silencio · `[a b]` subdivisión · `[a,b]` capas
(acorde/polirritmo) · `<a b c>` alterna por ciclo · `a(3,8)` euclídeo · `a!3` replica ·
`a?` probable · `a@3 b` peso/duración. Notas: `c1`…`b6`, sostenido `cs3`/`c#3`, bemol `eb3`.

---

## 8. Estructura con arrange()

`arrange([4, patrónA], [8, patrónB], …)`: los números son **ciclos**. Para que las
fuentes vayan sincronizadas, el total (suma de ciclos) debe ser **igual en todas**.
Para que un elemento entre más tarde, usa `silence` en sus segmentos iniciales.
Duración (s) = total / cps. BPM = cps · 60 · beatsPerCycle.

---

## 9. Recetas por género (los demos del menú son plantillas)

| Género | BPM | Receta |
|---|---|---|
| techno alemán / hardtechno | 130–150 | `bd*4` con `.shape`; rumble = `bd.speed(0.5).room()`; sub atonal `note("c1")`; hats hpf; stab tritono. sidechain + crush. *(telar-berghain, telar-techno-aleman)* |
| EBM / darkwave | 120–140 | bajo saw + `lpenv` + sidechain (motor Schwefelgelb); pads supersaw; FM lead frío; atonal/menor. *(telar-schwefel-*)* |
| **dembow latino / reggaetón** | 90–100 | bombo en 1 y 3 + caja en `~ ~ ~ x ~ ~ x ~ ~ ~ ~ x ~ ~ x ~` + hats; bajo `sine`/`triangle` + sidechain; stab menor `square`. Banco RolandTR808. *(telar-dembow-latino)* |
| **phonk (memphis)** | 130–150 medio tiempo | cencerro 808 afinado con `note()` (la firma); 808 saw `.shape().coarse()`; hats trap `hh*8 hh*16`; caja en el 3; master `crush`. Menor. *(telar-phonk)* |
| dancehall | 90–110 | one-drop (bombo+caja en el 3), skank offbeat, percusión viva, bajo redondo. Banco LinnDrum/TR808. |

---

## 10. Notas / límites conocidos

- `note()` re-afina samples (pitch por reproducción), no solo sintes.
- `sidechain` se muestrea por hap (onset): bombea en ritmos cortos, NO dentro de notas
  largas sostenidas (pads).
- Los samples LOCALES (drag-drop) no viajan en "compartir por URL".
- `transpose` (tono) solo se aplica a fuentes con `note(...)`; la percusión no se desafina.
