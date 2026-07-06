# Tutorial: tu primer riddim de latin dancehall PRO en Telar

Este tutorial enseña Telar **construyendo un riddim de principio a fin**. Cada paso = una herramienta de Telar + una técnica de producción real, en el orden en que se construye un riddim de verdad. No necesitas saber nada de antemano. Al final tienes un instrumental que se sostiene solo y deja hueco para la voz — y entiendes por qué.

**La regla de oro (léela dos veces):** el error nº1 del amateur en dancehall es **llenar demasiado y cuantizar duro**. El pro construye ESPACIO. Un riddim son 4–6 elementos con carácter, no 15 capas. Cada vez que dudes si añadir algo, no lo añadas.

> ℹ️ Los fixes P0.1 (la mezcla ya no pisa los acentos) y P0.2 (swing de semicorcheas) de `auditoria-dancehall.md` **ya están aplicados**: faders, humanize del máster, auto-master y kits componen bien con tu dinámica programada. Los ⚠️ que quedan en el tutorial señalan lo aún pendiente (P1.x).

---

## Paso 0 · Preparación: tempo, mindset, referencia

**Qué:** abre Telar, carga la demo **"latin dancehall"** (menú de proyectos → demos) y escúchala entera una vez. Luego menú → **lienzo nuevo**.

**Dónde:** el **tempo** está arriba en el transporte: escribe `96` en el campo BPM (o usa tap con la tecla T). El dancehall vive entre **90 y 100 BPM** — medio tiempo, echado pero con empuje.

**Por qué:** todo lo que programes después hereda este pulso. En Telar un "ciclo" = un compás; la rejilla de 16 pasos = 16 semicorcheas de ese compás.

**Deconstruye (5 min bien invertidos):** en la demo, abre cada source (clic) y mira su patrón. Fíjate: el kick NO está en los 4 tiempos, la caja cae en el patrón dembow, el skank vive SOLO en los offbeats, y hay silencio a propósito. Referencias reales para el oído: **"Diwali"** (Lenky — las palmas sincopadas SON el riddim) y **"Dem Bow"** (Shabba Ranks — el patrón madre de todo el reggaetón).

**Error a evitar:** empezar a 120+ BPM "porque suena más lleno". A 96 el groove tiene sitio para respirar; esa es la gracia.

---

## Paso 1 · El pocket: la batería dembow

**Qué:** la base rítmica — kick sincopado + caja/rim en el patrón dembow + hats discretos.

**Dónde:** abre la **paleta** (menú de nodos) → sección **kits** → **dancehall / reggaetón** → **"dembow riddim"**. Aparece un source ya conectado al Out. Dale **play** (▶ arriba) y clic en el source → **secuenciador** (la rejilla).

La rejilla es tu drum machine:
- **clic** = golpe (arrastra para pintar) · **clic derecho** = ciclar acento → ghost → normal
- **shift+clic** = roll/tresillo (`*2 *3 *4`) · **alt+clic** = probabilidad (75/50/25% — el golpe a veces suena)
- **♪** = afinar la pista por pasos · **≋** = groove (swing + humanize) por pista
- **"caja"** = cambiar el banco de batería de toda la rejilla (RolandTR808, LinnDrum…)

**Hazlo así (16 pasos):**
1. Sube los pasos a **16** con el `+`.
2. **Kick (`bombo`)**: pasos **1, 5, 9, 13** te da el "four" plano — bórralo. Dancehall: prueba **1 y 9** (medio tiempo pesado) o **1, 7, 9** (sincopado). El kick del dembow clásico del kit ya trae 1 y 9 con variación: escucha antes de tocar.
3. **Caja/rim (`caja`)**: el kit trae el patrón dembow (pasos **4, 7, 12, 15**). Ese "y-pa, y-pa" ES el género. No lo cuadres.
4. **Hats (`hat`)**: semicorcheas suaves. Aplica **ghost** (clic derecho ×2) en las débiles y deja normales las de los beats. Añade `alt+clic` 50% en dos o tres para variación viva.
5. **Groove**: abre **≋** en los hats → swing ~0.3, human ~0.3. En la caja, human ~0.2. El swing balancea las semicorcheas par-a-par (el tumbao); a fondo llega al tresillo.

**Por qué:** la batería del dancehall se construye ALREDEDOR del hueco. La caja en 4-7-12-15 crea la síncopa que hace mover la cabeza; el kick escaso deja sitio al bajo (que llega en el paso 3).

