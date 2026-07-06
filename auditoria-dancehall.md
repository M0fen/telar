# Auditoría Telar × Latin Dancehall PRO — julio 2026

**Método:** código leído de verdad (`compile.ts`, `engine.ts`, `StepSeq.tsx`, `MelodicSeq.tsx`, `useGraphStore.ts`, `useScenesStore.ts`, `SongTimeline.tsx`, `freeze.ts`, `audioRecorder.ts`, `catalog.ts`, `instrumentKits.ts`, demos json) + semántica verificada contra las fuentes reales de `@strudel/core` y `superdough` en `node_modules` (líneas citadas). Vara: riddim de latin dancehall a nivel comercial (pocket dembow, bajo de sound-system, bubble, aire para la voz).

**Formato:** cada hallazgo → qué falla · por qué importa para dancehall · archivo · solución · criterio de aceptación. `[NUEVO]` = aporte de esta auditoría; `[CONFIRMA]` = ya documentado, se añade profundidad.

---

## Resumen ejecutivo

Telar ya tiene los LADRILLOS de un riddim pro (dembow programable con acentos/rolls/prob, 808 con pitch y slide, sidechain por kick real, EQ por canal, bus de máster completo, autotune real, LUFS). Lo que lo separa de "pro de verdad" son **tres cosas de fondo**, todas nuevas:

1. **La dinámica programada muere al mezclar** (P0.1): cualquier `.gain()` externo (fader de canal, humanize del máster, auto-master) **reemplaza** —no multiplica— los acentos/velocity internos. El groove que construyes en el secuenciador se borra en cuanto tocas la mezcla. Es el hallazgo más grave y explica por qué las demos "suenan planas" con humanize activo.
2. **El swing swinguea la subdivisión equivocada** (P0.2): corcheas en vez de semicorcheas. El tumbao del dembow vive en la semicorchea; el swing actual no lo produce.
3. **El arreglo no puede cambiar material… pero el motor sí puede** (P0.3): la propia demo `telar-latin-dancehall.json` ya usa `arrange([4,…],[12,…])` escrito a mano — y ningún editor de Telar lo puede ver ni editar. La vía del arreglo pro existe y está huérfana.

---

## P0 — Bloquea hacer dancehall pro hoy

### P0.1 · `[NUEVO]` El `.gain()` de mezcla PISA la dinámica programada (acentos, velocity, balance)

> **✅ APLICADO** — commits `df43e93` (a/b/c) y `670e2f5` (d). Nota de implementación: en vez de `postgain`/bus se usó **`.mul(gain(x))` / `.mul(velocity(x))`** — verificado contra `@strudel/core` que `mul` MULTIPLICA la clave si el evento la trae y la FIJA si falta (= idéntico al comportamiento previo para eventos sin gain propio). Ventajas sobre la propuesta original: auto-master queda correcto sin tocar el motor ni el tap del LUFS, y no colisiona con el `postgain(1.4)` del pulir voz. El caso (d) creció al implementarlo: `parseStackForm` además **descartaba** los sufijos por segmento (`.bank`/`.room`/… de los kits) al reconstruir — ahora se preservan verbatim (`Lane.sfx`, módulo puro `stepseqCode.ts` + 12 tests de round-trip).

**Semántica verificada:** en Strudel los controles encadenados se combinan con `pat.set(...)` (`@strudel/core/controls.mjs:48`) y el operador `set` resuelve colisión de clave como *"el segundo gana"* (`pattern.mjs:1064` zona de ops; verificado antes en `set: [(a,b)=>b]`). **Dos `.gain()` en la misma cadena NO se multiplican: el externo borra al interno.** Este bug ya se corrigió en el groove por pista (StepSeq emite `.velocity()` — superdough hace `gain *= velocity`, `superdough.mjs:611`) pero quedó vivo en **cuatro sitios**:

