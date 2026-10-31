# CLAUDE.md — Telar

Herramienta de producción musical **node-based** en el navegador. SPA **Vite + React 18 + TypeScript**, motor **`@strudel/web` + superdough** (Web Audio), grafo con **React Flow**, editores con **CodeMirror 6**, estado **Zustand**, visualización **WebGL2 + Butterchurn**. Licencia **AGPL-3.0-only**.

Este archivo es el contrato. Léelo antes de tocar audio o el grafo.

---

## Reglas de arquitectura — NO se rompen

1. **El grafo compila a UN string de Strudel.** `src/graph/compile.ts` → `compileGraph` recorre el grafo (topológico, valida DAG) y emite un `Pattern` como texto JS; `src/audio/engine.ts` → `swapPattern` lo pasa a `repl.evaluate` para **hot-swap sin reiniciar el reloj**. Toda feature de patrón nueva se emite como **sufijo de método** sobre el Source, igual que `applySynth` / `applyVoice` / `applyMaster`. No inventes otra vía.
2. **DSP real de audio va por "orbits".** superdough aplica FX **por-voz, en orden interno FIJO y de un solo uso** (`.lpf().distort().lpf()` NO funciona: el 2º `lpf` pisa al 1º). Para EQ/compresión/insert-chains reales se **enruta la rama a un orbit** (`.orbit(K)`) y el motor **intercepta el bus de ese orbit** con nodos Web Audio (`engine.ts` → `applyChannelEqs`, `applyMasterBus`). Ese es el patrón para todo lo "de mezcla". Los orbits son un recurso compartido (sidechain-duck y EQ por canal ya consumen 2,3,…): comparte el asignador, no colisiones.
3. **Recompilación con throttle.** `useGraphStore` → `recompile` + `swapTimer`: cambios estructurales (add/remove/mute) recompilan directo; arrastres de slider se agrupan en 1 swap. Nunca metas recompiles por frame.
4. **Audio defensivo.** Todo empalme Web Audio en `try/catch`; peor caso, bypass directo. Nunca dejes que un cambio pueda silenciar la salida.
5. **AGPL:** puedes usar librerías **GPL** (Rubber Band WASM, etc.) sin licencia comercial. No metas dependencias con licencia incompatible.
6. **COOP/COEP ya configurados** (`vercel.json`): hay aislamiento de origen cruzado → `SharedArrayBuffer` / WASM con hilos disponibles.

---

## Cómo emitir código Strudel (referencia rápida)

- Nota/pitch por paso: patrón paralelo `.note("c1 ~ eb1 …")` alineado a los pasos. `note()` **re-afina samples** (no solo sintes) → así se hace el 808 con pitch y el cowbell melódico del phonk.
- Grados en escala (autotune melódico): `.n("0 2 4").scale("C:minor")`.
- Acordes: token de capa `[c,e,g]` dentro de `note("…")`.
- Glide/slide de 808: envolvente de pitch `.penv(semitonos).pdecay(seg)` — así lo emite `MelodicSeq` (slider «slide»). OJO: `.slide()` NO sirve aquí (superdough solo lo lee en el synth `zzfx`; para `note()`/samples es no-op).
- Ratchet/roll por paso: `hh*3` (o `[hh hh hh]`) en ese slot del patrón, o `.ply(n)`.
- Probabilidad/variación por paso: `hh?` o `<hh ~>` (alterna por ciclo).
- Micro-timing: patrón paralelo `.late("0 0.02 0 …")`.
- Velocity/duración por paso (ya en `MelodicSeq`): `.gain("…")` / `.clip("…")` paralelos. Reusa ESTE mecanismo para pitch/slide/etc.
- Groove: `.swingBy(x, 4)` + humanize `.late(rand.range(0,h)).gain(rand.range(1-h,1))`.

---

## Gotchas del código (no tropieces)

