# Telar — Modo DAW · Fase 1 (la vista)

**Hecha** — 1.1 hecha (vista + botón «daw»; el motor de la canción salió a `ui/SongEngine` para que siga sonando en cualquier vista) · 1.2 hecha (línea de reproducción: `playheadAt` + rAF con `transform`) · 1.3 hecha (clic en un bloque = `toggleBlockCode`: ○/● del brazo o, si está vacío, entra con el patrón de `seedArm`; deshacer con Ctrl+Z) · 1.4 hecha (clic en la regla o en una sección = `playFrom`: reinicia el transporte con `from`, `applyStartBar` emite `.early(from)` dentro del máster, la canción/playhead/sección viva de StepSeq suman `from`; ■ y ▶ canción lo vuelven a 0 y ■ suelta el ½ tiempo). Plan verificado contra el código el 2026-10-25, tras `9193db0`, con la Fase 0 hecha. Protocolo de `CLAUDE.md`: **plan → OK de Carlos → una tarea por commit → `npm run build` + `npm test` → que lo escuche**. Orden fijo: 1.1 → 1.2 → 1.3 → 1.4.

**Qué entrega:** una tercera vista **DAW** (Estándar | DJ | DAW) donde ves la canción entera: pistas en filas, compases en columnas, secciones arriba y una línea de reproducción. Cada bloque es un brazo del `arrange([n, patrón], …)` de esa pista: clic = la pista entra o sale en esa sección; clic en la regla = tocar desde ese compás. Todo sigue compilando al único string de Strudel (regla 1), así que lo que ves es exactamente lo que suena.

**No entra:** editar la estructura (alargar/insertar/borrar secciones, alinear, loop de región) → Fase 2. Exportar canción/stems y automatización → Fase 3.

---

## Base que ya existe (Fase 0)
- Secciones de la canción: `useSongStore.steps` (`{scene, bars}`), viajan en el proyecto.
- Reloj único: `src/lib/songClock.ts` (`songPosition`, `songTotal`, `arrangeMismatches`); ▶ canción reinicia el transporte (ciclo 0 = compás 1).
- Brazos de cada pista: `splitArrange` (`src/nodes/stepseqCode.ts`, único parser) + `muteArm`/`unmuteArm`/`isMutedArm`/`isSilenceArm` (○ con `.mask(0)`, sin borrar el patrón).
- Edición de código con deshacer: `updateNodeData(id, { code })` (historial coalescido + recompile con throttle).
- Vistas: `mode: 'standard' | 'dj'` en `useGraphStore` (`setMode`, conmutador en `App.tsx`; `loadSnapshot` sanea el modo a esos dos).

## 1.1 · Vista DAW (solo lectura)
- **Archivos:** `src/lib/dawModel.ts` (nuevo, lógica pura), `src/ui/DawView.tsx` + `DawView.css` (nuevos), `src/App.tsx`, `src/store/useGraphStore.ts` (`mode`), tests nuevos.
- **Hacer:**
  - `mode: 'standard' | 'dj' | 'daw'`: botón «daw» en el conmutador, se guarda en el proyecto, `loadSnapshot` lo acepta. En DAW se montan `DawView` y el panel MIDI (como en DJ); deshacer/rehacer visibles también en DAW.
  - `buildDawModel(nodes, steps)` → secciones (de la canción; si no hay, derivadas del primer `arrange`, «sección 1…»), total de compases, y por pista sus brazos `{inicio, compases, estado: suena | apagada | vacía}`. Las pistas sin `arrange` son un bloque continuo «suena siempre». Marca las que no cuadran (`arrangeMismatches`).
  - `DawView`: regla de compases + franja de secciones (nombre de su escena), una fila por pista (nombre, mute, solo) con sus bloques; scroll horizontal y zoom (px por compás, recordado en localStorage).
