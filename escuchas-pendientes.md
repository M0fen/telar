# Telar — Checklist de revisión final (escuchar + mirar)

Una sola pasada por **áreas de la herramienta**, para hacer de corrido cuando Telar esté en el punto que quieras. Marca cada punto al probarlo; **si algo suena o se ve mal, ese punto manda sobre cualquier roadmap.** Reproducir con audio sonando salvo donde se indique. Prod: https://telar-livid.vercel.app

---

## 1 · Mezcla y balance (que nada pise)
- [ ] Demo **"latin dancehall"** → play: los hats se oyen DISCRETOS (no al nivel del kick). Mover **humanize del máster** no cambia el balance entre canales.
- [ ] Rejilla con **acento + ghost** en una pista → bajar el **fader** de ese canal a la mitad → la diferencia acento/ghost sigue oyéndose (solo baja el conjunto).
- [ ] **⚡ auto-master**: aterriza el LUFS sin cambiar el balance relativo entre canales.
- [ ] **Escenas**: capturar una con el filtro del máster cerrado y otra abierto → al saltar, el máster salta.

## 2 · Groove y pocket
- [ ] Hats en 16 pasos con **swing ~0.5** (≋): shuffle par-a-par real (larga-corta); el kick no se mueve.
- [ ] **timing** (panel ≋): caja del backbeat +8/+12 ms → se "sienta atrás"; al centro → cuadrada; arriba → adelanta.
- [ ] **vel** (panel ≋): crescendo de shaker dibujado → rampa audible.
- [ ] **humanize** (pista o máster): da vida SIN arrastrar el patrón hacia tarde.

## 3 · Secuenciador y secciones
- [ ] Cualquier source → secuenciador → **pestañas de sección**; editar la 1 no toca las demás.
- [ ] **▶** = la sección editada suena YA en loop; cambiar de pestaña con ▶ activo salta la audición al instante.
- [ ] **Punto amarillo** = sección sonando ahora; el playhead se apaga si lo editado no es lo que suena.
- [ ] Sección **en silencio**: entra sembrada con las pistas/instrumento de la referencia (nada de rejillas vacías); pintar la hace entrar.
- [ ] **Melodía** (bajo/skank): abre en REJILLA (pasos + afinar arrastrando ↕ + afinar todo); toggle **🎹 piano roll** ida y vuelta; los acordes del skank sobreviven.
- [ ] Gestión de secciones: **−/＋ compases**, **⧉ duplicar** (edita la copia), **✚ silencio al final**, **× quitar**; en un source plano, **"secciones ＋ crear"** suena idéntico.
- [ ] **Caja por pista** (panel ≋): kick 808 + caja LinnDrum en la misma rejilla, cada una se pre-escucha con su máquina.

## 4 · Dub, percusión, canción y salida
- [ ] Synth/voz → espacio → **"tiempo eco"**: a 96 y a 140 BPM el eco cae en el grid (3/16 puntillo = dub).
- [ ] Rejilla con banco 808 → **+ añadir sonido → percusión → conga** → suena (antes: muda).
- [ ] Kit **"latin dancehall"** y demo **"latin dancehall · editable"**: suenan a riddim recién soltados y TODO es editable.
- [ ] **Canción** con secciones → **⇋ instrumentos** → todos los sources alineados a esos compases; los cambios de sección caen EN el 1 (anticipación), no un pelo tarde.
- [ ] **Mono-bajo**: width del máster a 1.6 con sub en c1 → en mono el bajo no se adelgaza.
- [ ] **WAV**: grabar ~2 min moviendo perillas/abriendo paneles → archivo sin chasquidos (worklet).
- [ ] **Freeze** de una sección larga (hasta 64 ciclos): el stem cierra bien.

