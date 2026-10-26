# Telar — Modo DAW · Fase 3 (automatización + exportar)

**Aprobada por Carlos el 2026-10-25** junto con la Fase 2. Mismo protocolo. **Hecho:** 3.1 (`c268ab2`) · 3.2 (`5650189`) · 3.3 (`b1a67f8`) · 3.4 (`4be788f`). **Fase 3 hecha.** Arreglos tras la verificación final con el tema de las aves: `60dea84` (■ ya no deja el reloj sonando si llega durante un swap) · `1c246fa` (automatización a prueba de JSON roto) · `c8a6bdb` (menús dentro de la pantalla en el teléfono) · `6a858ca` (stems: las pistas que serían silencio salen desmarcadas). Orden fijo: 3.1 → 3.2 → 3.3 → 3.4.

**Qué entrega:** curvas de volumen y filtro por pista dibujadas sobre los compases (y grabadas desde las perillas mientras tocas), y sacar el tema: la canción o una región a WAV y los stems por pista en un ZIP.

**No entra:** automatizar parámetros de nodos FX arbitrarios, render offline más rápido que el tiempo real (`renderPatternAudio` no lleva el bus de Telar), tempo variable.

---

## 3.1 · Automatización de volumen y filtro por pista
- **Archivos:** `src/graph/types.ts` (`data.auto`), `src/graph/compile.ts` (`applyAutomation`), `src/store/useGraphStore.ts` (largo de la canción al compilar), `src/lib/automation.ts` (nuevo: puntos, interpolación, edición), `src/ui/DawView.tsx` (carril bajo la pista), tests.
- **Hacer:** `data.auto = { vol?: [compás, valor][], filt?: [compás, valor][] }` (vol 0–1.5 multiplica; filtro −1…1 como la perilla del canal: <0 paso-bajo, >0 paso-alto). Se compila como sufijo del Source: `.withHap(...)` que lee el compás de la canción del propio evento (funciona con `from`, región y bucles) → `velocity` × curva (sin salto de nivel) y `cutoff`/`hcutoff` COMPUESTOS con los de la voz (un paso-bajo nunca abre). Rampas lineales entre puntos; se repite con la canción. Carril: botón «A» en la pista, elegir volumen/filtro, clic = punto, arrastrar = mover, doble clic = borrar, «borrar curva».
- **Tests:** sin puntos → código idéntico; valores en compases exactos e intermedios con Strudel real; composición con el filtro de la voz; con `.early(from)`.
- **Aceptación (oído):** una subida de filtro de 8 compases antes del drop suena continua y cae justo en el drop.
- **Commit:** `feat(daw): automatización de volumen y filtro`

## 3.2 · Grabar automatización desde las perillas
- **Archivos:** `src/lib/jamRecorder.ts`, `src/lib/automation.ts`, tests.
- **Hacer:** mientras se graba el jam (2.5), cada ¼ de compás se anota el volumen (`gain`) y el filtro de canal (`chFilter`) de cada pista; al parar se convierten en curvas (se quitan puntos redundantes) y la perilla queda neutral (filtro 0; volumen = el último) para que la curva mande.
- **Tests:** muestreo sintético → curva reducida que pasa por los puntos.
- **Commit:** `feat(daw): grabar automatización desde las perillas`

## 3.3 · Exportar la canción (o una región) a WAV
- **Archivos:** `src/lib/songExport.ts` (nuevo), `src/ui/DawView.tsx` (diálogo con progreso y cancelar).
- **Hacer:** detiene, arranca desde el compás 1 (o el inicio de la región) sin bucle y graba el tap post-máster exactamente N compases + 2 s de cola (reverb/delays); descarga `nombre-del-tema.wav` (32-bit float). En tiempo real (dura lo que la canción); barra de progreso con la línea de reproducción; cancelar deja todo como estaba.
- **Aceptación:** el WAV dura N compases + cola, empieza en el compás 1 y suena igual que en vivo.
- **Commit:** `feat(daw): exportar canción y región a WAV`

## 3.4 · Exportar stems por pista (ZIP)
- **Archivos:** `src/lib/songExport.ts`, `src/lib/zip.ts` (nuevo, ZIP sin compresión, sin dependencias), `src/graph/compile.ts` (`only`: compilar una sola pista con sus FX, respetando sus mutes por sección), `src/ui/DawView.tsx`.
- **Hacer:** elegir pistas → una pasada en tiempo real por pista (aislada aunque las escenas cambien solos), tap PRE-bus (sin limitador del máster), mismo largo exacto para todas → `stems-nombre.zip` con un WAV por pista (+ mezcla opcional). Estimación del tiempo antes de empezar.
- **Tests:** ZIP válido (cabeceras y CRC); `only` deja solo esa rama y conserva su `arrange`.
- **Commit:** `feat(daw): exportar stems por pista`
