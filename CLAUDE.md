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

---

## La vara: géneros objetivo

Todo lo "funcional" se juzga contra: **Dancehall, Techno, EBM, Post-punk, Trap, Drift-phonk, Rap.** Lo que exigen y hoy falla: **808 con slide + pitch por paso** (trap/drift-phonk/EBM/dancehall), **rolls/ratchets/tresillos de hats** (trap/phonk), **autotune real de corrección** (todos los vocales), **groove/humanize** (dancehall/rap/post-punk), **acordes** (EBM/post-punk/trap), **arreglo por clips** (todos).

**Fuera de foco:** el modo/mezclador DJ. No romperlo, no ampliarlo.

---

## Protocolo de trabajo (obligatorio)

Herramienta de música → **no se batchea "¿suena bien de verdad?"**. Por cada tarea:

1. **Plan primero:** propón un todo corto y espera OK antes de editar.
2. **Una tarea a la vez.** No mezcles tareas ni fases en un mismo cambio.
3. **Construir → ESCUCHAR → corregir.** Verifica el criterio de aceptación de la tarea (que suene) antes de cerrar.
4. **Un commit por tarea**, mensaje claro. Deja el árbol compilando (`npm run build`) y los tests pasando (`npm test`).
5. Respeta el throttle, los orbits y el audio defensivo. Ante duda de la API de Strudel, verifica en su fuente antes de asumir.

Mapa: compilador `src/graph/compile.ts` · motor `src/audio/engine.ts` · estado `src/store/useGraphStore.ts` · secuenciadores `src/nodes/StepSeq.tsx` + `src/nodes/MelodicSeq.tsx` (+ global `src/ui/StepSequencer.tsx`/`useSequencerStore`) · voz `src/ui/VoiceStudio.tsx` · synth `src/ui/SynthStudio.tsx` · arreglo `src/ui/SongTimeline.tsx`/`Scenes.tsx` · export `src/audio/freeze.ts`/`src/lib/audioRecorder.ts` · tipos `src/graph/types.ts`.