## 5 · Estudio de voz (VoiceStudio) — herramienta PRIMORDIAL
*El split no debía cambiar nada: confirmar que se comporta idéntico.*
- [ ] **Recorrido completo**: grabar/cargar voz → onda con manijas → ▶ / ⟳ / ◈ con FX / ◎ en el tempo / ◆ warp RB → todo suena y se detiene como antes.
- [ ] **Piano roll · sampler**: pintar melodía, escala, armonía, glide/vibrato — audición al poner nota.
- [ ] **Autotune real + ✧ limpiar + ✂ recortar**: probar → aplicar hornea; mensajes de estado bajo el transporte. Toma larga (30 s+) → **no congela** la interfaz (worker).
- [ ] **Calidad R3**: A/B del autotune/warp — más limpio (menos artefactos) que antes.
- [ ] **Comping**: grabar 2 tomas, elegir tramos, componer; cerrar y REABRIR el estudio → las tomas siguen ahí.
- [ ] **Eco de voz al tempo**: el delay de la voz cae al grid con la subdivisión elegida.

## 6 · Efectos visuales del grafo + panel de FPS
- [ ] **Botón «fps»** (arriba-izquierda en prod, o `Alt+Shift+D`): abre el panel de efectos + FPS. **No se solapa** con el máster ni el visualizador.
- [ ] **Grafo como señal viva**: al reproducir, cada nodo LATE al disparar y la energía corre por sus cables hacia el Out; muteá una pista → su rama se apaga.
- [ ] **Flujo por nivel real**: con «medición por rama» ON, el grosor/brillo del flujo sigue lo FUERTE que suena cada rama (una pista baja se ve tenue aunque dispare); OFF → pulso por evento.
- [ ] **Apagar cada efecto** desde el panel y ver el **FPS** cambiar: con una feature en OFF su costo desaparece de verdad.

## 7 · Fila de performance por source (reemplaza la leyenda)
- [ ] Seleccioná un source → aparece la fila **roll/gate/rev/echo/wash**. La leyenda de texto ya no está.
- [ ] **«roll 8» en los hats** → stutter SOLO de los hats; **«gate» en el pad** lo cortea; **«echo» en la caja** la manda al delay.
- [ ] **gate no pisa**: con acentos en la rejilla, mantené «gate» → los acentos sobreviven mientras cortea.

## 8 · Mapa de energía + superficie de mezcla
- [ ] **Mapa de energía**: armá una canción (secciones con escenas) → bajo las secciones aparece la franja; intro con aire (barra baja) vs drop lleno (barra alta/warn). Se actualiza al editar.
- [ ] **Superficie de mezcla** (⋯ → «superficie de mezcla»), con «medición por rama» ON: cada instrumento es un punto (X=paneo, Y=frecuencia, tamaño=nivel).
  - [ ] Arrastrá el **bajo** y el **kick** para que no choquen en graves (se marcan cuando pelean por la misma altura) — se ve **y** se oye.
  - [ ] Arrastrar a los lados = paneo; **rueda** sobre un punto = reverb (halo).
  - [ ] **No destructivo**: si tenías EQ de canal a mano, soltar el punto en el centro lo deja intacto; el throw de **wash** se oye aunque el canal ya tenga reverb.

## 9 · Galería de sonidos
- [ ] Cargar **dirt-samples** (y algún pack más) → **"otros" se reduce fuerte**; buscar "bass" / "perc" / "fx" devuelve decenas, no dos. Congas/güiro/timbales caen en **percusión**; air-horn/sirena/scratch en **fx**.

