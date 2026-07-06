# Escuchas pendientes — revisión general (acumulado)

Checklist de TODO lo aplicado desde la auditoría dancehall que falta validar a oído.
Marca cada punto al probarlo; si algo suena mal, ese punto manda sobre el roadmap.

## Mezcla que no pisa (P0.1)
- [ ] Demo **"latin dancehall"** → play: los hats se oyen DISCRETOS (no al nivel del kick). Mover **humanize del máster** no cambia el balance entre canales.
- [ ] Rejilla con **acento + ghost** en una pista → bajar el **fader** de ese canal a la mitad → la diferencia acento/ghost sigue oyéndose (solo baja el conjunto).
- [ ] Correr **⚡ auto-master**: aterriza el LUFS sin cambiar el balance relativo entre canales.
- [ ] Soltar el kit "dembow riddim" y editar un paso: el banco y los niveles se mantienen.

## Groove (P0.2 + P1.2 + P1.5)
- [ ] Hats en 16 pasos con **swing ~0.5** (≋): shuffle par-a-par real (larga-corta); el kick no se mueve.
- [ ] **timing** (panel ≋): caja del backbeat arrastrada +8/+12 ms → se "sienta atrás"; al centro → cuadrada. Arriba = adelanta.
- [ ] **vel** (panel ≋): crescendo de shaker dibujado → rampa audible.
- [ ] **humanize** (pista o máster): vida SIN que el patrón se sienta arrastrado hacia tarde.

## Secuenciador universal + secciones (P0.3)
- [ ] Demo "latin dancehall": cualquier source → secuenciador → **pestañas de sección**; editar la 1 no toca las demás.
- [ ] **▶** = la sección editada suena YA en loop; cambiar de pestaña con ▶ activo salta la audición.
- [ ] **Punto amarillo** = sección sonando ahora en el arreglo; el playhead se apaga si lo editado no es lo que suena.
- [ ] Sección **en silencio**: entra sembrada con las pistas/instrumento de la referencia; pintar la hace entrar. Nada de rejillas vacías.
- [ ] **Melodía** (bajo/melodía/skank): abre en REJILLA (pasos + afinar arrastrando ↕ + afinar todo); toggle **vista: 🎹 piano roll** funciona ida y vuelta; los acordes del skank sobreviven.
- [ ] Gestión: **−/＋ compases**, **⧉ duplicar** (edita la copia), **✚ silencio al final**, **× quitar**; en un source plano, **"secciones ＋ crear"** suena idéntico.
- [ ] "Canción" con secciones → **⇋ instrumentos** → todos los sources quedan alineados a esos compases.

## Dub y percusión (P1.3 + P1.4)
- [ ] Synth → espacio → **"tiempo eco"**: a 96 y a 140 BPM el eco cae en el grid (3/16 puntillo = dub).
- [ ] Canal → mezcla → **ECO** mantenido: throw dub sobre el skank; al soltar limpia.
- [ ] Rejilla con banco 808 → **+ añadir sonido → percusión → conga** → suena (antes: muda).
- [ ] Kit **"latin dancehall"** y demo **"latin dancehall · editable"**: suenan a riddim recién soltados y TODO es editable.

## Máster y salida (P1.1 + P1.6 + P2)
- [ ] **Mono-bajo**: width del máster a 1.6 con sub en c1 → en mono el bajo no se adelgaza.
- [ ] **WAV**: grabar ~2 min moviendo perillas/abriendo paneles → archivo sin chasquidos (worklet).
- [ ] **Escenas**: capturar una con filtro del máster cerrado y otra abierto → al saltar, el máster salta.
- [ ] **Canción**: los cambios de sección caen EN el 1 (anticipación), no un pelo tarde.
- [ ] **Caja por pista** (panel ≋): kick 808 + caja LinnDrum en la misma rejilla, cada una se pre-escucha con su máquina.
- [ ] **Freeze** de una sección larga (hasta 64 ciclos): el stem cierra bien.

## VoiceStudio (bloque nuevo — se completa al implementarse)
- [ ] **Autotune sin congelar**: aplicar autotune a una toma larga (30 s+) no congela la interfaz (corre en worker).
- [ ] **Calidad R3**: A/B del autotune/warp aplicado — debe sonar más limpio (menos artefactos) que antes.
- [ ] **Tiempo del eco de voz**: el delay de la voz cae al tempo con la subdivisión elegida (dub 3/16).
