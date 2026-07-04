# Telar — Ejecución (tareas ordenadas para Claude Code)

Ejecuta **en este orden**, **una tarea por vez**, siguiendo el protocolo de `CLAUDE.md` (plan → construir → **escuchar** → commit). Cada tarea es independiente y termina en un commit que compila (`npm run build`) y pasa tests (`npm test`).

Orden por (valor para los géneros × seguridad). Fase A y Fase B son **hilos paralelos** (puedes correrlos en dos sesiones distintas); **dentro de cada hilo, serial**. Fases posteriores están en `telar-plan-de-trabajo.md`.

---

## HILO A — Profundidad de secuenciación

Es lo que hace que trap, drift-phonk, dancehall, EBM y post-punk se sientan producibles hoy. Todas las tareas son **aditivas** (nuevos controles que emiten sufijos), bajo riesgo.

### A1 · Slide/glide de 808 en el secuenciador melódico
- **Archivos:** `src/nodes/MelodicSeq.tsx`, `src/graph/types.ts` (si añades flag a params), `src/graph/compile.ts` (solo si el slide se resuelve en el compilador; preferible emitirlo desde el patrón del Source).
- **Hacer:** añadir control **slide** (0–1) al melódico. Global de la pista al inicio; opcional por-paso después.
- **Emite:** `.slide(x)` sobre el patrón de notas del Source (el motor ya soporta `slide`; se usa en `applyVoice`).
- **Aceptación:** con dos notas distintas en pasos contiguos, el bajo **desliza** el pitch entre ellas → 808 de trap/drift-phonk correcto. Sin slide (0) suena idéntico a hoy.
- **Commit:** `feat(melseq): slide/glide de 808 entre notas`

### A2 · Pitch por paso en la rejilla de batería (808 y cowbell del phonk)
- **Archivos:** `src/nodes/StepSeq.tsx` (parser `parseSeq`/`buildSeq` y UI de lane).
- **Hacer:** añadir un **lane de nota por pista** (opcional): cada paso encendido puede llevar una nota. UI: sub-fila de pitch bajo la pista (o clic-arrastre vertical en la celda para afinar). Reusa el mecanismo de `MelodicSeq` que ya emite patrones paralelos alineados a pasos.
- **Emite:** patrón paralelo `.note("c1 ~ eb1 …")` (o `.n(...).scale(...)` si hay escala) alineado a los pasos de esa pista, dentro de la forma `stack(...)`. Recuerda: `note()` re-afina el sample.
- **Aceptación:** el cowbell (`cb`, banco TR808) toca una **melodía** en la rejilla; un `bd`/808 se afina por paso. Pistas sin pitch quedan igual que hoy.
- **Commit:** `feat(stepseq): pitch por paso (808 afinado, cowbell melódico)`

### A3 · Ratchets / rolls / tresillos por paso (hats de trap y phonk)
- **Archivos:** `src/nodes/StepSeq.tsx`.
- **Hacer:** una celda encendida puede tener **repetición** ×2/×3/×4 (roll/tresillo). UI: menú o clic-arrastre vertical (distinto del de velocity — decide un gesto claro, p.ej. rueda/shift-arrastre) o un ciclo con clic medio.
- **Emite:** en ese slot del patrón, `hh*3` (o `[hh hh hh]`); alternativamente `.ply(n)` puntual. Mantén el resto de la rejilla intacto.
- **Aceptación:** puedo poner un **roll de 1/32** o un **tresillo** en un hat sin salir de la rejilla ni escribir código; se oye el roll.
- **Commit:** `feat(stepseq): ratchets/rolls/tresillos por paso`

### A4 · Acordes + scale-lock en el secuenciador melódico
- **Archivos:** `src/nodes/MelodicSeq.tsx`, `src/ui/pianoRollHelpers.ts`.
- **Hacer:** (a) **polifonía**: permitir varias notas encendidas en la misma columna (apiladas). (b) **scale-lock**: selector de tonalidad que **resalta** los grados de la escala y (toggle) restringe a ellos.
- **Emite:** acordes → token de capa `[c,e,g]` en `note("…")`. Escala → `.n("0 2 4").scale("C:minor")` o filtrado de filas con resaltado de raíz.
- **Aceptación:** dibujo un **acorde menor** para un pad de EBM/post-punk; trabajando en Do menor no pego notas fuera y veo cuál es la raíz. Lo monofónico previo sigue funcionando.
- **Commit:** `feat(melseq): acordes (polifonía) + scale-lock con resaltado`

### A5 · Groove: swing por pista + humanize
- **Archivos:** `src/nodes/StepSeq.tsx`, `src/nodes/MelodicSeq.tsx`, `src/lib/laneCode.ts` (si aplica al global).
- **Hacer:** control de **swing por pista** (además del global) y **humanize** (micro-random de tiempo y velocity). Presets de %swing tipo MPC opcionales.
- **Emite:** `.swingBy(x, 4)` por pista + humanize `.late(rand.range(0, h)).gain(rand.range(1-h, 1))`.
- **Aceptación:** un beat de **dancehall/rap** suena con feel (no robótico); en 0 queda recto.
- **Commit:** `feat(seq): swing por pista + humanize (groove)`

### A6 · Probabilidad / condición por paso
- **Archivos:** `src/nodes/StepSeq.tsx`.
- **Hacer:** un paso puede ser **probable** (suena un %) o **alternante** por compás.
- **Emite:** `hh?` (o `hh?0.3`) para probabilidad; `<hh ~>` para alternar por ciclo.
- **Aceptación:** un paso suena ~50% de las veces o alterna cada compás; introduce variación viva.
- **Commit:** `feat(stepseq): probabilidad/condición por paso`

