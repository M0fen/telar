// Almacenamiento de patrones. Empezamos en localStorage; la interfaz está
// pensada para migrar luego a una base más elaborada (API/IndexedDB/Supabase…)
// sin tocar la UI: basta con otra implementación de PatternStore.

export interface SavedPattern {
  id: string;
  name: string;
  code: string;
  createdAt: number;
}

export interface PatternStore {
  list(): SavedPattern[];
  save(p: { id?: string; name: string; code: string }): SavedPattern;
  remove(id: string): void;
}

const KEY = 'telar.patterns.v1';

function read(): SavedPattern[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedPattern[]) : [];
  } catch {
    return [];
  }
}
function write(list: SavedPattern[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('patternStore: no se pudo guardar', e);
  }
}

// Implementación localStorage (la actual).
export const localPatternStore: PatternStore = {
  list: () => read().sort((a, b) => b.createdAt - a.createdAt),
  save: ({ id, name, code }) => {
    const list = read();
    const existing = id ? list.find((p) => p.id === id) : undefined;
    if (existing) {
      existing.name = name;
      existing.code = code;
      write(list);
      return existing;
    }
    const p: SavedPattern = {
      id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || 'patrón',
      code,
      createdAt: Date.now(),
    };
    write([p, ...list]);
    return p;
  },
  remove: (id) => write(read().filter((p) => p.id !== id)),
};

// Punto único que la app usa; cambiar aquí = cambiar el backend de almacenamiento.
export const patternStore: PatternStore = localPatternStore;