## 10 · Síntesis wavetable (Synth Studio) — NUEVO, sin verificar
- [ ] Source `note(...)` → estudio de sonido → OSC A, separador **morph**: elegir cualquiera de las **18 tablas** → mover **posición (wt)** barre el timbre; el **landscape 3D** muestra los cuadros con el actual resaltado.
- [ ] Audicionar una wavetable (teclado/▶) **SIN dar Play antes** → suena (no "sound telar_* not found").
- [ ] **Multi-oscilador**: "+ capa de oscilador" (OSC B) → engorda; octava −1 + sine = sub; filtro/ADSR compartidos. Sin capas = idéntico a un oscilador.
- [ ] **Editor de onda con nodos**: "crear onda propia" → arrastrar/añadir (clic)/quitar (doble-clic) nodos → curva **suave** (Catmull-Rom); **imán al cero**; "usar en OSC A" suena.
- [ ] **Morph propio multi-cuadro**: "+ cuadro", dibujar cuadros distintos, "usar en OSC A" → aparece **posición (wt)** + landscape de TUS cuadros → morfea entre ellos.
- [ ] **Piano** del estudio: nombres de nota + teclas PC + "🎯 fijar tono" (amarillo) + duración larga para oír el morph mientras mueves wt. Los **dos ▶** se distinguen ("▶ proyecto"=transporte, "▶ escuchar"=este sonido).
- [ ] Agudos MUY altos de una onda dibujada: ¿aliasing tolerable? (sin band-limiting aún).
- [ ] Todo **persiste** al cerrar/reabrir el estudio y al guardar/cargar el proyecto.

## 11 · En vivo con el M-Wave (panel MIDI) — NUEVO, medido sin oír
*Conectar el M-Wave por USB en Chrome/Edge → «Conectar MIDI» → «⌨ Aprender».*
- [ ] **Filtro de cada pista** (perilla «filtro» del panel, del deck DJ o del nodo): baja = se cierra, sube = se afina. Sobre las aves: bajar el filtro NO abre el drone (sigue oscuro) y subirlo NO le mete graves al silbido.
- [ ] **Reverb y eco del máster suman**: con la base de aves sonando, subir la perilla de reverb a ~30 % → las aves quedan MÁS húmedas, no más secas. Igual el eco.
- [ ] **Grabar el set**: grabar WAV moviendo el filtro del máster con el M-Wave → el archivo trae los barridos, el limitador y los pads (antes salía sin ellos).
- [ ] **Barrido de filtro**: girar rápido la perilla de filtro → suave, sin escalones ni chasquidos, y sin cortes en el audio.
- [ ] **Kill graves / medios / agudos**: mantener cada pad → desaparece esa banda (bombo+bajo / voces y sintes / hats y aire); soltar → vuelve sin chasquido.
- [ ] **Eco** (pad): mantener sobre una caja o un silbido y soltar → la cola sigue unos 3 s, a tempo (3/16), con repeticiones cada vez más oscuras.
- [ ] **Wash** (pad): mantener y soltar → se lava en reverb y la cola se apaga sola. ¿Muy fuerte o muy suave? (hoy: el húmedo ≈ al nivel del seco por encima de 400 Hz).
- [ ] **½ tiempo** (pad): entra justo en el siguiente pulso, a media velocidad, sin salto; con Roll ×4 apretado encima, el roll va a tempo real; al soltar, la canción sigue en su sitio.
- [ ] **Pads solapados**: mantener Roll ×4, tocar ×8 y soltar ×8 → vuelve a ×4 (no se apaga).
- [ ] Los pads **se iluminan** mientras actúan (con el M-Wave o con el mouse). **Reiniciar** apaga todo, incluidos kills, eco, wash y el filtro de cada pista.
- [ ] **Escenas**: capturar una escena mientras mantienes un pad y dispararla después → el pad NO queda pegado.
- [ ] **Minimizar** (▾): en modo DJ el panel queda en un botón pequeño y no tapa la consola; recuerda el estado al recargar.

---