### A7 · Quitar el bail-out de "patrón avanzado"
- **Archivos:** `src/nodes/StepSeq.tsx` (`parseSeq` y ramas `complex`).
- **Hacer:** que la rejilla **siga editable** aunque el patrón use `[] <> ()`; parsea la sub-estructura por celda en vez de rendirte.
- **Aceptación:** meto un `[bd bd]` o un `<a b>` en un paso y **sigo editando** en la rejilla (no cae al mensaje "empieza rejilla nueva").
- **Commit:** `feat(stepseq): editar patrones con sub-estructura sin rendirse`

### A8 · Consolidar los dos secuenciadores en uno
- **Archivos:** `src/ui/StepSequencer.tsx`, `src/store/useSequencerStore.ts`, `src/nodes/StepSeq.tsx`.
- **Hacer:** dejar **`StepSeq` (por-source) como única superficie de rejilla**. Que la entrada del drum-machine global **cree/enfoque un Source de batería y abra su `StepSeq`**; migra a `StepSeq` lo útil del global (selector de banco de los **71** del catálogo, gain/mute por pista). Retira o reduce `StepSequencer`/`useSequencerStore` a ese lanzador.
- **Aceptación:** existe **una sola** UI de secuenciador; añadir y editar una pista de batería ocurre en un solo lugar, con acceso a los 71 bancos.
- **Commit:** `refactor(seq): un único secuenciador (per-source) + 71 bancos`

*Criterio de cierre HILO A:* pico un beat completo de **trap/drift-phonk** (808 con slide y pitch, rolls de hats) y uno de **dancehall** con groove, sin tocar código, en una sola rejilla.

---

## HILO B — Autotune y voz de verdad

El "autotune" actual es re-disparo melódico de un sample, **no** corrección de tono de una toma. Esto añade la corrección real (el hard-tune que piden trap/drift-phonk/dancehall/rap). Trabajo más pesado (WASM/ML) → sesiones más largas.

### B1 · Andamiaje: forma de onda + warp con Rubber Band WASM
- **Archivos:** nuevo módulo `src/audio/` (p.ej. `rubberband.ts` + worklet), integración en `src/ui/VoiceStudio.tsx`.
- **Hacer:** integrar **Rubber Band v4.0 (WASM, GPL → OK con AGPL)** con AudioWorklet para **time-stretch/pitch de alta calidad** independientes. Exponer estirar/afinar una toma sin varispeed. Requiere COOP/COEP (ya están).
- **Aceptación:** estiro y afino una grabación **sin desafinar** ni cambiar la duración al afinar; latencia aceptable.
- **Commit:** `feat(voice): motor de warp/pitch (Rubber Band WASM)`

### B2 · Autotune REAL (corrección de tono)
- **Archivos:** `src/audio/` (detección de pitch + snap), `src/ui/VoiceStudio.tsx`.
- **Hacer:** **detección de pitch** de la toma (YIN/CREPE en WASM/WebGPU) → **cuantiza a la escala** elegida → **resíntesis preservando formantes/tiempo** (vía B1). Control **"retune speed"**: 0 = duro/robótico (T-Pain), alto = natural. **No** reuses `.stretch` global.
- **Aceptación:** grabo un verso desafinado, elijo **Do menor** y velocidad **dura**, y sale el **hard-tune** sobre **mis palabras y mi tiempo** (no un re-disparo por rejilla).
- **Commit:** `feat(voice): autotune real (detección + snap + resíntesis formante)`

### B3 · Separar UI "sampler melódico" vs "autotune (corrección)"
- **Archivos:** `src/ui/VoiceStudio.tsx`.
- **Hacer:** dividir claramente en la interfaz "hacer que el sample **cante** una melodía" (lo actual) y "**corregir** el tono de la toma" (B2). Nombres y flujos distintos.
- **Aceptación:** no confundo re-disparo con corrección; cada uno tiene su sección.
- **Commit:** `refactor(voice): separar sampler melódico de autotune`

### B4 · Comping de tomas
- **Archivos:** `src/ui/VoiceStudio.tsx`, grabador (`src/lib/audioRecorder.ts` / `src/ui/Recorder.tsx`).
- **Hacer:** grabar **varias tomas** en carriles y componer la mejor (elegir tramos).
- **Aceptación:** grabo 3 tomas y armo una final por tramos.
- **Commit:** `feat(voice): comping de tomas`

### B5 · De-ess / de-noise por ML (WebGPU)
- **Archivos:** `src/audio/` + acción en copilotos (`src/lib/ai*`), `src/ui/VoiceStudio.tsx`.
- **Hacer:** **DeepFilterNet/Demucs** local por WebGPU como acción de IA (encaja con tus copilotos) para limpiar/aislar voz.
- **Aceptación:** limpio o aíslo una toma con un clic.
- **Commit:** `feat(voice): de-ess/de-noise por ML (WebGPU)`

*Criterio de cierre HILO B:* grabo/genero una voz y le aplico **hard-tune real** sobre mi interpretación; puedo limpiarla y componer tomas.

---

## Después (en `telar-plan-de-trabajo.md`, no ahora)

Fase C — Arreglo por clips + automatización ligada al tiempo. Fase D — Track/Bus con inserts reales + Sends/Return + consola de mezcla + undo/redo + export de stems + render offline + LUFS/true-peak. Fase E — "la tela" como superficie de mezcla espacial.

**Arranque recomendado:** abre **A1** (slide de 808) en una sesión y **B1** (Rubber Band) en otra. Es el camino más corto a que tus géneros se sientan pro, sin bloquearte en refactors.
