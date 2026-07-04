// Proxy serverless SIN ESTADO para acortar el enlace de "Compartir por URL".
//
// El enlace largo de Telar lleva el patch entero comprimido en el hash (#p=…):
// funciona siempre, pero mide ~1.3–1.8 KB y los chats (WhatsApp/Telegram/Discord)
// lo parten al enviarlo. Lo pasamos por un acortador, que devuelve algo como
// da.gd/io1W3 y, al hacer clic, redirige al enlace largo CON su #p=… intacto (el
// fragmento se conserva en la redirección). Así no hace falta base de datos ni
// guardar nada: el acortador sólo almacena la redirección; el patch sigue viviendo
// en el propio enlace.
//
// Va server-side porque los acortadores no exponen Access-Control-Allow-Origin, de
// modo que un fetch directo desde el navegador queda bloqueado por CORS. Vercel lo
// despliega como función automáticamente por estar en /api (sin base de datos ni
// variables de entorno).
//
// Probamos varios proveedores en orden y nos quedamos con el primero que responda.
// da.gd y cleanuri devuelven una redirección limpia y directa; TinyURL es el último
// recurso (mete un salto de afiliado VigLink, feo pero funcional) sólo si los otros
// se caen.
const PROVIDERS = [
  // da.gd: respuesta en texto plano, redirección directa. El mejor.
  async (url) => {
    const r = await fetch('https://da.gd/s?url=' + encodeURIComponent(url));
    const t = (await r.text()).trim();
    return /^https?:\/\//.test(t) ? t : null;
  },
  // cleanuri: POST de formulario, responde JSON { result_url }.
  async (url) => {
    const r = await fetch('https://cleanuri.com/api/v1/shorten', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'url=' + encodeURIComponent(url),
    });
    const j = await r.json().catch(() => null);
    return j && typeof j.result_url === 'string' && /^https?:\/\//.test(j.result_url) ? j.result_url : null;
  },
  // TinyURL: último recurso (añade un salto de afiliado VigLink).
  async (url) => {
    const r = await fetch('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(url));
    const t = (await r.text()).trim();
    return /^https?:\/\//.test(t) ? t : null;
  },
];

export default async function handler(req, res) {
  // Vercel rellena req.query; si no, lo sacamos a mano del req.url por robustez.
  let url = req.query && req.query.url;
  if (!url && req.url) {
    const m = /(?:[?&])url=([^&]+)/.exec(req.url);
    if (m) {
      try {
        url = decodeURIComponent(m[1]);
      } catch {
        url = m[1];
      }
    }
  }
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'falta url' });
    return;
  }
  if (url.length > 8000) {
    res.status(413).json({ error: 'url demasiado larga' });
    return;
  }

  for (const provider of PROVIDERS) {
    try {
      const short = await provider(url);
      if (short) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ short });
        return;
      }
    } catch {
      // probamos el siguiente proveedor
    }
  }
  res.status(502).json({ error: 'ningún acortador disponible' });
};