- **`MelodicSeq.tsx` es monofónico** y emite vel/gate como patrones paralelos alineados a pasos. Sigue ese patrón para pitch/slide/acordes.
- **El secuenciador por-source (`StepSeq.tsx`) se rinde con `[] <> ()`** ("patrón avanzado"). Al ampliarlo, parsea sub-estructura en vez de rendirte.
- **`.stretch()` (voz) mapea `raw`→factor de pitch por tramos** (ver `applyVoice`). El autotune REAL necesita detección+resíntesis, NO reusar `.stretch` global.
- **Las escenas (`useScenesStore`) capturan solo MEZCLA** (mute/solo/gain/chFilter/params), no notas. "Clips por pista" requiere override del `code`/preset del Source, no solo estado de mezcla.
- **El grabador usa `ScriptProcessorNode`** (deprecado). Migrar a AudioWorklet antes de exportar varios stems en paralelo.
- **Samples locales no viajan en compartir-por-URL** → colaboración/entrega necesita subida a almacenamiento.
- **Un sufijo de control PISA el de la voz** (`.lpf(300).lpf(6372)` → 6372; `.room(0.6).room(0.1)` → 0.1). Para FX de mezcla sobre código ajeno usa `composeFx` de `compile.ts` (`.fmap`: lpf→min, hpf→max, room/delay→1−(1−a)(1−b), crush→min). Ya lo usan el filtro de canal (`chFilter`) y eco/reverb/crush del máster global.
- **Máster global = `applyGlobalMaster`**, no `applyMaster`: el filtro y el drive del máster viven en el BUS (`djHP/djLP/djDrive` en `applyMasterBus`) y NO recompilan (`MASTER_BUS_KEYS` en `useGraphStore`). `applyMaster` con `filter` es el filtro DE CANAL de cada Source.
- **Taps de audio:** grabar / medir (LUFS) / visualizar = `getMasterPostNode()` (post-bus, lo que suena). `getMasterOutputNode()` (destinationGain) es PRE-bus: solo para el freeze (stem limpio, si no el bus se aplicaría dos veces).

---

## La vara: géneros objetivo

Todo lo "funcional" se juzga contra: **Dancehall, Techno, EBM, Post-punk, Trap, Drift-phonk, Rap.** Lo que exigen y hoy falla: **808 con slide + pitch por paso** (trap/drift-phonk/EBM/dancehall), **rolls/ratchets/tresillos de hats** (trap/phonk), **autotune real de corrección** (todos los vocales), **groove/humanize** (dancehall/rap/post-punk), **acordes** (EBM/post-punk/trap), **arreglo por clips** (todos).

**Modo DJ** (`DjMixer.tsx`, listo para tocar): volumen, crossfader, filtro, EQ, mute y solo de cada deck viven en la TIRA del bus de su pista (`compileGraph({busMix})` → `ChannelEqRoute.fader/filter`; `src/audio/djMix.ts` → `setStripLive`): actúan al instante, sin recompilar, aunque suene un loop largo. Un deck en mute SIGUE en el código (fader 0) para entrar justo en el 1 (`nextBarAudioTime`, «al compás»). El sidechain duck apunta a las tiras de su rama y se apaga con el bombo en mute (recompila en el compás: `djEntryNeedsCode`). CUE = toma pre-fader de cada tira → `getCueSum()` → `cueOut.ts` (otra salida, `setSinkId`); el cue no es estado del proyecto. Decks nuevos entran en mute. MIDI de la mesa por POSICIÓN de deck (`djMidi.ts`: `dj.d1.eqlow`…); todos los slots MIDI los registra la app (`useMidiSlots.ts`), no el panel. Exportar no usa busMix (con `orbitPlan` manda el código).

**En foco (nuevo):** el **control EN VIVO por MIDI** — pads/perillas de un controlador físico (p. ej. M-Wave) para tocar la mezcla. Vive APARTE del mezclador DJ, como capa de control transversal: `src/audio/midiIn.ts` (parseo Note/CC + ruteo + "aprender", portado del En vivo de la Sala de Dirección), `src/store/useMidiStore.ts` (mapa pad/perilla→slot, persistido), `src/ui/MidiLive.tsx` (panel: cada efecto con su PAD que engancha y su PERILLA que gradúa la cantidad; + 8 pads de escena). Dónde actúa cada cosa: perillas filtro/drive (`setMaster` → bus) y pads Eco/Wash/Kill (`setLiveFx`, etapa fija de FX en vivo antes del limitador TP) van al BUS Web Audio — al instante, sin recompilar; perillas eco/reverb/crush y pads Roll/Gate/Reverse/½ tiempo van al código (recompila con throttle, regla 3). Los pads momentáneos jamás se persisten ni entran en escenas (`releaseMomentary` / `withoutMomentary`). NO toca `DjMixer.tsx`.

---

## Próximo trabajo

