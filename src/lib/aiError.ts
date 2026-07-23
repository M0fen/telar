// Mensaje de fallo ÚTIL para las llamadas a la IA (Nod-IA / copiloto / reparación).
//
// La causa real más común NO es "la IA está caída": la función serverless muere a los
// 60 s (maxDuration, tope del plan) con peticiones grandes — una petición `act` real ya
// rondaba los 40 s. Cuando eso pasa, Vercel devuelve un 504/502 con cuerpo NO-JSON, y
// antes se mostraba un genérico ("no se pudo consultar a Nod-IA") que no decía qué hacer.
// Aquí traducimos el código de estado a algo accionable.
export function aiFailMsg(r: Response, who = 'Nod-IA'): string {
  if (r.status === 504 || r.status === 502 || r.status === 408)
    return `${who} tardó demasiado y el servidor cortó la petición (límite de 60 s). Prueba algo más corto y concreto, o pide un cambio a la vez.`;
  if (r.status === 429) return `${who}: demasiadas peticiones seguidas. Espera unos segundos y reintenta.`;
  if (r.status === 401 || r.status === 403)
    return `${who} no está autorizado (${r.status}): revisa ANTHROPIC_API_KEY en las variables de entorno de Vercel.`;
  if (r.status >= 500) return `${who} falló en el servidor (${r.status}). Reintenta; si sigue, mira los logs de la función en Vercel.`;
  return `no se pudo consultar a ${who} (${r.status})`;
}