## 12 · Modo DAW, Fase 0 (canción, reloj, secciones) — medido sin oír
- [ ] **Un solo reloj** (oído): con todo sonando, abrir **canción** y dar **▶**: arranca en el compás 1 y cada cambio (escena + instrumentos arreglados) cae **junto en el 1**, también en la **2.ª vuelta** del loop. Al dar ▶ con el transporte sonando hay un corte breve (se reinicia el reloj): ¿molesta?
- [ ] **⚠ no cuadra**: con un instrumento de otro largo que la canción aparece el aviso; **⇋ instrumentos** lo alinea y el aviso se va.
- [ ] **■ del transporte** detiene también la canción; volver a ▶ canción arranca en el compás 1.
- [ ] **Canción y escenas en el proyecto**: **Guardar proyecto** → abrirlo en otro navegador (o en incógnito) → misma canción y mismas escenas. Cargar un **ejemplo** → canción y escenas vacías; **Ctrl+Z** → vuelven. Un enlace **Compartir por URL** las lleva.
- [ ] **⇋ instrumentos dos veces** sobre la **base de aves** (o un source con `x=>…`): las secciones quedan planas (nada de arrange dentro de arrange) y **suena igual**.
- [ ] **○ y luego ●** en una sección (tira de secciones del source): se apaga y al encenderla **suena exactamente igual que antes**. En el secuenciador, la sección apagada muestra su patrón y «● encender».