**Error a evitar:** kick en los 4 tiempos (eso es house/techno) y hats a todo volumen todos iguales (eso es un metrónomo).

**Escucha:** el ▶ de la rejilla aísla este source (solo) mientras editas. Vuelve a pulsarlo para des-aislar.

---

## Paso 2 · Percusión viva: la capa latina

**Qué:** lo que separa amateur de pro — conga/bongo/shaker CON dinámica, poca cantidad.

**Dónde:** crea un source nuevo (paleta → source, o botón de añadir canal) y escribe en su código:

```
s("~ ~ crate_conga ~ ~ crate_conga ~ [crate_conga crate_conga] ~ ~ crate_conga ~ ~ ~ crate_conga ~").gain(0.5)
```

y otro para el shaker:

```
s("crate_sh*16").gain(0.3)
```

Ábrelos en la rejilla (⚠️ hoy la paleta de "+ añadir sonido" no ofrece congas — P1.4 — por eso arrancamos por código; una vez escrito, la rejilla lo edita normal). En el shaker: ghosts en TODAS las semicorcheas débiles, acento solo en 1 y 9, y probabilidad 75% en un par. También tienes `crate_bongo`, `crate_clave`, `crate_block`, y en el pack vcsl: `conga`, `bongo`, `darbuka`.

**Por qué:** la percusión latina a contratiempo (nunca encima del kick) es el "sabor" del latin dancehall — el puente con el dembow dominicano y el reggaetón. La dinámica (ghosts) la hace sonar tocada, no programada.

**Error a evitar:** meter conga Y bongo Y clave Y güira. UNA capa protagonista + shaker basta. Y jamás en el paso 1 — ese es del kick.

---

## Paso 3 · El bajo: el segundo pilar

**Qué:** sub redondo, mono, riff simple y PEGAJOSO en menor, que encastra con el kick. Es música de sound-system: esto es lo que pega en el pecho.

**Dónde:**
1. Source nuevo con `note("c2 ~ ~ c2 ~ ~ g1 ~").s("sine")`.
2. Clic en el source → **estudio de synth**: onda **sine** (sub limpio) o **triangle** (un pelo más presente). Filtro **lpf ~500–700**. Un toque de **drive/shape** (~0.2) para que se oiga en altavoces chicos. **Release corto**.
3. Abre el **piano roll** (secuenciador de notas) del source: escribe el riff en **Do menor**, octava 1–2. La clave: **las notas del bajo caen donde NO está el kick o justo con él — nunca peleando**. Prueba: `c2` en 1 (con el kick), `~`, `c2` en el "y" (paso 3-4), `eb2` paso 7 (con la caja), `g1` paso 11. Escucha contra la batería (quita el solo).
4. **Slide**: el slider **"slide"** del piano roll hace que cada nota ENTRE deslizando el pitch (el gesto 808). Con 0.2–0.3 el bajo se vuelve elástico.
5. **vel/dur**: abre la lane **dur** y acorta las notas (~0.6) — el bajo dancehall respira, no es un dron.
6. **Sidechain**: paleta → fx **sidechain** → insértalo entre el bajo y el Out; en el nodo, modo **duck** y trigger = tu source de kick. Profundidad ~0.5, ataque ~0.08. Ahora el kick real abre hueco en el bajo — el "pump" sutil que hace la mezcla grande. (El asistente "revisar mezcla" IA también lo inserta solo.)

**Por qué:** kick + bajo son UN instrumento en este género. El sidechain por kick real (no un LFO) hace que cada golpe tenga su sitio. Menor porque el dancehall moderno es oscuro (Diwali, Coolie Dance — melodías menores/frigias).

**Error a evitar:** riff de 8 notas distintas. Los riffs que facturan tienen 2–3 notas. Y pan SIEMPRE al centro — ⚠️ si usas el "width" del máster luego, recuerda que hoy ensancha también el sub (P1.1): mantenlo ≤1.2.

---

## Paso 4 · El bubble/gancho: el skank offbeat

**Qué:** UNA cosa memorable. La opción clásica: acordes cortados en el offbeat ("bubble"/skank). La alternativa: una melodía oscura tipo Diwali.

**Dónde (skank):** paleta → kits → **"stab dembow"**, o source nuevo:

```
note("~ [c4,eb4,g4] ~ [c4,eb4,g4]").s("square").lpf(1500).lpq(4).attack(0.005).decay(0.12).sustain(0).room(0.15)
```

