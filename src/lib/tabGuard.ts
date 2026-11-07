// Dos pestañas con Telar comparten el autoguardado: la última que guarda pisa a la otra. Al
// abrir una segunda, se avisa en las dos (una vez cada una).
export function watchOtherTabs(warn: (msg: string) => void): void {
  if (typeof BroadcastChannel === 'undefined') return;
  let ch: BroadcastChannel;
  try { ch = new BroadcastChannel('telar-pestanas'); } catch { return; }
  const me = Math.random().toString(36).slice(2);
  let warned = false;
  const tell = () => {
    if (warned) return;
    warned = true;
    warn('Telar está abierto en otra pestaña. Si editas en las dos, la última que guarde pisa a la otra: trabaja en una sola.');
  };
  ch.onmessage = (e: MessageEvent) => {
    const m = e.data as { t?: string; from?: string } | null;
    if (!m || m.from === me) return;
    if (m.t === 'hola') { ch.postMessage({ t: 'aqui', from: me }); tell(); }
    else if (m.t === 'aqui') tell();
  };
  ch.postMessage({ t: 'hola', from: me });
}