- **Tests:** `buildDawModel` con pistas alineadas, planas, apagadas, vacías y desalineadas; sin canción.
- **Aceptación:** lo que muestra cada fila coincide con el código de esa pista; cambiar de vista no corta el audio; recargar mantiene la vista DAW.
- **Commit:** `feat(daw): vista DAW — pistas × compases sobre los arrange`

## 1.2 · Línea de reproducción
- **Archivos:** `src/ui/DawView.tsx`.
- **Hacer:** playhead con `requestAnimationFrame` leyendo `getScheduler().now()` (posición = `now mod total`, la misma que usa la canción). Se mueve con un `transform` sobre un solo elemento (sin re-renderizar la rejilla 60×/s); se resalta la sección que suena; auto-scroll suave cuando sale de la vista.
- **Aceptación (oído + vista):** la línea pasa por cada compás cuando suena; el resaltado cambia justo en el 1 de cada sección, también en la segunda vuelta del loop.
- **Commit:** `feat(daw): línea de reproducción`

## 1.3 · Encender / apagar bloques
- **Archivos:** `src/ui/DawView.tsx` (+ helper en `dawModel.ts` si hace falta).
- **Hacer:** clic en un bloque = `muteArm`/`unmuteArm` de ese brazo (un solo empalme de código vía `updateNodeData` → deshacer funciona). Un bloque **vacío** (`silence`) se enciende sembrado con el patrón de la primera sección que suena de esa pista (como la tira de secciones). Las pistas planas no se pueden partir aquí (Fase 2: «dividir en secciones»).
- **Tests:** ida y vuelta por bloque (código idéntico tras ○→●), bloque vacío sembrado.
- **Aceptación (oído):** apagar el bombo en el drop lo saca exactamente en ese tramo y vuelve igual al encenderlo; Ctrl+Z lo deshace.
- **Commit:** `feat(daw): encender y apagar bloques`

## 1.4 · Tocar desde un compás
- **Archivos:** `src/ui/DawView.tsx`, `src/store/useSongStore.ts` (`from`: compás de arranque, de ejecución, no se guarda), `src/store/useGraphStore.ts` (recompile/stop), `src/lib/songClock.ts`, tests.
- **Hacer:**
  - Clic en la regla (compás N) = reinicio del transporte + `from = N − 1`. El compilador aplica `.early(from)` al stack ANTES de `applyGlobalMaster` (el ancla del ½ tiempo es absoluta) y la canción/playhead usan `now + from`.
  - ■ del transporte vuelve `from` a 0 (el próximo ▶ empieza en el compás 1).
  - Al reiniciar el transporte se suelta el ½ tiempo (`half: 0`): su ancla era del reloj anterior y, si no, saltaría sola más adelante.
- **Tests:** `.early(from)` emitido solo con `from > 0` y por dentro del máster; `songPosition` con `from`.
- **Aceptación (oído):** clic en el compás del drop → suena el drop en el acto, escenas e instrumentos juntos; ■ y ▶ vuelve al compás 1; mantener ½ tiempo tras saltar funciona normal.
- **Commit:** `feat(daw): tocar desde cualquier compás`

---

## Decisiones tomadas (para no volver a discutirlas)
- La verdad es el código (`arrange` de cada pista). La vista no guarda un modelo aparte: se reconstruye de `nodes` + `steps` en cada cambio (`splitArrange` es lineal; memo por código).
- El playhead no es estado de React: un ref + `transform`, para no repintar la rejilla.
- Saltar de compás reinicia el transporte (como un DAW al pulsar play en otro punto), no hace un empalme en caliente.

## Cómo verificar sin oído
Igual que en `telar-daw-fase0.md` («Cómo verificar sin oído»): `npm test`, Strudel real en Node para la semántica (`.early(from)` + `arrange`), Chromium headless para la vista y el playhead (comparar la sección resaltada con el brazo que el patrón toca en ese ciclo). Reiniciar vite tras editar.