Fíjate: las tríadas `[c4,eb4,g4]` caen SOLO en los pasos 2 y 4 de cada mitad — el offbeat. Eso es el skank. Para un timbre más "órgano de iglesia jamaiquino", prueba `s("organ")` (pack vcsl) o la wavetable `wt_telar_organ`.

**El toque dub:** añade al final `.delay(0.3).delayfeedback(0.55)`. El delay de Telar viene **sincronizado al tempo en 3/16** (corchea con puntillo) por defecto — el tiempo exacto del dub delay. No toques más: ya cae en el grid.

**Dónde (melodía, alternativa):** source `note("~")` + piano roll, escala **menor** o **frigia** (en la rejilla afinada tienes scale-lock; en el piano roll, quédate en las teclas de Do menor). Timbre: `triangle` con decay corto, o el cowbell melódico `note("…").s("cb").bank("RolandTR808")` — el linaje dembow/phonk.

**Por qué:** el riddim se reconoce por UNA cosa (las palmas de Diwali, el órgano de Sleng Teng). Dos ganchos compiten y se anulan.

**Error a evitar:** acordes largos y sostenidos (eso es un pad, y come el espacio de la voz). El skank es corto, percusivo, con aire entre golpes.

---

## Paso 5 · La voz (si tu riddim la lleva)

**Qué:** grabar (o generar), corregir tono, armar la mejor toma, limpiar.

**Dónde:** source de voz → **Estudio de Voz**:
1. **Graba** (o importa arrastrando un audio, o genera con la voz IA).
2. **✂ recortar**: deja solo lo útil (destructivo: limpia el silencio de verdad).
3. **✧ limpiar**: gate de ruido para el ruido de fondo del mic.
4. **corregir tono · autotune real**: tono = **C**, escala = **menor** (la del riddim). **Retune**: a la izquierda = duro (efecto T-Pain/dancehall moderno), a la derecha = natural (corrección invisible). «▶ probar» antes de «aplicar».
5. **comping · tomas**: graba 3–4 tomas, clic en el mejor tramo de cada carril, «componer».
6. **◎ en el tempo**: escucha la voz EN el riddim (con transporte), no aislada.

**Por qué:** la vara del dancehall es voz afinada Y con carácter. El retune duro es una decisión estética legítima del género (no un parche).

**Error a evitar:** autotune sobre una escala equivocada — si el riddim está en Do menor y corriges a mayor, todo desafina "raro" sin que sepas por qué.

---

## Paso 6 · El arreglo: intro → verso → drop, con aire

**Qué:** la estructura. En dancehall el "verso" es la versión LIMPIA del riddim (hueco para la voz) y el drop es todo dentro.

**Dónde:**
1. Con TODO sonando (el drop), pulsa una ranura vacía de **escenas** → capturada como escena 1: "drop".
2. **Mutea** (clic derecho en el nodo) el bajo y el skank, baja los hats → captura escena 2: "intro".
3. Restaura el drop (escena 1), mutea solo la percusión latina y la melodía → escena 3: "verso" (batería + bajo + skank: cama para la voz).
4. Abre **canción** (panel de performance) → **+ sección**: intro=escena 2 ×4 compases, verso=escena 3 ×8, drop=escena 1 ×8, verso ×8, drop ×8. Activa ⟳ y **▶ play**.

**Por qué:** el arreglo dancehall no es un crescendo de EDM: es alternancia de densidad. El drop pega porque el verso era espacio.

**Para ir más lejos (cambiar NOTAS por sección, no solo mute):** las escenas solo guardan mezcla. Si quieres que el kick CAMBIE de patrón en el drop, edita el código del source con `arrange`:

```
arrange([8, s("bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ ~ ~")], [8, s("bd ~ ~ ~ bd ~ bd ~ bd ~ ~ ~ bd ~ ~ ~")])
```

= 8 compases del primer patrón, 8 del segundo, en bucle. Así está construida la demo "latin dancehall" entera. (La rejilla no puede editar `arrange` todavía — es la mejora P0.3 de la auditoría.)

**Error a evitar:** 16 secciones de 2 compases. El dancehall se asienta: secciones de 8.

---

## Paso 7 · Tags y FX de la cultura

**Qué:** air-horn, sirena, el pull-up. Son la firma cultural — con moderación.

