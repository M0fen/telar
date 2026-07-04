import { create } from 'zustand';

// BANCO PROPIO EN LA NUBE (autohospedaje, p.ej. Cloudflare R2): el usuario guarda la
// URL base pública de su bucket + la lista de samples (nombre → archivo). Se persiste
// en localStorage y se re-registra al reproducir, para que s("nombre") suene desde SU
// bucket sin arrastrar nada cada sesión. El audio se sirve vía el proxy /api/sample
// (la URL r2.dev no aplica CORS). Licencia: bucket para uso PROPIO (no publicar Splice
// de pago en app pública). Ver [[dj-mode-y-biblioteca]] / fase02-sonido-pro.
export interface CloudItem { name: string; file: string }

const KEY = 'telar.cloudbank.v1';
interface Persisted { baseUrl: string; items: CloudItem[] }
function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
    return { baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '', items: Array.isArray(p.items) ? p.items : [] };
  } catch {
    return { baseUrl: '', items: [] };
  }
}
function persist(p: Persisted): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

interface State {
  baseUrl: string;
  items: CloudItem[];
  setBaseUrl: (u: string) => void;
  addItem: (it: CloudItem) => void;
  removeItem: (name: string) => void;
}

export const useCloudBankStore = create<State>((set, get) => {
  const init = load();
  return {
    baseUrl: init.baseUrl,
    items: init.items,
    setBaseUrl: (u) => {
      const baseUrl = u.trim();
      persist({ baseUrl, items: get().items });
      set({ baseUrl });
    },
    addItem: (it) => {
      if (!it.name || !it.file || get().items.some((x) => x.name === it.name)) return;
      const items = [...get().items, it];
      persist({ baseUrl: get().baseUrl, items });
      set({ items });
    },
    removeItem: (name) => {
      const items = get().items.filter((x) => x.name !== name);
      persist({ baseUrl: get().baseUrl, items });
      set({ items });
    },
  };
});
