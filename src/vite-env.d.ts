/// <reference types="vite/client" />

declare module '@strudel/web';

// Rubber Band (WASM, GPL-2.0) — módulo Emscripten sin tipos. Factory por defecto que
// resuelve al Module con la API C (_rubberband_*) + heap (_malloc/HEAPF32). HILO B / B1.
declare module '@echogarden/rubberband-wasm' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createRubberband: (opts?: { locateFile?: (path: string) => string }) => Promise<any>;
  export default createRubberband;
}
