# Telar — Modo DAW · Fase 2 (estructura + puente con la vista estándar)

**Aprobada por Carlos el 2026-10-25** («termina el DAW y luego lo pulimos»). **Hecho:** 2.1 (`041d924`) · 2.2 (`ec3e251`) · 2.3 (`8114a69`) · 2.4. Protocolo de `CLAUDE.md`: una tarea por commit → `npm run build` + `npm test` → verificación sin oído (Node + Chromium headless) → lo que falta escuchar va a `escuchas-pendientes.md`. Orden fijo: 2.1 → 2.2 → 2.3 → 2.4 → 2.5.

**Qué entrega:** que el DAW sirva para ARMAR la canción, no solo para verla: editar secciones (duplicar, vaciar, borrar, alargar, mover, renombrar), copiar y pegar bloques, loop de una región, y el puente con la vista estándar: crear la estructura de un tema que hoy es un jam de bucles y **grabar el jam en la canción** (como el paso sesión → arreglo de Ableton). La verdad sigue siendo el código: cada operación edita los `arrange` de las pistas y los pasos de la canción **en un solo paso deshacible**.

**No entra:** automatización, exportar canción/stems (Fase 3). Cambiar el tempo por sección.

---

## Base (Fases 0 y 1)
- Secciones: `useSongStore.steps` (`{id, scene, bars}`); reloj = scheduler (+ `from`). Brazos por pista: `splitArrange` + `spliceArm`/`setArmBars`/`duplicateArm`/`addSilentArm`/`removeArm`/`wrapAsArrange`/`alignArrangeToBars` (`src/nodes/stepseqCode.ts`).
- Vista: `src/ui/DawView.tsx` + `src/lib/dawModel.ts` (bloques, `toggleBlockCode`, `playheadAt`); `playFrom` en `src/lib/songTransport.ts`; `applyStartBar` en `compile.ts`.
- Historial: `pushPast(force, withExtras)`; una entrada con `extras` (canción + escenas) se deshace junto con los nodos, pero `applyExtras` → `useSongStore.replace` **detiene** la canción (pensado para cargas).

## 2.1 · Motor de edición de la estructura (puro) + un paso deshacible
- **Archivos:** `src/lib/arrangeEdit.ts` (nuevo), `src/store/useGraphStore.ts` (`applyArrangement`), `src/store/useSongStore.ts` (`setSong` sin detener; `name` opcional en el paso), `src/lib/projectStore.ts` (`sanitizeSong` guarda `name`), tests.
- **Hacer:**
  - Estado `{steps, codes}` → operaciones puras: `alignAll` (las planas se envuelven con las secciones de la canción y suenan igual; menos brazos → se completan; más → no se tocan y se informan), `duplicateSection`, `insertEmptySection`, `deleteSection`, `resizeSection`, `moveSection` (reordena brazos por span, sin tocar lo que va fuera del `arrange(...)`), `renameSection`, `setSectionScene`. Cada una alinea primero; nunca deja una pista desfasada.
  - `applyArrangement(codes, steps)`: **una** entrada de historial (nodos + canción) y un recompile; deshacer/rehacer devuelve código y canción **sin detener** lo que suena (`live` en la entrada).
  - `SongStep.name` (marcador): la etiqueta es `name` → nombre de la escena → «escena N». Viaja en el proyecto.
- **Tests:** cada operación sobre pistas planas, arregladas, con brazos apagados y con flechas `x=>…`; la canción y los brazos quedan con el mismo total; mover ida y vuelta = idéntico; pistas con más brazos quedan fuera.
- **Commit:** `feat(daw): motor de edición de secciones (deshacible)`

## 2.2 · Secciones editables en la vista DAW + crear la estructura
- **Archivos:** `src/ui/DawView.tsx`, `DawView.css`, `src/ui/SongTimeline.tsx` (nombre de sección y «abrir en DAW»).
- **Hacer:**
  - Clic en una sección = **seleccionarla** (el ▶ desde un compás queda en la regla de números y en el botón ▶ de la sección). Barra de la sección: nombre (editable), escena 1–9, − / + compases, ◀ ▶ mover, ⧉ duplicar, ✚ vacía después, ✕ borrar, ▶ tocar desde aquí. Atajos con la sección seleccionada: Ctrl+D duplicar, Supr borrar, ← → mover.
  - Sin canción: «crear estructura» con plantillas (techno 16·8·16·8·16·16, corta 8·8, «una por escena» si hay escenas capturadas). Las pistas planas quedan envueltas y suenan igual en todas las secciones; luego se apaga lo que sobra con un clic.
  - «⇋ alinear» en la cabecera cuando hay pistas planas o desfasadas.