| Instancia | Emisión | Efecto real |
|---|---|---|
| **(a) Fader de canal** | `compile.ts:608-612` → `applyMaster('(inner)', {gain: chGain})` → `.gain(0.7)` al final del source | Mover el fader ≠1 **borra** los acentos/ghosts del StepSeq (`.gain("1 1.4 0.5 …")`) y la lane de velocity del MelodicSeq. Mezclar destruye el groove. |
| **(b) Humanize del máster** | `compile.ts:393-396` → `.gain(rand.range(1-h·0.35, 1))` sobre el stack completo | **Borra el balance de TODOS los canales.** Ej. real: `telar-latin-dancehall.json` tiene `humanize: 0.08` y hats a `gain(0.2)` → el humanize los reemplaza por ~0.97: los hats suenan ~5× más fuerte de lo mezclado. La demo insignia de dancehall sale con la mezcla rota de fábrica. |
| **(c) Auto-master** | `useGraphStore.ts:516-551` converge LUFS ajustando `master.gain` → `compile.ts:418` emite `.gain(x)` global | Mientras "masteriza", **aplana el balance** de todos los canales a un mismo gain. El LUFS aterriza pero la mezcla ya no es tu mezcla. |
| **(d) Cola escalar del código** | `s("hh*8").gain(0.35)` en el `tail` que StepSeq preserva → queda DESPUÉS del `stack(…)` re-emitido | Un `.gain` escalar heredado del kit pisa los acentos de todas las pistas de la rejilla. Los kits de `instrumentKits.ts` traen varios (`.gain(0.85)`, `.gain(0.35)`…). |

**Por qué importa para dancehall:** el género ES dinámica — ghost notes del shaker, acento del rim, caja que respira. Hoy todo eso sobrevive solo si nadie mezcla. Es exactamente lo contrario del flujo pro (programar → mezclar → pulir).

**Solución (respeta la arquitectura — mezcla al bus, patrón al patrón):**
1. **Fader de canal** → emitir `.postgain(x)` en vez de `.gain(x)` (`postgain` es clave aparte y es un GainNode al final de la cadena de voz, `superdough.mjs:925` — multiplicador limpio). Colisión conocida: el "pulir" de voz emite `.postgain(1.4)` (`compile.ts:372`) — el compilador conoce ambos valores: **componer el producto en una sola emisión** (`postgain(1.4 * fader)`).
2. **Gain del máster** → NO emitirlo en el patrón: moverlo al **bus real** (un GainNode `masterGain` en `engine.ts` junto a `makeup`, ajustado por `setMasterBus`). Auto-master pasa a ajustar ese nodo → deja de tocar el patrón. (Regla 2 de CLAUDE.md: lo de mezcla, al bus.)
3. **Humanize del máster** → `.velocity(rand.range(…))` como ya hacen las lanes (documentar que pisa el velocity de lane si ambos activos, o componer en compilador).
4. **Cola escalar** → en `StepSeq.splitTail`, extraer también `.gain(<número>)` escalar del tail y multiplicarlo dentro de los strings de gain por pista al re-emitir.
5. **Test:** unit test del compilador que afirme que el código emitido nunca contiene dos `.gain(` en la misma cadena de un source ni un `.gain(` a nivel de máster.

**Criterio de aceptación (que suene):** con una rejilla con acento+ghost, mover el fader del canal a 0.5 **mantiene audible** la diferencia acento/ghost (solo baja el conjunto). Activar humanize del máster no cambia el balance hats/kick. Correr auto-master no altera el balance relativo entre canales (verificable a oído y con los VU por canal).

---

### P0.2 · `[NUEVO]` El swing va en corcheas; el dembow vive en semicorcheas

> **✅ APLICADO** — commit `d4a9f62`: rejilla `n = pasos/2` (16 → 8), máster `n = 8`, comentario corregido, tests de emisión y round-trip.

**Verificado:** `swingBy(x, n)` parte el ciclo en `n` rebanadas y retrasa la segunda mitad de cada una (`@strudel/core/pattern.mjs:2178-2184`). Telar emite **siempre `n = 4`** — en el StepSeq por pista (`StepSeq.tsx:280`) y en el máster (`compile.ts:392`, cuyo comentario dice "sobre semicorcheas" y es incorrecto). Con 4 rebanadas por ciclo (= por compás), lo que se retrasa es la **corchea off** — y en una rejilla de 16 pasos arrastra los pasos 3-4 de cada negra JUNTOS, en bloque.

**Por qué importa:** el shuffle del dancehall/dembow (y del reggaetón moderno) es swing de **semicorchea**: la 2ª semicorchea de cada corchea entra tarde. Con el swing actual los hats en semicorcheas no se "tumban" entre sí; el resultado es un vaivén torpe de corcheas que ningún riddim usa.

**Solución:** el `n` debe seguir la resolución de la rejilla: en `grooveSfx` emitir `swingBy(x, steps/2)` (16 pasos → `n=8` = swing de semicorcheas; 8 pasos → `n=4` = corcheas, correcto para ese caso). En el máster, exponer "swing 8ª/16ª" o fijar `n=8` (el caso 16 pasos es el estándar del género). Corregir el comentario de `compile.ts:389-392`.

**Criterio de aceptación:** con `hh` en los 16 pasos y swing ~0.5, cada PAR de semicorcheas suena `larga-corta` (shuffle clásico); el kick del beat no se mueve. A/B contra `.swingBy(1/3, 8)` escrito a mano: idéntico.

