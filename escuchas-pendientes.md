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

---

## Interfaz / calidad visual (mirar, sin audio)
- [ ] **Paleta única**: el texto del editor de código de los nodos coincide con el resto de la UI; cables y puntos del lienzo se ven igual que siempre.
