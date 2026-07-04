import { soundMap } from '@strudel/web';
import { getVoiceUrl } from './voiceUrls';
import { useDownloadsStore } from '../store/useDownloadsStore';

// Resuelve el NOMBRE de un sample (`s("amen")`) a una URL reproducible, para poder
// decodificarlo (duración) y detectar su BPM. Busca en: (1) registro propio de voces,
// (2) descargas, (3) el mapa de sonidos de Strudel (prebake + packs cargados).

function firstUrl(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) {
    for (const e of x) { const u = firstUrl(e); if (u) return u; }
    return null;
  }
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) { const u = firstUrl(v); if (u) return u; }
  }
  return null;
}

export function resolveSampleUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  const v = getVoiceUrl(name);
  if (v) return v;
  const t = useDownloadsStore.getState().tracks.find((x) => x.name === name);
  if (t) return t.file;
  try {
    const map = (soundMap as unknown as { get?: () => Record<string, unknown> }).get?.() ?? {};
    const entry = map[name] as { data?: { samples?: unknown; baseUrl?: string; base?: string } } | undefined;
    if (!entry || !entry.data) return null;
    let url = firstUrl(entry.data.samples);
    if (!url) return null;
    if (/^(https?:|blob:|data:|\/)/.test(url)) return url;
    const base = entry.data.baseUrl || entry.data.base || '';
    try { return new URL(url, base || location.href).href; } catch { return base + url; }
  } catch {
    return null;
  }
}

// Extrae el primer nombre de sample de un código (`s("amen")` / `sound("bd ...")`).
export function firstSampleName(code: string): string | null {
  const m = /\b(?:s|sound)\(\s*["'`]([^"'`]+)/.exec(code || '');
  if (!m) return null;
  const tok = /[A-Za-z_][A-Za-z0-9_]*/.exec(m[1]);
  return tok ? tok[0] : null;
}

// Extrae el N de un `.loopAt(N)` del código (o null si no hay).
export function loopAtValue(code: string): number | null {
  const m = /\.loopAt\(\s*([0-9.]+)\s*\)/.exec(code || '');
  return m ? Number(m[1]) : null;
}