---

### P0.3 · `[CONFIRMA techo, NUEVO diagnóstico y salida]` El arreglo pro ya existe en el motor (`arrange`) pero es invisible e ineditable

**Verificado:** las escenas capturan SOLO mezcla (`useScenesStore.snapshotState`: mute/solo/gain/chFilter/params — ni `code`, ni `eq`, ni máster) y la SongTimeline encadena escenas por compases (`SongTimeline.tsx`). Pero la demo `telar-latin-dancehall.json` resuelve el arreglo REAL de otra forma: cada source es `arrange([4, s("bd …")], [12, s("bd … bd ~")], …)` — intro/desarrollo con material distinto por sección, dentro de UN string, determinista y sample-accurate. **Ese código no lo puede editar nadie:** StepSeq se rinde ("patrón avanzado"), MelodicSeq no encuentra el `note()`, y solo queda el editor de texto.

**Por qué importa:** el arreglo dancehall (intro → verso limpio para la voz → drop → breakdown) exige cambiar MATERIAL (el bajo entra, la caja cambia de patrón), no solo mutear. Hoy la única vía es escribir `arrange` a mano — o sea, la feature más importante del arreglo es para expertos en Strudel, no para usuarios de Telar.

**Solución — "variantes por sección" (encaja 100% en la arquitectura):**
1. `NodeData` gana `variants?: { name: string; code: string }[]` + `activeVariant?: number`. El editor/rejilla edita SIEMPRE la variante activa (un patrón simple → los parsers actuales funcionan sin cambios).
2. La SongTimeline pasa de `(escena × compases)` a `(escena × compases × variante-por-source opcional)`. El **compilador** emite por source: `arrange([bars₁, varA], [bars₂, varB], …)` cuando hay canción activa; sin canción, la variante activa sola. Sigue siendo UN string → hot-swap intacto, export intacto.
3. Migración: al cargar un source cuyo código ya es `arrange(...)`, ofrecer "separar en variantes" (parsear los brazos del arrange — son expresiones normales).

**Criterio de aceptación:** construir intro (4 compases, sin bajo, hats suaves) → drop (8, todo) → breakdown (4, skank+voz) SIN escribir código; darle play a "canción" produce el mismo audio en cada pasada; la rejilla edita el patrón de la sección 2 sin tocar las otras.

---

## P1 — Eleva de "suena bien" a "suena pro"

### P1.1 · `[NUEVO]` Sin mono-bajo: el width del máster des-monoiza el sub

**Verificado:** el bloque M/S del bus (`engine.ts:366-383`) escala el canal *side* **full-band**. Con `width > 1`, el contenido <120 Hz gana componente side → el sub pierde pegada en mono (sound-system, club, teléfono) y puede cancelar.

**Por qué importa:** es música de sound-system; la regla nº1 de la mezcla dancehall es bajo mono y centrado. Hoy "ensanchar el máster" (gesto natural para pads/hats) castiga el bajo sin que el usuario lo sepa.

**Solución:** crossover en el bloque M/S: `side → highpass 120 Hz → sideW` (un BiquadFilterNode highpass en la rama side basta: el side <120 Hz se descarta → graves mono por construcción). Opcional: knob "mono por debajo de" (80–200 Hz).

**Criterio de aceptación:** con width 1.6 y un sub en c1, la señal <120 Hz queda idéntica en L y R (correlación 1.0 — verificable grabando y mirando, o a oído en mono: el sub no cambia al pasar de estéreo a mono).

### P1.2 · `[NUEVO]` No hay micro-timing determinista por paso (el pocket)

El groove actual = swing global de pista + `late(rand…)` aleatorio (además siempre TARDE, nunca temprano — `rand.range(0, h)`, `StepSeq.tsx:284`). No existe "esta caja concreta entra 12 ms atrás" — el push/pull deliberado que distingue el pocket pro del cuantizado.

**Solución (barata, mecanismo ya probado):** sub-fila "timing" en StepSeq (como la de pitch) que emita un patrón paralelo `.late("0 0.01 0 -0.006 …")` alineado a los pasos — mismo patrón de emisión que `.gain("…")`/`.clip("…")` del MelodicSeq. Valores ±0.02 de ciclo. De paso, centrar el humanize: `rand.range(-h/2, h/2)`.

**Criterio de aceptación:** arrastrar el rim del backbeat +10 ms y oírlo "sentado atrás"; ponerlo a 0 y volver al grid. El humanize deja de arrastrar el patrón entero hacia tarde.