**Modo DAW, Fases 0–3 — hechas** (planes y commits en `telar-daw-fase0.md` … `telar-daw-fase3.md`). Lo que hay que saber antes de tocarlo:
- **La verdad es el código**: cada sección es un brazo de `arrange([n, pat], …)` en cada pista y un paso de `useSongStore.steps` (`{id, scene, bars, name?}`). `splitArrange` (`src/nodes/stepseqCode.ts`) es el único parser. Apagado = `.mask(0)` (conserva el patrón); vacío = `silence`. Las escenas son la MEZCLA de cada sección; los bloques, QUÉ suena.
- **Editar la estructura** = funciones puras de `src/lib/arrangeEdit.ts` (alinean siempre canción y pistas) → `src/lib/dawActions.ts` → `useGraphStore.applyArrangement(codes, steps, patches)`: UN paso deshacible y UN recompile; el historial con `live` deshace sin cortar la canción que suena.
- **Tiempo**: `from` (tocar desde, `.early`), región (`.ribbon` + `regionOn`), `stopAt` (exportar: `filterHaps`) y `exportOnly` (stem: compila una sola pista) viven en `useSongStore` y entran por `applyTimeline` en `compile.ts`, por DENTRO del máster. Quien convierta el reloj en compás de canción usa `timelinePos` (`src/lib/songClock.ts`).
- **Automatización** (`src/lib/automation.ts`): `data.auto {vol, filt}` en compases de canción → sufijo `.withHap` por Source (después de la mezcla del canal). Siempre leerla con `cleanAuto`.
- **Jam → canción** (`src/lib/jamRecorder.ts`): muestrea escenas, mutes y perillas por compás; al parar arma secciones, brazos y curvas (las pistas con secciones propias no se tocan).
- **Exportar** (`src/lib/songExport.ts`): render OFFLINE (Fase 4) con respaldo en tiempo real si falla. ZIP sin dependencias en `src/lib/zip.ts`.
- **Transporte**: `swapPattern` evalúa SIN autostart y solo arranca el reloj si no hubo ■ desde que empezó (época en `engine.ts`); nunca vuelvas a `evaluate(code, true)`.

**Temas completos, Fases 4–7 — hechas** (plan y commits en `telar-plan-temas-completos.md`; lo que hay que oír, §14 de `escuchas-pendientes.md`). Mapa y trampas:
- **Exportar (4)**: `songBake.ts` hornea la canción con sus escenas en UN patrón (orbits FIJOS para todas las secciones: `orbitPlan`) → `audio/offlineRender.ts` (superdough con un controlador propio sobre un `OfflineAudioContext`, por tramos de 2 compases; el contexto EN VIVO se pausa mientras tanto) → `renderBusOver` (bus del máster) → `loudness.ts` (BS.1770) y objetivo −14/−8 LUFS empujando el limitador TP (`masterFrom`) → `exportEncode.ts` (WAV 16/24/32f, MP3; worker). Stems por el tap PRE-bus (suman la mezcla pre-bus exacta); MIDI con `midiExport.ts`. La reverb `.room()` de superdough genera su IR de forma asíncrona: en el render el primer golpe de cada orbit puede salir sin cola — para lo nuevo usa los retornos (6.4) o una cola propia.
- **Splice (5)**: tonalidad del tema `songKey` (escrita; el «tono» ± suma después). Loops al BPM = copias estiradas registradas como `wl_…` y emitidas `s("wl_…").slow(ciclos)` a velocidad 1 (`loopWarp.ts`/`warpLoops.ts`; `prepareSounds({waitWarp})` antes de exportar). Rebanador `slicer.ts` + `slicePads.ts`; MIDI de Splice → `midiImport.ts`.
- **Mezcla (6)**: tira por pista (EQ + compresor `chanComp.ts`, AudioWorklet, transcribe `compCurve.ts`) en el orbit de la pista; los orbits se crean YA (`getOrbit`), no con la primera nota. Fader = `.mul(velocity(x))`: superdough tiene `gain` 0,8 por defecto y `.mul(gain(x))` lo pisaba (+1,9 dB al dejar 1,00). Medidores `levelMeter.ts` (pico real; la suma pre-máster) y «dejar margen» (escala ganancias y escenas en un paso). Retornos compartidos `fxReturns.ts`: envíos post-fader desde la tira; sus perillas (`RETURN_KEYS`) son del bus y NO recompilan. A/B de referencia `refTrack.ts`. Recompilan al cambiar: `comp`, `sends`, `transitions`, `auto` (ver `updateNodeData`).
- **Arreglo (7)**: pads → rejilla `padRecorder.ts` (el dueño de las notas libres se reparte con `claimNoteSink`; una toma = un paso de deshacer con `beginTake/endTake`). Automatización: curvas de código (`.withHap`; perillas de FX como `signal()` en `fxAutomation.ts`) y curvas del MOTOR (envíos, filtro DJ, drive, retornos) que mueve `autoRunner.ts` en vivo (`busOverride`) y el render agenda exactas. Fill = forma canónica `BASE.lastOf(N, () => FILL)` (½ compás: `stack(x.mask("1 0"), (FILL).mask("0 1"))`), un brazo por sección. Transiciones: nodo con `data.transitions` cuyo código escribe el compilador (un evento que dura lo que el elemento; afinado con `keyRoot`); sus sonidos son instrumentos propios (`transSounds.ts`) que ■ corta en 30 ms — superdough no puede parar sus voces (WeakRef); el barrido es curva `mfilt`. Plantillas en `templates.ts` (el menú las carga con `loadSnapshot`).