## 13 · Vista DAW (Fases 1–3) — NUEVO, medido sin oír
- [ ] Botón **daw** (junto a standard / dj): la canción entera, pistas en filas y compases en columnas; cada fila coincide con las secciones de esa pista (las vacías punteadas, las apagadas rayadas).
- [ ] Con canción armada: arriba salen sus secciones con el nombre de la escena; sin canción, las del primer instrumento con arrange («sección N»).
- [ ] Un instrumento que no dura lo que la canción muestra **⚠** y sus bloques repetidos en tenue (es lo que de verdad suena desfasado).
- [ ] **▶ canción** desde la vista DAW y pasar a standard o dj sonando: la canción sigue cambiando de escena en cada sección (antes se quedaba quieta sin el panel de la canción).
- [ ] **M / S** de cada fila silencian / aíslan esa pista; recargar la página vuelve a la vista DAW.
- [ ] **Línea de reproducción**: con ▶ la línea recorre la canción al ritmo de lo que suena y la sección actual se ilumina justo en su 1 (también en la 2.ª vuelta); con mucho zoom la vista la sigue sola; con ■ desaparece.
- [ ] **Encender / apagar bloques** (oído): clic en el bloque del bombo en el drop → se apaga (rayado) y el bombo sale **justo en ese tramo**; otro clic → vuelve **igual**; **Ctrl+Z** lo deshace. Un bloque vacío (punteado) entra con el patrón de la primera sección que suena. Las pistas sin secciones no cambian al clic. Si el panel MIDI tapa la izquierda de la vista, se minimiza con ▾.
- [ ] **Tocar desde un compás** (oído): con la canción armada, **doble clic** en la sección **drop** (o clic en el número de un compás, o «▶ desde aquí» en la barra de la sección) → suena el drop **en el acto**, con su escena y sus instrumentos juntos, y la línea arranca ahí. **■** y luego **▶ canción** → vuelve al compás 1. Sostener **½ tiempo** después del salto funciona normal y al soltarlo vuelve a tempo.
- [ ] **Crear estructura** (oído): con el tema de las aves (sin canción) → DAW → «crear estructura ▾» → techno: salen 6 secciones (intro, subida, drop, respiro, drop 2, salida) y **todo suena igual que antes** (las aves aleatorias repiten su azar en cada sección). Apagar bloques por sección arma el tema.
- [ ] **Editar secciones**: clic en una sección → su barra: nombre, escena, − / + / ×2 compases, ← → mover, ⧉ duplicar, ✚ vacía, ✕ borrar, ▶ desde aquí. Cada cambio afecta la canción y TODAS las pistas a la vez (nunca quedan desfasadas); **Ctrl+Z** lo deshace **sin cortar** la canción que suena. Atajos con una sección elegida: Ctrl+D, Supr, Alt+← →, ← →, Esc.
- [ ] Un tramo que la **escena** de la sección silencia se ve rayado en rojo sobre la pista (la escena es la mezcla; los bloques, qué suena).
- [ ] **Bloques: copiar / pegar / vaciar / editar**: clic derecho (o mantener pulsado en táctil) sobre un bloque → menú. Copiar el hat del drop y pegarlo en la subida suena igual que en el drop. Con un bloque enfocado (Tab o clic): Ctrl+C, Ctrl+V, Supr (vaciar), E (editar). «Editar en la vista estándar» abre el nodo centrado, con su secuenciador en ESA sección.
- [ ] **Loop de región** (oído): arrastrar sobre los números de compás marca una región; **⟳ región** (o **L**) la repite **sin saltos y con su escena**; la línea se queda dentro. Activarlo sonando arranca en el inicio de la región; quitarlo sonando sigue desde donde iba. Clic sin arrastre sigue siendo «tocar desde aquí»; × borra la región.
- [ ] **Grabar el jam en la canción** (oído): con las aves sin canción, **● grabar jam** (DAW o panel canción) → arranca en el compás 1; tocar 1–2 min con el M-Wave (escenas, silenciar/encender pistas; se puede cambiar de vista mientras). **■ parar y armar** (o el ■ del transporte) → la canción queda con secciones donde cambió algo y cada pista suena donde sonaba; ▶ canción reproduce lo tocado. Ctrl+Z vuelve al jam. Si una escena silencia algo que encendiste a mano encima, la escena manda (se ve rayado en rojo).
- [ ] **Automatización** (oído): botón **A** de una pista (con canción) → carril de volumen o filtro. Clic = punto, arrastrar = moverlo, doble clic = quitarlo (con un punto enfocado: ← → ↑ ↓ y Supr). Una subida de filtro de 8 compases antes del drop suena **continua** y cae justo en el drop; una bajada de volumen se oye bajar compás a compás. Funciona igual con «tocar desde», el loop de región y en cada vuelta de la canción; Ctrl+Z deshace.
- [ ] **Grabar las perillas** (oído): durante «● grabar jam», mover el volumen y el filtro de canal de una pista (perillas del M-Wave o del nodo) → al armar, esa pista tiene curvas (botón A) que repiten el movimiento; la perilla de volumen queda en el máximo que tocaste y la de filtro en 0.
- [ ] **Exportar a WAV** (oído): DAW → **⤓ exportar** → «canción completa» (o la región marcada). Graba en tiempo real con barra de progreso y ■ cancelar; el WAV dura exactamente los compases + 2,5 s de cola, arranca en el compás 1 (o el de la región) y termina con la cola, sin la vuelta siguiente. Suena igual que en vivo (escenas, automatización, máster).
- [ ] **Stems por pista** (oído, y en otro DAW): **⤓ exportar** → «stems por pista (ZIP)» → elegir pistas (+ «incluir la mezcla») → una pasada en tiempo real por pista (la estimación dice cuánto tarda). El ZIP trae un WAV por pista, todos del mismo largo y desde el compás 1: arrastrados juntos al compás 1 de Ableton / FL / Reaper a 0 dB **suenan como la mezcla sin el máster**; la mezcla del ZIP (con máster) queda alineada a la muestra con ellos. Cada stem lleva sus secciones, sus FX, su automatización y lo que las escenas le hacen; un bajo con sidechain del bombo bombea en su stem igual que en la mezcla. Las pistas en mute salen marcadas «en mute» y, si ninguna escena las cambia, desmarcadas.
- [ ] **Panel MIDI en la vista DAW**: arranca minimizado (🎛 MIDI en vivo ▸) y no tapa las pistas; si lo abres ahí, la DAW lo recuerda (también al recargar). En standard y DJ sigue como lo dejaste.
- [ ] **■ tras grabar el jam**: al «■ parar y armar», el tema se calla del todo (antes podía seguir sonando con el transporte en ■).

