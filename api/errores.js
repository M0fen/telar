// REGISTRO DE ERRORES de la app: el navegador manda (sendBeacon) el mensaje y el comienzo de la
// pila de un error que no se atrapó; aquí solo se escribe en el registro de Vercel (Runtime
// Logs) para enterarse de lo que falla en el PC de otros. Sin contenido del proyecto, sin IP
// guardada (la guardia la usa solo para el límite) y con tope de tamaño.
import { guard, readBody } from './_lib/guard.js';

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'usa POST' }); return; }
  if (!(await guard(req, res, 'errores', { maxBody: 8 * 1024 }))) return;
  const b = readBody(req);
  const entry = {
    kind: clip(b.kind, 20),
    message: clip(b.message, 400),
    stack: clip(b.stack, 1200),
    version: clip(b.version, 20),
    where: clip(b.where, 80),
    ua: clip(req.headers['user-agent'], 160),
  };
  if (!entry.message) { res.status(400).json({ error: 'sin mensaje' }); return; }
  console.error('[telar-error]', JSON.stringify(entry));
  res.setHeader('Cache-Control', 'no-store');
  res.status(204).end();
}
