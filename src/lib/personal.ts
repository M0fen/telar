// Herramientas PERSONALES (bajar de YouTube y grabar a tu PC — necesitan `npm run dev` —, y
// el banco «mi nube» con contraseña) quedan ocultas para el público. Se activan en este
// navegador con ?personal=1 en la dirección (y se quitan con ?personal=0); en `npm run dev`
// están siempre.
const KEY = 'telar.personal';
let cached: boolean | null = null;
export function personalTools(): boolean {
  if (cached !== null) return cached;
  try {
    const q = new URLSearchParams(location.search).get('personal');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    cached = import.meta.env.DEV || localStorage.getItem(KEY) === '1';
  } catch {
    cached = !!import.meta.env.DEV;
  }
  return cached;
}