## 14 · Temas completos a calidad máster (Fases 4–7) — NUEVO, medido sin oír
- [ ] **Exportar sin tiempo real (4.2)**: ⤓ exportar → canción completa. Sale en menos tiempo de lo que dura el tema (en mi máquina de prueba, de 2 núcleos, ~1,7×; en tu PC debería ser bastante más rápido) y **suena igual que en vivo**: las escenas cambian la mezcla en su compás exacto, el máster con su limitador, la cola de la reverb hasta que se apaga. No se corta aunque el navegador se trabe. Después ▶ suena normal. (Medido: sin reverb, la diferencia con la exportación en tiempo real está 63 dB por debajo; con reverb, la reverb de superdough se genera al azar en cada arranque, así que nunca es idéntica ni entre dos exportaciones en tiempo real; con el bus apretado, mismo espectro ±0,1 dB y mismo nivel ±0,2 dB.)
- [ ] **Stems sin tiempo real**: los stems del tema completo salen en minutos, todos del mismo largo y alineados con la mezcla.
- [ ] **Volumen del máster (4.4)**: en ⤓ exportar elige «como suena», «streaming −14» o «club −8». El archivo queda en ese loudness (±0,2 LU) sin pasar −1 dBTP, y el menú muestra el informe (LUFS, pico real, LRA y cuánto se subió o bajó); en los stems va `informe.txt`. Oír el «club −8»: si el tema ya venía muy limitado, empujar más puede aplanarlo (el LRA bajo lo delata). Medido contra ffmpeg (ebur128): mismos valores ±0,1.
- [ ] **MIDI para Reaper (4.5)**: ⤓ exportar → «MIDI de la canción (.mid)» (también va dentro del ZIP de stems). Arrastrarlo a Reaper: una pista por instrumento con su nombre, el tempo del tema, la batería en el canal 10 (bombo 36, hats 42…), las secciones apagadas y los mutes de las escenas respetados.
- [ ] **Loops de Splice al tempo del tema (5.2)**: arrastra un loop de Splice (p. ej. `…_126_…_top_loop.wav`) al lienzo, o mándalo con ▸ desde «packs de sonido», en un tema a 132. Entra como `s("wl_…").slow(4)` con un chip «⇆ 126→132 bpm · 4 comp.»: **debe caer con el bombo y sonar en su tono** (estirado con Rubber Band). Mientras dice «estirando…» (1–5 s) suena una copia rápida, ya en la rejilla pero con el tono un poco corrido. Cambia el BPM con ▶: se vuelve a estirar solo. Si suena al doble o a la mitad de rápido, clic en el chip → ÷2 o ×2. Un sample largo que ya estaba en el lienzo: botón ⇆ de su barra. Oír sobre todo **las uniones de cada vuelta** en pads y bajos (no debe haber clic) y los golpes del loop contra tu bombo. Medido con loops de prueba: a los 5 minutos los golpes siguen a ±1,5 ms del bombo, el tono queda idéntico (439,95 Hz → 439,95 Hz; con varispeed habría subido a 460,9) y las uniones son continuas. Sobrevive a recargar la página.
- [ ] **Tonalidad del tema (5.1)**: clic en la letra grande de la barra (al lado de − +) → raíz y menor/mayor. La barra muestra la que **suena** (tonalidad + tono: A menor con +2 se ve «Bm +2»). Mirar que: un nodo «scale» nuevo arranca en esa escala; el piano roll de un clip vacío arranca en ella (filas con sus notas); el autotune de la voz abre en ella; el archivo exportado se llama `tema_132bpm_Am_master.wav`. Si el tema no tenía tonalidad y arrastras un loop de Splice que la trae (`…_Amin_…`), queda esa (te lo dice el aviso). Si los loops del proyecto traen otra, el selector la sugiere.
- [ ] **Formatos de entrega (4.3)**: en ⤓ exportar, escribe el **nombre del tema** y elige **WAV 24 bit** (para LabelGrid), 16 bit, 32 float o **MP3 320** (para el celular), y la frecuencia (la de tu audio sin convertir, o 44,1 / 48 kHz convertida con un filtro de alta calidad). El archivo sale como `pergolero_132bpm_master.wav`. Oír el MP3 en el celular y el WAV de 24 bit en Reaper: igual que en Telar.

## Interfaz / calidad visual (mirar, sin audio)
- [ ] **Paleta única**: el texto del editor de código de los nodos coincide con el resto de la UI; cables y puntos del lienzo se ven igual que siempre.
