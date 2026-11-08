// Cambiar el KIT de una batería (el banco de muestras de Strudel) sin tocar sus golpes. Puro.
// Solo se ofrece cuando es seguro: el código ya trae su .bank("…") —uno, o el mismo en cada sección
// de un arrange— (se reemplaza en su sitio) o
// todos sus sonidos son de caja de ritmos (bd, sd, hh…) y no hay notas. Una percusión de packs sin
// banco no se toca: el prefijo del banco la dejaría muda.
export const DRUM_WORDS = new Set(['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'sh', 'tb', 'perc', 'misc', 'fx']);
const BANK_RE = /\.bank\(\s*(["'`])([^"'`]*)\1\s*\)/g;

// el banco actual ('' = sin banco) o null si no se puede cambiar con seguridad
export function kitBankOf(code: string): string | null {
  const c = code ?? '';
  if (/\b(?:note|n)\(/.test(c)) return null;
  const banks = new Set([...c.matchAll(BANK_RE)].map((m) => m[2]));
  if (banks.size === 1) return [...banks][0];
  if (banks.size > 1) return null; // kits mezclados: mejor en el código
  const sounds = [...c.matchAll(/\bs(?:ound)?\(\s*(["'`])([^"'`]*)\1/g)].flatMap((m) => m[2].match(/[a-z][a-z0-9_]*/gi) ?? []);
  if (!sounds.length) return null;
  return sounds.every((w) => DRUM_WORDS.has(w.toLowerCase())) ? '' : null;
}

export function setKitBank(code: string, bank: string): string {
  const c = code ?? '';
  if ([...c.matchAll(BANK_RE)].length) return bank ? c.replace(BANK_RE, `.bank("${bank}")`) : c.replace(BANK_RE, '');
  return bank ? `${c.trimEnd()}.bank("${bank}")` : c;
}
