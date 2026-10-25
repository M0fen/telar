# Telar — Modo DAW · Fase 0 (cimientos)

**Hecha el 2026-10-25** (0.1 `44864ee` · 0.2 `81158df` · 0.3 `b0af0b7` · 0.4 `86a6733`), medida sin oír; lo que falta escuchar está en la sección 12 de `escuchas-pendientes.md`. Plan verificado contra el código el 2026-10-24 (tras `836821b`). Protocolo de `CLAUDE.md`: **plan → OK de Carlos → una tarea por commit → `npm run build` + `npm test` → que lo escuche**. Orden fijo: 0.1 → 0.2 → 0.3 → 0.4.

**Qué es el Modo DAW (decidido):** una tercera vista (Estándar | DJ | DAW) con pistas en filas, compases en columnas, secciones arriba y playhead. Cada bloque **es** un brazo del `arrange([n, patrón], …)` de esa pista: el código sigue siendo la verdad y todo compila al único string de Strudel (regla 1) → cambia exacto en el compás y suena igual en vivo que al exportar. No es un multipista de audio. La Fase 0 no dibuja nada nuevo: deja **un solo reloj y una sola fuente de verdad** para que la vista no herede fallos.

---

## Lo que hay hoy (verificado)
- **Canción**: `src/store/useSongStore.ts` (pasos `{scene, bars}` + `loop`, localStorage `telar.song.v1`) y `src/ui/SongTimeline.tsx` (rAF + `getScheduler().now()`; dispara la escena de cada sección ~90 ms antes; «⇋ instrumentos» llama a `alignArrangeToBars`).
- **Escenas**: `src/store/useScenesStore.ts` (localStorage `telar.scenes.v1`; estado de mezcla por **nodeId** + máster sin pads momentáneos).
- **Secciones por instrumento**: `arrange(...)` en el código de cada Source. Se editan en `src/nodes/ArrangeStrip.tsx` (●/○ y compases) y en las pestañas de sección de `src/nodes/StepSeq.tsx`.
- **Proyecto**: `ProjectSnapshot` en `src/lib/projectStore.ts`; lo arman `ProjectMenu.currentSnapshot()` (exportar JSON, compartir URL, galería) y el autoguardado (`useGraphStore.subscribe` → `saveProjectDebounced`); lo carga `loadSnapshot` (`useGraphStore.ts`, también desde URL compartida, galería, demos, NodIa).

## Fallos que resuelve (con evidencia)
1. **Dos relojes.** `SongTimeline` toma `start = getScheduler().now()` al pulsar ▶ canción; los `arrange` corren desde el ciclo 0 absoluto. Con el transporte ya sonando, secciones de mezcla e instrumentos quedan desfasadas (y a mitad de compás).
2. **Canción y escenas fuera del proyecto.** `ProjectSnapshot` no las tiene; exportar/compartir/galería no las llevan; `loadSnapshot` no las toca → al importar se pierden, al cargar otro proyecto quedan las del anterior (con nodeIds que ya no existen).
3. **Parser de `arrange` frágil y duplicado.** `stepseqCode.splitArrange` cuenta `< >` como corchetes: el `>` de una flecha (`x=>x.ply(3)`) lo descuadra → devuelve `null` → `alignArrangeToBars` cree que el source es plano y **anida** el arreglo (`arrange([8, arrange(…)], …)`; reproducido). `ArrangeStrip` tiene otro parser (`parseArrange/splitTop`: comillas + `()[]{}`).
4. **○ borra el patrón.** `ArrangeStrip.toggle` cambia la sección por `silence`; al volver a ● se siembra con otra sección o `s("bd*4")`.

---

## 0.1 · Canción y escenas dentro del proyecto
- **Archivos:** `src/lib/projectStore.ts`, `src/ui/ProjectMenu.tsx`, `src/store/useGraphStore.ts` (`loadSnapshot`, autoguardado), `src/store/useSongStore.ts`, `src/store/useScenesStore.ts`, tests nuevos.
- **Hacer:**
  - `ProjectSnapshot.song?: { steps: SongStep[]; loop: boolean }` y `ProjectSnapshot.scenes?: Record<number, Scene>`.
  - Incluirlas en `currentSnapshot()` y en el autoguardado (suscribir también `useSongStore` y `useScenesStore` al guardado debounced).
  - `loadSnapshot`: si el snap las trae, cargarlas en sus stores; si no, **vaciarlas** (eran de otro grafo). Acciones `setAll`/`replace` en ambos stores.
  - Migración: si el proyecto guardado no las trae pero existen `telar.song.v1` / `telar.scenes.v1`, adoptarlas una vez (no borrar las claves viejas).
- **Tests:** ida y vuelta snapshot → stores → snapshot; cargar un snap sin `song` deja la canción vacía.
- **Aceptación:** exportar JSON → importar en un navegador limpio = misma canción y escenas; cargar otro proyecto no arrastra las del anterior; un enlace «compartir» las lleva.
- **Commit:** `feat(proyecto): la canción y las escenas viajan con el proyecto`