- **Aceptación:** con el tema de las aves (12 pistas planas) → «crear estructura» → 6 secciones, todo suena igual que antes; apagar bloques arma el tema; Ctrl+Z deshace cada paso sin cortar el audio.
- **Commit:** `feat(daw): secciones editables y crear estructura`

## 2.3 · Bloques: copiar, pegar, vaciar, duplicar y editar en la vista estándar
- **Archivos:** `src/ui/DawView.tsx`, `src/lib/dawModel.ts`, `src/store/useUiFocusStore.ts` (nuevo, pedido de foco), `src/App.tsx`, `src/nodes/StepSeq.tsx`.
- **Hacer:** clic sigue siendo ○/●. Clic derecho (o mantener pulsado) = menú del bloque: encender/apagar · copiar · pegar aquí · vaciar · duplicar en la sección siguiente · **editar en la vista estándar**. Con un bloque enfocado: Ctrl+C / Ctrl+V / Supr / E. «Editar» cambia a la vista estándar, centra el nodo, lo abre con el secuenciador y selecciona esa sección.
- **Aceptación:** copiar el hat del drop y pegarlo en el build suena igual que en el drop; «editar» abre el nodo en esa sección.
- **Commit:** `feat(daw): copiar, pegar y editar bloques`

## 2.4 · Loop de región
- **Archivos:** `src/store/useSongStore.ts` (`region`), `src/graph/compile.ts` (`applyTimeline`: `.ribbon(start, n)` o `.early(from)`), `src/lib/songClock.ts` (posición de canción con región), `src/ui/SongEngine.tsx`, `src/ui/DawView.tsx`, `src/nodes/StepSeq.tsx`, tests.
- **Hacer:** arrastrar sobre la regla de números marca una región; ⟳ (o L) la activa: suena en bucle esa región (escenas incluidas) y la línea vuelve al inicio de la región. Desactivarla sigue desde el compás donde iba. ■ no la borra.
- **Tests:** `.ribbon` solo con región activa y por dentro del máster; posición de canción dentro de la región.
- **Aceptación (oído):** región = drop → el drop se repite sin saltos y con su escena.
- **Commit:** `feat(daw): loop de región`

## 2.5 · Grabar el jam en la canción (sesión → arreglo)
- **Archivos:** `src/lib/jamRecorder.ts` (nuevo: muestreo por compás + armado), `src/ui/DawView.tsx`, `src/ui/SongTimeline.tsx`, tests.
- **Hacer:** «● grabar jam» (DAW y panel canción): reinicia en el compás 1 y en cada compás anota la escena activa y qué pistas se oyen (mute/solo). Al parar: compases iguales seguidos → una sección (máx. 64), la canción toma esas secciones (escena + nombre «parte N») y cada pista plana queda con un brazo por sección: su patrón donde sonaba, apagado (`.mask(0)`) donde no. Pistas que ya tenían secciones propias no se tocan (se avisa). Un solo paso deshacible.
- **Tests:** armado desde una grabación sintética (escenas y mutes) → secciones y brazos esperados; compases > 64 se parten.
- **Aceptación (oído):** tocar el jam de las aves 2 min con el M-Wave (escenas + mutes) → la canción reproduce lo mismo.
- **Commit:** `feat(daw): grabar el jam en la canción`

---

## Decisiones tomadas
- Toda edición de estructura alinea antes: canción y pistas tienen siempre las mismas secciones (si no, la segunda vuelta se desfasa).
- Un bloque vacío es `silence`; apagado es `.mask(0)` (conserva el patrón). Vaciar = `silence` explícito.
- Las escenas siguen siendo la MEZCLA de cada sección; los bloques son QUÉ suena. Un bloque que la escena silencia se marca como tal.