### P1.3 · `[NUEVO]` El delay dub está (sincronizado y todo) pero sin control de tiempo ni "throw"

**Verificado:** superdough sincroniza el delay al tempo POR DEFECTO: `delaysync: 3/16` de ciclo (`superdough.mjs:194,503`) = corchea con puntillo — **exactamente el tiempo del dub delay**. Telar emite solo `.delay(x).delayfeedback(y)` (`compile.ts:273-276`): buen default, pero no hay forma en la UI de elegir 1/8, 1/4 o tresillo, ni de hacer el gesto rey del dancehall: el **throw** momentáneo (mandar UNA palabra/golpe al eco). `perf.echo` existe pero vive en el modo DJ (congelado).

**Solución:** (1) selector de subdivisión en la sección "espacio" del synth/voz → `.delaysync(1/8 | 3/16 | 1/4 | 1/6)`; (2) botón momentáneo "eco" en el canal estándar (misma emisión que `perf.echo`, `compile.ts:592-597`, fuera del modo DJ — infra ya escrita).

**Criterio de aceptación:** a 96 y a 140 BPM el eco cae en el grid sin tocar nada; mantener pulsado "eco" sobre el skank produce el throw clásico y al soltar limpia.

### P1.4 · `[NUEVO]` La percusión latina existe pero no se puede añadir desde la rejilla

**Verificado:** el prebake carga `crate` (crate_conga, crate_bongo, crate_sh, crate_clave, crate_djembe, crate_block) y `vcsl` (conga, bongo, darbuka, framedrum, timpani) — `engine.ts:180-191`, `catalog.ts:36-45`. Pero la paleta del StepSeq ofrece SOLO 12 abreviaturas de drum-machine (`StepSeq.tsx:88-93`). Añadir una conga = escribir código. Y el kit "dembow riddim" (`instrumentKits.ts`) trae bd/sd/hh pelados — sin capa latina, que es lo que separa amateur de pro en este género.

**Solución:** (1) la paleta "+ añadir sonido" gana un campo de búsqueda sobre el catálogo completo (drum-machines + packs + samples del usuario — la infra de nombres ya existe en `catalog.ts`/`useUserSoundsStore`); (2) kit nuevo "latin dancehall" en `URBAN_KITS`: dembow + `crate_conga` a contratiempo + `crate_sh` en semicorcheas con ghosts + skank offbeat `[c4,eb4,g4]` + one-drop variante.

**Criterio de aceptación:** añadir "conga" como pista de la rejilla en ≤2 clics; el kit nuevo suena a riddim (no a metrónomo) recién soltado.

### P1.5 · `[NUEVO]` Velocity por paso de 3 niveles se queda corto para percusión viva

StepSeq cicla normal→acento→ghost (1 / 1.4 / 0.5, `StepSeq.tsx:27`). El shaker/conga pro necesita dinámica CONTINUA (la mano no tiene 3 niveles). MelodicSeq ya tiene lane continua de velocity — la rejilla no.

**Solución:** sub-fila "vel" opcional en StepSeq (arrastre vertical por paso, como la lane del MelodicSeq) que escriba los valores exactos en el string de `.gain("…")` ya emitido. El ciclo de 3 niveles se mantiene como atajo.

**Criterio de aceptación:** dibujar un crescendo de shaker en 16 pasos y oír la rampa.

### P1.6 · `[CONFIRMA deuda, NUEVO ángulo]` La grabación final puede capturar glitches que no existen en el audio

`audioRecorder.ts` usa `ScriptProcessorNode` (main thread). Todo lo exportable pasa por ahí: el WAV del máster Y el freeze (`freeze.ts`). Bajo carga de UI (recompiles, React, viz) el callback se salta bloques → **el entregable final** (lo único que sale de Telar hacia el mundo) puede llevar cracks que los altavoces nunca reprodujeron.

**Solución:** AudioWorklet recorder (ring buffer + postMessage). Prioridad por delante de "export de stems": primero que UN stem salga limpio.

**Criterio de aceptación:** grabar 2 min moviendo perillas/abriendo paneles sin un solo drop (inspección del WAV: sin discontinuidades).

---

## P2 — Diferenciador / pulido

