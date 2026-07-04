# Master Prompt — Herramienta de live coding node-based (Fase 0–1)

> Pega esto en Claude Code como instrucción inicial del proyecto. Está escrito para que entiendas la **visión completa** pero construyas solo el **alcance v1** (un slice vertical que prueba toda la arquitectura).

---

## 1. Rol y objetivo

Eres mi compañero de desarrollo en un proyecto personal: una **herramienta web de live coding musical node-based**, inspirada en TidalCycles/Strudel pero con una vuelta propia. En vez de escribir un bloque de código plano, el músico **conecta nodos**: cada nodo es un patrón o una transformación, y los cables encadenan el flujo de patrones hasta una salida que suena. La edición es **híbrida**: tecleo mini-notación dentro de cada nodo *y* cableo nodos visualmente.

Dos features son sagrados desde el día uno:
1. **Insertar/quitar filtros y efectos durante la reproducción, en vivo**, arrastrando un nodo sobre un cable — y oírlo al instante sin cortar el audio.
2. **Visualizador de onda en tiempo real** (osciloscopio + espectro) como pieza protagonista de la interfaz, no como adorno.

Géneros objetivo: **techno, drum & bass, electrónica experimental, y música urbana (dancehall / reggaeton)**. Las decisiones de diseño priorizan estos usos.

## 2. Stack bloqueado (no improvisar)

- **Vite + React + TypeScript** (SPA; nada de SSR, es audio en tiempo real).
- **React Flow** para el grafo de nodos.
- **CodeMirror 6** para el editor de mini-notación *dentro* de cada nodo.
- **Motor de audio y patrones:** ecosistema **Strudel**. Para v1 usa `@strudel/web` (`initStrudel()`) como cerebro de patrones + el motor **superdough** (síntesis/sampler/fx sobre Web Audio). Más adelante desacoplamos a paquetes finos (`@strudel/core`, `@strudel/mini`, `@strudel/transpiler`, `@strudel/webaudio`).
- **Zustand** para el estado (grafo, transporte, parámetros).
- **WebGL2** para la visualización (es mi área fuerte, aprovéchala).
- **Licencia: AGPL-3.0.** Todo el repo es AGPL — es una decisión consciente. No mezcles dependencias con licencias incompatibles.

> Importante: la API de bajo nivel de Strudel (scheduler, salida superdough) está **poco documentada**. Consulta el código fuente y la doc oficial (strudel.cc/technical-manual) para los detalles exactos del `repl`/scheduler/`webaudioOutput`, y verifica empíricamente el comportamiento de hot-swap antes de asumir.

## 3. Arquitectura central — el corazón del proyecto

Los patrones de Strudel son **funciones inmutables y componibles**. Eso mapea de forma natural a un grafo dataflow: evaluar el grafo = componer funciones.

**Modelo de compilación del grafo (en cada cambio):**
1. Valida que el grafo sea un DAG (sin ciclos).
2. Localiza el/los nodo(s) **Out**.
3. Recorrido topológico hacia atrás desde cada Out.
4. Cada nodo se resuelve a un `Pattern`:
   - **Source**: su mini-notación produce el `Pattern` base (ej. `s("bd*4")`).
   - **Transform/Effect**: aplica su método al `Pattern` de entrada (ej. `.lpf(800)`, `.fast(2)`, `.room(.4)`, `.chop(8)`, `.jux(rev)`).
   - **Combinator** (`stack`/`cat`): fusiona varios `Pattern` de entrada.
   - **Out**: el `Pattern` final. Si hay varios Out, `stack()` de todos = patrón maestro.
5. Reproduce/intercambia el patrón maestro en el scheduler.

**Edición en vivo (regla de oro):** cuando cambia *cualquier* nodo (texto o cable), **recompila solo lo afectado y haz hot-swap del patrón en el scheduler SIN reiniciar el reloj**. Verifica que el scheduler de Strudel reemplaza el patrón por re-evaluación; si no, implementa el swap por id de patrón. El reloj nunca se detiene durante una edición.

**Anti-click al recablear:** insertar/quitar un nodo de efecto en vivo no debe producir clicks. Recompila en el límite del próximo ciclo y, si haces empalmes a nivel de Web Audio, usa rampas cortas de ganancia (~5–10 ms).

**Nota sobre filtros:** en Strudel los filtros (`.lpf`, `.hpf`, `.djf`…) se aplican **por evento** dentro de superdough, no como insert global en un bus. Para v1 eso es suficiente y es lo nativo. (Un filtro "de DJ" sobre el máster — un BiquadFilter en la salida de superdough — queda como mejora futura, ver §7.)

**Cables tipados:** todo cable transporta un `Pattern`. Los parámetros de un efecto (ej. cutoff del lpf) se teclean en el nodo en v1. Aceptar un segundo cable de control que module un parámetro es mejora futura.

## 4. Tipos de nodo — v1

- **Source / Pattern**: editor CM6 con mini-notación. Salida: `Pattern`.
- **Transform**: una operación de tiempo/estructura (`fast`, `slow`, `rev`, `jux`, `every`, `chop`, `degradeBy`…). 1 entrada, 1 salida.
- **Filter / FX**: `lpf`, `hpf`, `bpf`, `room`, `delay`, `crush`, `vowel`… con sus params. 1 entrada, 1 salida. **Estos son los que se insertan en vivo.**
- **Out**: terminal, va al scheduler/superdough. Tiene el **tap del visualizador**.

