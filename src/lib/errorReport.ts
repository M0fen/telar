// Errores que nadie atrapó → /api/errores (registro de Vercel). Cada mensaje una sola vez por
// sesión y como mucho 5 por sesión; sin contenido del proyecto. En `npm run dev` no se manda.
const sent = new Set<string>();
let count = 0;
const VERSION = (import.meta.env.VITE_COMMIT as string | undefined) ?? 'dev';

export function reportError(kind: 'error' | 'promesa' | 'render', err: unknown, where = ''): void {
  try {
    if (import.meta.env.DEV) return;
    const e = err instanceof Error ? err : new Error(String((err as { message?: unknown } | null)?.message ?? err));
    const message = (e.message || String(err)).slice(0, 400);
    if (!message || sent.has(message) || count >= 5) return;
    sent.add(message);
    count++;
    const body = JSON.stringify({ kind, message, stack: (e.stack ?? '').split('\n').slice(0, 8).join('\n'), version: VERSION, where: where.slice(0, 80) });
    const blob = new Blob([body], { type: 'application/json' });
    if (!navigator.sendBeacon?.('/api/errores', blob)) void fetch('/api/errores', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch {
    /* reportar nunca rompe nada */
  }
}

export function watchErrors(): void {
  window.addEventListener('error', (e) => reportError('error', e.error ?? e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : ''));
  window.addEventListener('unhandledrejection', (e) => reportError('promesa', e.reason));
}
