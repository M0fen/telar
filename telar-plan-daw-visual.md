# Telar · plan DAW visual (Fases 8–12)

Estado: **propuesto, esperando el OK de Carlos.** No se toca código hasta que lo apruebe.
Informe completo (capturas, comparación de 116 ayudas en 15 áreas, maqueta, fuentes):
https://claude.ai/artifact/GsngUdVTPAPHDSMoHrxxuF

## Diagnóstico (26-10-2026, plantilla groove techno, 1600×900)

1. **Poco espacio.** Lienzo libre ≈35 %: máster 516 px a la izquierda, paleta 210 px a la derecha,
   visualizador 236 px abajo. Grafo al 64 % (texto ≈7 px). Rejilla y piano roll dentro del nodo (≈180 px).
2. **Los compases no se leen.** Regla solo con números de compás (cada 1, 4 u 8; zoom 10–96 px/compás, solo
   con − / +). Sin pulsos, contador, 4/4, metrónomo ni cuenta previa; se ve «cps» y «/4». Bloques = secciones
   enteras; 32 pasos = fusas de un compás (no hay patrones de 2 o 4 compases).
3. **No se ve lo que suena.** Bloques verdes iguales sin golpes, notas ni ondas; sin color por pista; sin
   mezclador; espectro sin ejes.

Comparación: 116 ayudas → Telar tiene 11, 56 a medias (muchas ya están en el motor: vel/timing/roll/prob por
paso, swing y humanize, rebanador, warp con tonalidad, curva del compresor), faltan 49.

## Decisiones

- **Compases primero** (8.1–8.3): es lo que más se nota y funciona con los bloques actuales.
- **Panel de detalle abajo** (8.6 + 9.2/9.4/9.5): los editores salen de los nodos.
- **Clips libres** (10.1): los brazos del `arrange` de cada pista caen donde estén sus clips y las secciones
  pasan a ser una pista de arreglo (como el Arranger de Studio One/Cubase) que mueve clips, curvas y
  transiciones. Resuelve el pendiente de las curvas y transiciones que no se corren. Es el cambio más grande:
  va después de la regla y del contenido visible.
- Diferenciales que ningún DAW trae de serie y Telar ya tiene a medias: superficie de mezcla espacial (11.6),
  referencia A/B con nivel igualado, LUFS en el máster.

## Fase 8 · Espacio y tiempo

Que se vea y se mida como un DAW. Primero los compases, que es lo que más se nota; después el espacio.

- **8.1** (M) **Regla de compases con pulsos.** Compás, pulso y semicorchea según el zoom, sombra cada 4 compases y rejilla magnética a elegir (compás, 1/2, 1/4, 1/8, 1/16, tresillos).
  - Listo cuando: con zoom se ven los pulsos y la rejilla rige regiones, puntos de automatización y transiciones.
- **8.2** (S) **Transporte musical.** Contador «compás.pulso.semicorchea» y minutos, «4/4» en lugar de «/4», cps fuera de la vista.
  - Listo cuando: el contador sigue lo que suena con menos de una semicorchea de error.
- **8.3** (S) **Metrónomo y cuenta previa.** Clic con acento en el 1; 1 o 2 compases de cuenta antes de grabar el jam o los pads.
  - Listo cuando: el clic cae en los pulsos y la cuenta no entra en la toma.
- **8.4** (M) **Navegación.** Ctrl+rueda o pellizco hace zoom donde está el ratón, la rueda desplaza, seguir el cabezal, zoom a la canción o a la selección, bucle con asas en la regla, clic en la regla para tocar desde ahí.
- **8.5** (S) **Color por pista.** Automático por tipo (batería, bajo, sinte, FX, voz) y editable; el mismo color en el DAW, el grafo, el mezclador y los editores.
- **8.6** (L) **Paneles acoplables.** Biblioteca a la izquierda, inspector a la derecha, panel de detalle abajo, visualizador plegable a una franja; tamaños recordados.
  - Listo cuando: a 1600×900, con los paneles abiertos, el lienzo o la línea de tiempo usan al menos el 65 % de la pantalla.
- **8.7** (M) **Grafo legible.** Zoom inicial que se lee, orden automático (fuentes → efectos → salida), minimapa, nodos que no se montan y nodos plegados con una miniatura de su patrón.

## Fase 9 · Ver la música

Que se vea lo que suena y que se edite en grande.

- **9.1** (M) **Contenido dentro de los bloques.** Golpes por sonido, notas por altura y onda de los loops, con nombre y una marca en cada vuelta del patrón.
  - Listo cuando: cada pista de la plantilla se reconoce sin oírla y el dibujo cambia al editar.
