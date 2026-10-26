# Telar — Temas completos a calidad máster (Fases 4–7)

**Aprobada por Carlos el 2026-10-26** («adelante con todo»). **Hecho:** 4.1 (`1edd2b8`) · 4.2 (`0138a65`) · 4.3 (`0b7703b`) · 4.4 (`81a6be8`) · 4.5 (`9232792`). **Fase 4 hecha.** Fase 5: 5.2 (`a2aa2cd`) · 5.1 (`bb2acb0`) · 5.3 (`a7762df`) · 5.4 (`d792393`) · 5.5 (`34b92e3`). **Fase 5 hecha.** Fase 6: 6.1 (`27f74d2`) · 6.3 (`891df2d`) · 6.2 (`397502e`) · 6.4 (`309e6ee`). **Fase 6 hecha.** Fase 7: 7.1. Mismo protocolo de `CLAUDE.md`: una tarea por commit → `npm run build` + `npm test` → verificación medida (Node + Chromium sin pantalla) → lo que hay que oír va a `escuchas-pendientes.md`. Tamaño: S (chica), M (media), L (grande).

**Objetivo:** hacer en Telar un tema completo, desde los loops de Splice hasta el máster, y sacarlo listo para LabelGrid, para Reaper y para el celular, sin perder calidad en ningún paso.

---

## Dónde estamos (verificado en el código)

**Ya está:** el DAW (Fases 0–3); el máster con EQ, glue, saturación, ancho, punch y limitador true-peak; el medidor LUFS en vivo; el EQ por canal (orbits); el sidechain real (duck); los secuenciadores con slide de 808, ratchets, acordes y groove; el estudio de voz con autotune y Rubber Band; los packs propios desde una carpeta (IndexedDB), que leen el BPM y la tonalidad de los nombres de Splice (`splice.ts`); la detección de BPM; el MIDI en vivo.

**Lo que frena un tema completo a calidad máster:**
1. **Exportar es en tiempo real** (`songExport.ts`). Tarda lo que dura el tema en cada pasada (los stems del tema de las aves, unos 30 min), depende de que el navegador no se trabe y sale siempre a la frecuencia de la tarjeta, en 32-bit float y sin informe de loudness. El `renderPatternAudio` de Strudel no sirve tal cual: cierra el audio en vivo y no lleva el bus de Telar ni las escenas, que hoy cambian la mezcla en el momento desde `SongEngine`.
2. **Los loops de Splice no van al tempo del tema.** `sampleSourceCode` los toca a su tempo natural (`.slow(N)`): un loop de 126 BPM en un tema de 132 se va corriendo del bombo. La única alternativa, `loopAt`, cambia el tono. Rubber Band ya está en Telar, pero solo lo usa el estudio de voz.
3. **No existe la tonalidad del tema** (solo «tono», que transpone). Ni los samples ni el MIDI saben en qué tonalidad estás.
4. **Mezcla:** el compresor es por voz (`.compressor` de superdough), no por pista. No hay medidor por pista con margen ni una pista de referencia para comparar.
5. **Componer:** los pads del M-Wave controlan la mezcla pero no graban golpes. No hay MIDI de archivo (.mid) de entrada ni de salida. Solo se automatizan el volumen y el filtro.

---

## Fase 4 · Exportar a calidad máster (render offline) — primero

### 4.1 · Canción horneada con sus escenas (L)
- **Archivos:** `src/lib/songBake.ts` (nuevo), `src/graph/compile.ts`, `src/store/useScenesStore.ts` (solo lectura), tests.
- **Hacer:** convertir canción + escenas en UN patrón. Por sección: el estado de mezcla de su escena (los nodos que la escena no guarda siguen como venían de la sección anterior) → `compileGraph` con ese estado → recortado a los compases de esa sección (`filterHaps` por compás de canción; las colas de notas largas conservan la mezcla con la que arrancaron, igual que en vivo). Lo que las escenas cambian en el BUS del máster (filtro/drive DJ, EQ, glue…) sale como una línea de tiempo de parámetros por sección.
- **Tests:** mismos eventos (inicio y valor) que compilar sección por sección; una escena que silencia una pista → sin eventos de esa pista en esa sección; sin escenas → el código de siempre.
- **Commit:** `feat(export): canción horneada con sus escenas`

### 4.2 · Render offline con el bus de Telar (L)
- **Archivos:** `src/audio/offlineRender.ts` (nuevo), `src/audio/engine.ts` (el bus y el EQ por canal se construyen para cualquier contexto sin pisar los del contexto en vivo), `src/audio/masterLimiter.ts`, `src/lib/songExport.ts`.
- **Hacer:** `OfflineAudioContext` a 44,1 o 48 kHz con un controlador de superdough propio (se cambia y se devuelve el del audio en vivo, sin cerrarlo). Mismo bus: EQ, glue, saturación, ancho, punch, filtro/drive DJ, limitador TP, EQ por canal sobre los orbits y sidechain. Los eventos se agendan por tramos con `suspend()`, para que la memoria no se dispare en temas de 7 minutos. El bus se automatiza por sección (4.1). La cola sigue hasta que el audio cae bajo −90 dB (máx. 10 s). Exportar pasa a usar esto; el tiempo real queda de respaldo.
- **Tests (Chromium):** null test contra la exportación en tiempo real (residuo < −60 dB con el bus apagado, < −40 dB encendido); mismo largo; varias veces más rápido que el tiempo real con el tema de las aves.
- **Resultado:** sin reverb, −63 dB. Con reverb no hay null posible: superdough genera la reverb al azar en cada arranque (dos exportaciones en tiempo real tampoco coinciden). Con el bus apretado (glue + saturación + limitador), los compresores de Web Audio calculan su ganancia por bloques: dos exportaciones en tiempo real difieren lo mismo que offline vs tiempo real (−18 dB en los compases con hats), con el mismo espectro ±0,1 dB y el mismo nivel ±0,2 dB. Velocidad en la máquina de prueba (2 núcleos): 1,7–1,9× el tiempo real con el tema de las aves (80 compases en 78 s), 4× por stem; el render offline usa un solo hilo, así que en una PC normal rinde más. Escenas verificadas (silencio y filtro del máster en su compás exacto); el audio en vivo funciona después.
- **Aceptación (oído):** el WAV offline suena igual que en vivo.
- **Commit:** `feat(export): render offline con el bus de Telar`