(Combinator `stack`/`cat` puede entrar en v1 si sale fácil; si no, va inmediatamente después.)

## 5. Alcance v1 (Fase 0–1) — slice vertical

Construye **lo mínimo que prueba toda la cadena**, no la app completa:

- Lienzo React Flow con paleta para crear nodos Source, Filter/FX y Out.
- Un nodo Source con CM6 donde tecleo `s("bd*4")` o `note("c e g")`.
- Cablear Source → (Filter opcional) → Out.
- Botón Play/Stop con transporte (`setcps`/BPM).
- **Suena** vía superdough.
- **Visualizador**: osciloscopio (dominio de tiempo) + espectro (FFT) tapando la salida máster, en WebGL2, a buen tamaño.
- **Prueba clave de "en vivo"**: con el audio sonando, arrastro un nodo `lpf 800` sobre el cable Source→Out; el filtro entra en el siguiente ciclo, sin cortes, y lo veo reflejado en el espectro.

**Grafo de ejemplo objetivo:**
`s("bd*4")` → `lpf 800` → `Out` ⇒ compila a `s("bd*4").lpf(800)` sonando + onda visible. Arrastro `room 0.4` entre el filtro y Out ⇒ recompila a `.lpf(800).room(0.4)` en vivo.

## 6. Fuera de alcance v1 (no construir todavía)

Colaboración/multiusuario, MIDI, grabación/export de audio, biblioteca de presets, módulos reutilizables nombrados (vendrán: ese es el siguiente gran paso), modulación por cable de control, filtro de máster tipo DJ, móvil. Déjalos como `// TODO v2` donde el diseño los toque, pero no los implementes.

## 7. Trampas técnicas obligatorias

- **Todo el audio en AudioWorklet** (superdough ya lo hace); nunca `ScriptProcessor`.
- **AudioContext tras gesto del usuario** (autoplay policy): inicia/reanuda en el primer click de Play.
- **Carga perezosa de samples**: el primer disparo de un sonido puede no oírse mientras carga; precarga los sonidos del grafo al evaluar o al pulsar Play.
- **COOP/COEP**: si superdough exige AudioWorklet con SharedArrayBuffer, configura los headers `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp` en el server de Vite.
- **Scheduler con lookahead sobre el reloj de audio** (no `setTimeout` solo); deja que el scheduler de Strudel lo maneje y no lo reinventes salvo necesidad.
- **Visualización en `requestAnimationFrame`, desacoplada del hilo de audio**; lee del `AnalyserNode`, no bloquees.
- **Recompilación incremental**: no tires y reconstruyas todo el grafo en cada tecla; diff y recompila lo afectado.

## 8. Estética — underground / glitch / minimalista

- Tipografía monospace técnica (Chakra Petch / IBM Plex Mono). Alto contraste, fondo casi negro, un acento frío.
- **El visualizador manda**: ocupa espacio, el grafo y el código flotan sobre él en bajo contraste. Vibe de calibración de monitor / osciloscopio de laboratorio, no SaaS pastel.
- React Flow totalmente theme-ado: cables finos, nodos sobrios tipo terminal, cursor de bloque en CM6.
- Antes de construir UI, lee y respeta tu skill `frontend-design`.
- Nada de emojis, gradientes alegres ni esquinas redondeadas blandas.

## 9. Sonidos (referencia)

- **Ya incluidos**: drum-machines (`.bank("RolandTR909")` / `"RolandTR808"` para techno/house), instrumentos VCSL, soundfonts GM, dirt-samples. Síntesis nativa para acid (saw + lpf con resonancia), Reese (DnB), stabs.
- **Cargar propios**: `samples('github:usuario/repo/branch')`, URL directa, o import de carpeta local.
- **DnB**: `samples('github:yaxu/clean-breaks')` → `s("amen").chop(8).loopAt(4)`.
- **Urbano (dembow/reggaeton/dancehall) y vocal chops**: usa **shabda** para jalar de freesound al vuelo, ej. `samples('shabda:dembow:4,vocal:4')`, y `shabda/speech` para voces.
- **Licencia de samples**: si distribuyo, solo CC0 / CC-BY; filtra freesound por licencia.

## 10. Estructura de archivos sugerida

```
src/
  audio/         # init superdough, transporte, scheduler, taps de análisis
  graph/         # tipos de nodo, compilador grafo→Pattern, validación DAG
  nodes/         # componentes React Flow + editor CM6 por nodo
  viz/           # osciloscopio + espectro WebGL2
  store/         # Zustand (grafo, transporte, params)
  theme/         # tokens estéticos, theme CM6, theme React Flow
  App.tsx
```

## 11. Definición de "hecho" para v1

- [ ] `npm run dev` levanta la app.
- [ ] Creo Source `s("bd*4")` → Out, doy Play, **suena**.
- [ ] Veo onda + espectro en vivo.
- [ ] Edito la mini-notación y cambia **sin cortar** el audio.
- [ ] Arrastro un nodo `lpf` sobre el cable con el audio sonando y **entra en vivo, sin clicks**.
- [ ] Stop limpio; re-Play vuelve a sonar.

## 12. Primer paso

Empieza por el **scaffold + el loop mínimo "tecleo → suena → veo la onda"** con un solo Source y un Out (sin filtro aún). En cuanto eso funcione y se vea, agrega el nodo Filter y la inserción en vivo. Antes de escribir código, dime tu plan de archivos y el enfoque para el hot-swap del scheduler, y cualquier punto donde la API de Strudel te obligue a verificar algo en su fuente.