**DAW visual, Fases 8–12 — hechas** (plan y commits en `telar-plan-daw-visual.md`; lo que hay que oír, §15 de `escuchas-pendientes.md`). Mapa y trampas:
- **Tiempo y rejilla**: `lib/dawGrid.ts` (rejilla magnética, regla), `heardCycle()` en `engine.ts` (lo que SE OYE, para cabezales y contador), metrónomo `lib/metronome.ts` + `audio/metronomeSound.ts` (cuenta previa = `countIn` en `useSongStore`, `timelinePos` negativo antes de arrancar).
- **Pantalla**: paneles acoplados `useDockStore`/`ui/Docks.tsx` (abiertos por vista; en la DAW plegados), color por pista `lib/trackColor.ts`, grafo `lib/graphLayout.ts`, miniaturas y bloques dibujados con `audio/patternPreview.ts` (evalúa el código sin tocar el motor; `eventsOf(…, pieces)` incluye el trozo de un evento que empezó antes, para los clips partidos). Un loop es loop por la duración de sus eventos, no por cuántas vueltas caben (`patternFigure`). Las ondas van por la URL del sample (`previewSample`/`waveformPeaks`) y se vuelven a pedir cuando superdough registra sonidos (`audio/soundsVersion.ts`).
- **Panel de detalle** (`useDetailStore`, `ui/DetailPanel.tsx`, `SeqBigContext`): el mismo `StepSeq` en grande. Rejilla con largo 1/2/4 compases (`.slow(N)`, `Parsed.bars`; micro-timing y humanize se escriben ÷compases), polimetría (`Lane.len` → `.fast(S/L)`) y condiciones (`Lane.cond` → `<hh ~ ~ ~>`). Piano roll grande `nodes/PianoRoll.tsx` sobre `nodes/melCode.ts` (notas largas = `.clip` por paso, acordes diatónicos, fantasmas). Loops y samples `nodes/SampleEditor.tsx` sobre `lib/clipCode.ts` (tramo `.begin/.end`, al revés `.speed(-1)` con el tramo en espejo, fundidos `.attack` / `.release`+`.clip`, rebanadas, marcador de tempo → `retuneWarp`, tono `warp.st`). Cabezales de sección: `armTime` (`songClock.ts`) vía `nodes/patternClock.ts`. Las notas fantasma salen de `nodes/useGhostNotes.ts` (las usan los dos piano roll; el pequeño del nodo también tiene «clic pone» con acordes en tono).
- **Cabeceras y carpetas (9.6)**: `lib/dawFolders.ts` (carpeta por tipo, alturas `LANE_H`, dB y paneo), `ui/DawTrackHead.tsx` (medidor, volumen, paneo; M/S de carpeta = UN paso con `applyArrangement({}, undefined, patches)`), `useDawUiStore.folders/closed`, `NodeData.laneH/folder`.
- **Pads (9.7)**: `nodes/DrumPads.tsx` (vista «◫ pads» de una batería): cadena por pad `lib/padFx.ts` (tono, decay, filtro, paneo, room, grupo de corte `CUT_GROUPS`), alternativas de sample `audio/padSounds.ts`, editar un sonido en todas las secciones `lib/padEdit.ts`, «guardar lo tocado» = `padRecorder.capturePads`.
- **Clips libres (10.1–10.3)**: `lib/timeline.ts` es el motor. Cada brazo del `arrange` es un clip en compases acumulados; las operaciones de rango dan segmentos `Seg {len, from|null, extend?}` que remapean clips, curvas (`remapCurve`), transiciones y marcadores; partir rota la rejilla si se puede leer o añade `.early(n)`. `arrangeEdit.applySegs` lo usa para mover/duplicar/insertar/borrar secciones; las acciones de clip son `dawActions.dawClip*` (Ctrl+E/D/J/C/V, Supr). Todo entra por `applyArrangement` (un paso de deshacer; el historial guarda también canción y marcadores).
- **Biblioteca y marcadores (10.4–10.5)**: arrastre `application/telar-sound` a pista/compás/pad (`dawActions.dropSoundAt`, `DrumPads` `dropOnPad`), audición a tempo en el próximo compás (`audio/barPreview.ts`, `warpActions.previewLoopAtTempo`); marcadores en `useSongStore.markers` (se guardan: `sanitizeMarkers`), minimapa con energía `ui/DawMarkers.tsx`.
- **Mezclador (11)**: `ui/mixer/` (`Mixer.tsx` tiras + inspector; `EqView` dibuja la curva ANALÍTICA del motor — RBJ: lowshelf 120 Hz, peaking en `midFreq` Q 1, highshelf 4,5 kHz, `lib/mixMath.eqResponse`; `CompView`, `MasterView`, `ChainView` con anillos de automatización y macros en `NodeData.macros` del nodo Out). `useMixerStore` comparte el sitio del panel de detalle (abrir uno cierra el otro). Taps: `audio/mixTaps.ts`. Tecla X (no en DJ).
- **Flujo (12.1–12.4)**: `ui/flow/` — `CommandPalette.tsx` (Ctrl+K y la hoja «?»), `HelpLine.tsx`, `HistoryMenu.tsx` (+ `lib/historyLabel.ts`), `LoadMeter.tsx` (+ `audio/loadMonitor.ts`).
- **Lanzador (12.5)**: `ui/Launcher.tsx` + `lib/launcher.ts`. Lanzar = override por pista en `useLaunchStore.launch` que el compilador usa en lugar del código de la pista (`CompileOpts.launch`; NO se guarda en el proyecto), aplicado en el 1 del próximo compás (timer a `bar.at − audioNow() − 0,19 s`). Variaciones = brazos distintos (`lib/launchTake.trackVariations`). «● grabar la toma» registra lo lanzado por compás y al parar lo escribe al arreglo (`buildTake`: secciones «toma» de ≤64 compases, un paso de deshacer).