## 0.2 · Un solo reloj
- **Archivos:** `src/ui/SongTimeline.tsx` (y lo mínimo en `useGraphStore.play/stop`).
- **Hacer:** ▶ canción con el transporte sonando = `stop()` + `play()`: el scheduler vuelve a 0 (`cyclist.stop()` pone `lastEnd = 0`), así canción y `arrange` cuentan desde el mismo compás 1. El motor de secciones usa `elapsed = now` (sin `start` propio). Aviso si el total de compases de la canción ≠ total del `arrange` de algún instrumento.
- **Aceptación (oído):** con todo sonando, ▶ canción arranca en el compás 1 y cada cambio (escena + instrumentos) cae junto en el 1, también en la segunda vuelta del loop.
- **Commit:** `fix(canción): un solo reloj — la canción arranca en el compás 1 junto a los arrange`

## 0.3 · Un solo parser de `arrange`
- **Archivos:** `src/nodes/stepseqCode.ts`, `src/nodes/ArrangeStrip.tsx`, `tests/stepseq.test.ts`.
- **Hacer:** `splitArrange` pasa a saltarse el contenido de los strings (`" ' \``) y a contar solo `() [] {}` fuera de ellos (nunca `< >`). Portar `ArrangeStrip` a `splitArrange` + `spliceArm`/`setArmBars`/`addSilentArm` y borrar `parseArrange/splitTop`.
- **Tests:** flechas dentro de un brazo (`sometimesBy(0.3, x=>x.ply(2))`), comparaciones (`x<3`), comas en strings (`note("[c3,e3,g3]")`, `s("bd, hh")`), `<…>` de mini-notación; re-alinear dos veces no anida. Todo `tests/stepseq.test.ts` sigue pasando.
- **Aceptación:** ⇋ instrumentos dos veces seguidas sobre un source con `x=>…` deja N secciones planas (no anidadas) y suena igual.
- **Commit:** `fix(arreglo): un solo parser de arrange — flechas y strings ya no lo descuadran`

## 0.4 · Apagar una sección sin perder su patrón
- **Archivos:** `src/nodes/stepseqCode.ts`, `src/nodes/ArrangeStrip.tsx`, `src/nodes/StepSeq.tsx` (las comparaciones `=== 'silence'`).
- **Hacer:** helpers `isSilentArm` (`silence` o termina en `.mask(0)`), `muteArm` (añade `.mask(0)`), `unmuteArm` (lo quita). ○ = `muteArm`, ● = `unmuteArm`. `.mask(0)` silencia la sección igual que `silence` (verificado en Strudel: 16 eventos en ambos casos).
- **Aceptación:** ○ y luego ● devuelve EXACTAMENTE el patrón de esa sección; el arreglo suena igual que antes de apagarla.
- **Commit:** `feat(arreglo): apagar una sección no borra su patrón`

---

## No entra en la Fase 0
Vista DAW, seek, loop de región, automatización, exportar canción y stems (Fases 1–3).

## Para orientar decisiones (Fase 1 en adelante)
- Vista `mode: 'daw'` (ojo: `loadSnapshot` hoy sanea `mode` a `'standard' | 'dj'`).
- Playhead = `now() mod total`. «Tocar desde el compás N» = reinicio del transporte + `.early(N)` sobre el stack global, aplicado ANTES de `applyGlobalMaster` (el ancla del ½ tiempo es absoluta).
- Loop de región: `.ribbon(a, n)` (existe en `@strudel/core` 1.2.6).
- Exportar canción: grabar N compases exactos desde 1 con el tap post-máster (como el freeze, que ya alinea al ciclo); stems por pista con el tap pre. `renderPatternAudio` de `@strudel/webaudio` (render offline) cierra el AudioContext en vivo y no incluye el bus de Telar → solo para más adelante.

## Cómo verificar sin oído
- `npm test` · `npm run build`.
- **Strudel real en Node** (para semántica de patrones): importar `@strudel/core`, `@strudel/mini` y `@strudel/transpiler` desde `node_modules` con un stub de `@kabelsalat/web` (hook `module.register` que resuelve ese import a `export class SalatRepl{}`), `await evalScope(core, mini)`, `evaluate(code)` → `pattern.queryArc(a, b)`. Correr con `node --import tsx --import <stub>.mjs script.mjs`.
- **Navegador headless** (audio y UI): Playwright con el Chromium del contenedor (`--no-sandbox --autoplay-policy=no-user-gesture-required`) contra `npm run dev`; desde la página, `await import('/src/store/useGraphStore.ts')`. **Reiniciar vite tras editar**: si no, el HMR deja instancias duplicadas de los módulos y las pruebas mienten. No dejar `playwright` en `package.json`.
