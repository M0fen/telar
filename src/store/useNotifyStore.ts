import { create } from 'zustand';

// Sistema de avisos propio de Telar (reemplaza alert/confirm/prompt del browser, que se
// ven mal) + surfacing de errores: cualquier parte puede empujar un TOAST (mensaje que
// aparece y se va) o pedir un DIÁLOGO (confirmar / escribir un nombre) con promesa.
// Los manejadores globales de error (App) también empujan toasts → el sistema SIEMPRE
// dice qué pasa cuando algo raro ocurre, en vez de fallar en silencio.

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';
export interface Toast { id: number; kind: ToastKind; msg: string }

export interface DialogReq {
  title: string;
  message?: string;
  input?: boolean; // true = pide texto (prompt); false = confirmar (confirm)
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // botón principal en rojo (acciones destructivas)
  resolve: (value: string | null) => void; // texto / '' (confirm OK) / null (cancelar)
}

interface NotifyState {
  toasts: Toast[];
  dialog: DialogReq | null;
  push: (kind: ToastKind, msg: string, ttl?: number) => void;
  dismiss: (id: number) => void;
  ask: (req: Omit<DialogReq, 'resolve'>) => Promise<string | null>;
  resolveDialog: (value: string | null) => void;
}

let seq = 1;
export const useNotifyStore = create<NotifyState>((set, get) => ({
  toasts: [],
  dialog: null,
  push: (kind, msg, ttl = kind === 'error' ? 9000 : 4500) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, msg }] })); // máx ~5 a la vez
    if (ttl > 0) window.setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  ask: (req) => new Promise<string | null>((resolve) => set({ dialog: { ...req, resolve } })),
  resolveDialog: (value) => { const d = get().dialog; if (d) { set({ dialog: null }); d.resolve(value); } },
}));

// helpers cortos para no repetir getState() por todos lados.
export const toast = {
  info: (m: string) => useNotifyStore.getState().push('info', m),
  ok: (m: string) => useNotifyStore.getState().push('ok', m),
  warn: (m: string) => useNotifyStore.getState().push('warn', m),
  err: (m: string) => useNotifyStore.getState().push('error', m),
};
export function askConfirm(title: string, opts?: { message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  return useNotifyStore.getState().ask({ title, ...opts }).then((v) => v !== null);
}
export function askPrompt(title: string, opts?: { message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
  return useNotifyStore.getState().ask({ title, input: true, ...opts });
}