**Siguiente: pulir con Carlos** según lo que oiga (secciones 11–15 de `escuchas-pendientes.md`). No quedan fases pendientes en los planes; el teléfono queda fuera por ahora (decisión de Carlos). El panel MIDI guarda su minimizado por vista (`COLLAPSED_KEY` en `MidiLive.tsx`): en la DAW arranca minimizado. Cualquier fase nueva: plan primero y **esperar su OK antes de tocar código**.

---

## Protocolo de trabajo (obligatorio)

Herramienta de música → **no se batchea "¿suena bien de verdad?"**. Por cada tarea:

1. **Plan primero:** propón un todo corto y espera OK antes de editar.
2. **Una tarea a la vez.** No mezcles tareas ni fases en un mismo cambio.
3. **Construir → ESCUCHAR → corregir.** Verifica el criterio de aceptación de la tarea (que suene) antes de cerrar.
4. **Un commit por tarea**, mensaje claro. Deja el árbol compilando (`npm run build`) y los tests pasando (`npm test`).
5. Respeta el throttle, los orbits y el audio defensivo. Ante duda de la API de Strudel, verifica en su fuente antes de asumir.

Mapa: compilador `src/graph/compile.ts` · motor `src/audio/engine.ts` · estado `src/store/useGraphStore.ts` · secuenciadores `src/nodes/StepSeq.tsx` + `src/nodes/MelodicSeq.tsx` (+ global `src/ui/StepSequencer.tsx`/`useSequencerStore`) · voz `src/ui/VoiceStudio.tsx` · synth `src/ui/SynthStudio.tsx` · arreglo `src/ui/SongTimeline.tsx`/`Scenes.tsx` · export `src/audio/freeze.ts`/`src/lib/audioRecorder.ts` · tipos `src/graph/types.ts`.