- **P2.1 `[NUEVO]` Escenas ciegas al máster y al EQ de canal:** `snapshotState()` no captura `master` ni `data.eq` → un "drop" no puede abrir el filtro del máster ni cambiar el EQ. Añadirlos (opt-in) a `SceneState`. *Criterio:* escena "break" con lpf de máster cerrado → al disparar "drop" se abre.
- **P2.2 `[NUEVO]` Banco por pista:** `.bank()` afecta TODA la rejilla (`StepSeq.setBank`). Strudel resuelve `bank` como prefijo del nombre → una pista puede emitir `s("RolandTR808_bd …")` para mezclar kick 808 con caja LinnDrum. Selector de banco por pista que reescriba el nombre del sonido. *Criterio:* kick 808 + rim Linn en la misma rejilla.
- **P2.3 `[NUEVO]` Trigger de canción con jitter de frame:** `SongTimeline` dispara escenas desde rAF → hasta ~16 ms + swap tarde respecto a la frontera de compás. Calcular la frontera con `scheduler.now()` y programar el swap anticipado. *Criterio:* el cambio de sección cae consistente en el 1.
- **P2.4 `[NUEVO]` Un AnalyserNode + FFT por source SIEMPRE:** `compile.ts:615` añade `.analyze("telar-src-…")` a todo source aunque esté colapsado y sin VU visible. Con 10+ sources es CPU regalada. Emitir el tap solo si el nodo está expandido o su scope activo (ya existe el flag `showScope`). *Criterio:* proyecto de 12 sources colapsados baja el uso de CPU de audio de forma medible.
- **P2.5 `[NUEVO]` Freeze cap 16 ciclos** (`freeze.ts:29`): una sección de 16 compases a 4/4 no cabe. Subir el clamp (o derivarlo de la sección de canción seleccionada). *Criterio:* congelar una sección completa de la canción.
- **P2.6 `[CONFIRMA]` Plataforma:** VoiceStudio ~900 líneas (dividir por secciones ya autocontenidas: transporte/autotune/comping), tokenización de color a medias (`theme/tokens.ts` existe — completar la migración), samples locales no viajan al compartir (subir a R2 — ya hay `cloudBank`), desktop-only. Ninguno bloquea el sonido; ordenados aquí por honestidad, no por urgencia.

---

## Lo que está BIEN y no hay que tocar (verificado, base del tutorial)

- **Sidechain por kick real** (`.duck` por orbit, `compile.ts:452-474` + `superdough.mjs:511-512`) — el pump del bajo dancehall, resuelto como debe ser.
- **808 con pitch por paso + slide** (`penv/pdecay`, MelodicSeq slider "slide") y **cowbell/sample afinado** con `note()` — verificados en emisión.
- **EQ por canal con Biquads reales por orbit** + kill −30 dB, **bus de máster** completo (M/S → punch → EQ → sat → glue → limiter), **LUFS BS.1770** con auto-master (una vez arreglado P0.1c).
- **Delay sincronizado 3/16 por defecto** — dub delay de fábrica (falta solo la UI, P1.3).
- **Rejilla**: acentos, rolls (`*N`), probabilidad (`?p`), acordes diatónicos, scale-lock, groove por pista, banco global, "en vivo".
- **Autotune real** (YIN → snap → Rubber Band con formantes), comping, gate — la cadena de voz.
- **Los 4 demos del linaje** (latin dancehall 102, dembow dominicano, reggaetón clásico 92, dembow latino 96) como material de deconstrucción.

## Orden de ejecución sugerido

1. ~~**P0.1** — desbloquea que mezclar no destruya el groove.~~ **✅ HECHO** (`df43e93`, `670e2f5`).
2. ~~**P0.2** — el shuffle correcto.~~ **✅ HECHO** (`d4a9f62`).
3. **P1.3** y **P1.4** (baratos, retorno alto inmediato para el género). ← **SIGUIENTE**
4. **P0.3** (variantes por sección — la feature grande; diseñarla con plan aparte).
5. **P1.1, P1.2, P1.5** (mezcla/pocket fino), luego **P1.6** y P2s.

### Cómo ESCUCHAR lo aplicado (revisión del usuario)

1. **Balance con humanize (P0.1b):** carga la demo **"latin dancehall"** → play. Los hats deben oírse DISCRETOS (gain 0.2), no al nivel del kick. Sube/baja "humanize" del máster: el balance no debe moverse (antes los hats saltaban a ~5×).
2. **Acentos vs fader (P0.1a):** rejilla con acento+ghost en una pista (clic derecho) → baja el fader de ese canal a la mitad → la diferencia acento/ghost debe seguir oyéndose (antes se aplanaba).
3. **Kits (P0.1d):** suelta el kit "dembow riddim", edita cualquier paso en la rejilla → el banco RolandTR808 y los niveles deben mantenerse (antes: al primer clic todo saltaba al banco por defecto y a todo volumen).
4. **Swing (P0.2):** hats en 16 pasos, swing ~0.5 en ≋ → shuffle real par-a-par (larga-corta), el kick no se mueve.