**Dónde:** hay una **sirena** en el pack vcsl: source `s("siren").gain(0.5)` y mutéalo — actívalo a mano en transiciones (o dale probabilidad `?0.25` para que aparezca solo). Un air-horn real: **arrástralo** (drag & drop de un .wav) al lienzo — queda como sample tuyo al instante (ojo: los samples locales no viajan si compartes por URL). El "pull-up" (rebobinar y relanzar): el botón **rev** momentáneo del máster + volver a la escena 1 es el gesto más cercano hoy.

**Error a evitar:** air-horn cada 4 compases. Uno por canción, en EL momento.

---

## Paso 8 · La mezcla: batería y bajo al frente, fuerte y limpio

**Qué:** slotting por EQ, y loudness con medidor. Energía sobre pulido.

**Dónde (EQ por canal — en cada source, sección EQ):**
- **Kick**: low +2/3 dB, mid −2 alrededor de 300 Hz (caja de zapatos fuera).
- **Bajo**: low +2, y sobre todo **hpf implícito del resto**: que NADIE más viva bajo 150 Hz.
- **Skank/melodía**: corta low (−6 o más — el kill de −30 existe para esto), presencia con mid ~1.5–3 kHz.
- **Hats/shaker**: low fuera del todo, high +2. **Pan**: shaker un poco a la derecha, conga un poco a la izquierda (chPan) — la batería central, el adorno a los lados.
- **Voz**: el botón "pulir" del estudio (hpf + compresor) + hueco: baja 2 dB el mid del skank donde canta.

Los faders de canal ya componen con tus acentos (multiplican, no pisan): mezcla con confianza.

**Dónde (máster — panel derecho):**
- **punch** +0.2 (el transient shaper realza el ataque del kick), **glue** ~0.3 (pega), **sat** ~0.15 (calor), **width** ≤1.2 (⚠️ P1.1 pendiente: más ancho des-monoiza el sub).
- **LUFS**: reproduce el drop y mira el medidor. **⚡ auto** te lleva a −14 LUFS (streaming) respetando el balance entre canales (el gain del máster es multiplicativo).

**Por qué:** la mezcla dancehall es jerarquía: kick+bajo delante, TODO lo demás les cede el paso. El LUFS te da el "fuerte" objetivo; el sidechain y el EQ te dan el "limpio".

**Error a evitar:** mezclar con el limitador a tope desde el principio — primero balance, luego loudness.

---

## Paso 9 · Exportar y buenas prácticas

- **WAV del máster:** el grabador (menú herramientas) captura la salida en vivo → deja correr la canción entera → guarda. ⚠️ Mientras grabas, no arrastres perillas ni abras paneles pesados (P1.6: el grabador actual puede capturar glitches de UI).
- **Stems de un loop:** el **freeze** de un source rinde esa rama (con sus FX) a un sample `freeze_*` — útil para bounce y para aligerar CPU (máx. 16 ciclos hoy).
- **Guarda** en la galería de proyectos (con nombre) y **comparte por URL** — recuerda: los samples arrastrados desde tu disco no viajan en la URL.
- **Buenas prácticas del riddim:** (1) prueba la mezcla EN MONO (el sound-system a veces lo es); (2) compárala A/B contra "Diwali" o un dembow comercial AL MISMO VOLUMEN; (3) si al quitar un elemento el groove no empeora, ese elemento sobraba.

---

## Apéndice · Lo que este riddim no tocó (y vale la pena conocer)

- **FM y wavetables** (estudio de synth): el operador FM (índice/ratio/envolvente) hace campanas, cencerros metálicos y bajos "growl"; las wavetables `wt_telar_*` dan órganos y timbres vocales. Para leads oscuros de darkwave dentro de un dancehall híbrido.
- **Euclídeos** (nodo euclid o `(3,8)` en mininotación): patrones de percusión giratorios instantáneos — `crate_clave(3,8)` es una clave lista.
- **Alternancia `<a b>`**: `s("<sd rim>")` alterna caja/rim por ciclo — variación gratis sin más pistas.
- **Señales como automatización**: `lpf(sine.range(300,2000).slow(8))` — el filtro se mueve solo; sirve en cualquier parámetro numérico.
- **MIDI out**: `.midi()` manda el patrón a hardware/DAW externo (WebMIDI nativo).
- **El copiloto IA**: descríbele "dembow 96bpm en do menor con skank de órgano" y te monta el grafo; luego edítalo con todo lo aprendido aquí — es un punto de partida, no un final.
- **Demos para seguir deconstruyendo:** "dembow dominicano" (el tra-tra a 122), "reggaetón clásico" (el pocket de 92 con piano real), "latin dancehall" (este género, arreglada con `arrange`).