### 4.3 · Formatos de entrega (M)
- **Hacer:** WAV de 24 bit (por defecto) o 16 bit con dither TPDF, o 32 float; 44,1 o 48 kHz; MP3 de 320 kbps para escuchar en el celular (lamejs, LGPL → compatible con AGPL). Nombre con datos: `pergolero_132bpm_Fm_master.wav`.
- **Tests:** cabeceras y profundidad correctas; el dither no pasa de ±1 LSB; MP3 válido.
- **Commit:** `feat(export): formatos de entrega`

### 4.4 · Informe y objetivo de loudness (M)
- **Hacer:** medir el archivo renderizado: LUFS integrada (BS.1770-4), corta máxima, LRA, true peak y clipping. Objetivos: streaming (−14 LUFS, −1 dBTP), club (−8 LUFS, −1 dBTP) o a mano. «Ajustar al objetivo» = dos pasadas offline moviendo la entrada del limitador, sin pasar nunca el techo. El informe va junto al WAV (y dentro del ZIP).
- **Tests:** medición contra señales de referencia del estándar (1 kHz a −23 LUFS, etc.).
- **Commit:** `feat(export): informe de loudness y ajuste al objetivo`

### 4.5 · Stems offline + MIDI para Reaper (M)
- **Hacer:** stems por render offline (minutos en vez de media hora). MIDI tipo 1 con una pista por instrumento (notas, duración y velocidad; la batería con notas GM), más tempo y compás, para arrastrarlo a Reaper y seguir editando.
- **Tests:** .mid válido (cabeceras, deltas, tempo) y con las mismas notas que el patrón.
- **Commit:** `feat(export): stems offline y MIDI`

---

## Fase 5 · Splice al tema

### 5.1 · Tonalidad del tema (S)
Raíz + modo en la barra, junto al BPM. La usan los secuenciadores (escala por defecto), los nombres de exportación y la 5.3. Se sugiere a partir de los samples de Splice que traen tonalidad.

### 5.2 · Loops al BPM del tema sin cambiar el tono (L)
Rubber Band offline al importar o arrastrar un loop (BPM del nombre de Splice o detectado). La copia estirada se guarda en IndexedDB y se vuelve a estirar si cambias el BPM. El loop queda en la rejilla sin varispeed.
**Aceptación (oído):** un loop de 126 BPM en un tema de 132 sigue cayendo con el bombo a los 5 minutos, sin cambiar de tono.

### 5.3 · A la tonalidad del tema (M)
Los loops y one-shots tonales se transponen a la tonalidad del tema (Rubber Band; con formantes para voces), con opción de ± octava.

### 5.4 · Rebanador (M)
Un loop → 8, 16 o 32 rebanadas, o cortes por transientes, que se tocan desde el secuenciador o los pads del M-Wave (`.slice`): para reordenar los top loops de Splice.

### 5.5 · Importar MIDI (.mid de Splice) al secuenciador melódico (M)
Notas, duración y velocidad; cuantización opcional.

---

## Fase 6 · Mezcla de verdad

### 6.1 · Compresor por pista en su bus (M)
Igual que el EQ por canal (orbit): umbral, ratio, ataque, release, makeup y medidor de reducción. Entra en las escenas y en el render offline.

### 6.2 · Medidores por pista y margen (S)
Pico/RMS por pista; aviso cuando la suma pasa de 0 dB antes del máster (gain staging) y botón «dejar margen».

### 6.3 · Pista de referencia A/B (M)
Cargar un tema de referencia de tu carpeta, igualado en loudness; alternar A/B con un botón o un pad; su espectro encima del tuyo.

### 6.4 · Envíos de reverb y delay compartidos (M)
Dos retornos (reverb y delay a tempo) con su EQ, y envío por pista. Hoy cada pista con EQ va a su propio orbit y con él a su propia reverb.

---

## Fase 7 · Componer y arreglar más rápido

### 7.1 · Grabar golpes desde los pads del M-Wave (M)
Modo notas en los 16 pads (batería o escala del tema); grabación cuantizada, con velocidad, al secuenciador y en bucle.

### 7.2 · Automatizar cualquier perilla (M)
Parámetros de FX, envíos y máster en el carril A del DAW, y grabarlos desde el M-Wave durante el jam.

### 7.3 · Fills y variaciones (M)
Partir un bloque dentro de la sección (p. ej., el último compás de cada 8 o 16) con otro patrón: «variación cada N compases».

### 7.4 · Transiciones (S)
Riser, impacto, barrido de filtro y reverso a tempo, colocables en el DAW.

### 7.5 · Plantilla groove techno (S)
Pistas típicas ya ruteadas (bombo + rumble con sidechain, bajo, hats, perc, top loop, FX, retornos) y máster preparado para −8 LUFS.

---

## Orden
Fase 4 completa → Fase 5 (5.2 primero) → Fase 6 → Fase 7. La 4 va primero porque es la que entrega el tema a calidad máster; la 5, porque es como Carlos arma los temas (desde Splice).
