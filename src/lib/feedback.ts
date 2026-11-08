// «OPINAR» SIN CUENTA: casi ningún probador tiene GitHub, así que la opinión se arma en Telar y se
// abre en WhatsApp para que la persona la mande (Telar no envía nada solo). GitHub queda de segunda
// opción. El número es el de contacto público de PuntoNeutro: cámbialo aquí si hace falta.
export const FEEDBACK_WHATSAPP = '573122143556';

export const MODE_LABEL: Record<string, string> = { standard: 'grafo', daw: 'DAW', dj: 'DJ' };

// navegador y sistema en corto (no el user agent entero)
export function browserShort(ua: string): string {
  const b = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}` : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}` : 'otro navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} · ${os}` : b;
}

export interface Feedback { mode: string; text: string; name?: string; version?: string; ua?: string }

export function feedbackMessage(f: Feedback): string {
  const lines = [`Telar · opinión (${MODE_LABEL[f.mode] ?? f.mode})`, '', f.text.trim()];
  if (f.name?.trim()) lines.push('', `— ${f.name.trim()}`);
  const meta = [f.version ? `versión ${f.version.slice(0, 7)}` : '', f.ua ? browserShort(f.ua) : ''].filter(Boolean).join(' · ');
  if (meta) lines.push('', meta);
  return lines.join('\n');
}

export const whatsappUrl = (msg: string, phone = FEEDBACK_WHATSAPP) => `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
export const githubIssueUrl = (msg: string) => `https://github.com/M0fen/telar/issues/new?body=${encodeURIComponent(msg)}`;