- **9.2** (L) **Rejilla grande en el panel de detalle.** Una fila por sonido con nombre y escucha, pasos agrupados por pulso, carriles de velocidad, largo, repeticiones, micro-timing y probabilidad (el motor ya los tiene), herramientas de llenar cada N, rotar y euclidiano, y el cabezal corriendo.
  - Listo cuando: un patrón de la plantilla se edita entero sin abrir menús por paso.
- **9.3** (M) **Patrones de 1, 2 y 4 compases.** 16 pasos por compás en la rejilla y en el DAW, en lugar de subir la resolución; largo propio por fila (polimetría) y condiciones por vuelta (1 de cada N, solo en el fill).
  - Listo cuando: un hat de 2 compases se ve y suena como 2 compases y el código sigue siendo editable.
- **9.4** (L) **Piano roll grande.** Teclado que suena, escala del tema resaltada y «plegar a la escala», notas largas y acordes, notas fantasma de otras pistas, carril de velocidad y la vista centrada en las notas.
  - Listo cuando: el bajo y un stab de acordes se escriben sin tocar el código.
- **9.5** (M) **Editor de loops y samples.** Onda grande con asas de inicio, fin, bucle y fundidos; rebanadas y marcadores de warp que se arrastran sobre la onda; invertir y tono por clip.
- **9.6** (M) **Cabeceras de pista.** Medidor vertical con pico, volumen y paneo, altura ajustable y carpetas (batería, bajos, FX).
- **9.7** (M) **Pads de batería.** 16 pads con nombre y onda, cadena de efectos por pad, grupos de corte (el hat cerrado corta al abierto), cambiar el sample escuchándolo dentro del patrón y guardar lo que acabas de tocar aunque no estuvieras grabando.

## Fase 10 · Arreglo libre

Compases de verdad: clips donde quieras y secciones que mueven todo junto.

- **10.1** (L) **Clips libres por compás.** El arrange de cada pista cae donde estén sus clips; las secciones pasan a ser una pista de arreglo.
  - Listo cuando: un clip de 2 compases dentro de una sección de 16 suena donde está, y deshacer es un solo paso.
- **10.2** (L) **Editar clips.** Partir (Ctrl+E), unir, estirar el borde para repetir, duplicar (Ctrl+D), arrastrar entre compases y pistas, copiar y pegar.
- **10.3** (M) **Pista de arreglo.** Mover, duplicar o insertar una sección mueve sus clips, sus curvas de automatización y sus transiciones.
- **10.4** (M) **De la biblioteca al compás.** Escuchar a tempo y en la tonalidad del tema mientras suena, y arrastrar el loop o el sonido a una pista, a un compás o a un pad.
- **10.5** (S) **Marcadores y minimapa.** Marcadores con nombre y una vista de toda la canción con la energía de cada sección.

## Fase 11 · Mezcla visual

Ver la mezcla en lugar de adivinarla.

- **11.1** (L) **Mezclador.** Tiras con color, medidor pico/RMS con retención y aviso de clip, fader en dB, paneo, envíos, EQ y compresor, inserts en orden; retornos y máster con LUFS.
- **11.2** (M) **EQ visual por pista.** Puntos que se arrastran sobre el espectro en vivo, con la opción de ver otra pista encima para encontrar choques.
- **11.3** (M) **Compresor y sidechain a la vista.** Curva de transferencia e historial de reducción de ganancia en cada pista.
- **11.4** (M) **Análisis del máster.** Analizador con ejes en Hz y dB, medidor de estéreo y correlación, historial de LUFS.
- **11.5** (M) **Cadena y modulación.** Cadena de efectos de la pista en el inspector, perillas con un anillo que muestra su automatización o modulación, y macros.
- **11.6** (M) **Escenario espacial.** La superficie de mezcla en vivo dentro del mezclador: cada pista es un punto que se ilumina con su nivel, paneo a lo ancho, frecuencia a lo alto, y avisa cuando dos pistas chocan. Ningún DAW lo trae de serie.

## Fase 12 · Flujo

Rapidez y aprendizaje.

- **12.1** (M) **Atajos y paleta de comandos.** Atajos para todo, una hoja de atajos con «?» y Ctrl+K para buscar cualquier acción.
- **12.2** (S) **Ayuda contextual.** Una línea abajo que explica lo que hay bajo el ratón.
- **12.3** (S) **Historial de deshacer visible.** Lista de pasos para volver a cualquiera.
- **12.4** (S) **Carga del audio.** Medidor de CPU y aviso antes de que el audio se corte.
- **12.5** (L) **Lanzador de clips.** Pistas × variaciones, lanzadas a tiempo, y la improvisación grabada al arreglo.
