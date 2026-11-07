// Candado del banco de nube. Al entrar, el servidor valida la contraseña (POST
// /api/sample?login=1) y deja una cookie HttpOnly (cb_tok: un HMAC, no la contraseña) que
// viaja sola en las peticiones same-origin al proxy; el navegador no la puede leer. La
// cookie vieja cb_pw (la contraseña tal cual, puesta desde aquí) se cambia por la nueva.

const FLAG = 'telar.cloudbank.unlocked';
const LEGACY = /(?:^|;\s*)cb_pw=([^;]*)/;

async function login(pw: string): Promise<boolean> {
  try {
    const r = await fetch('/api/sample?login=1', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pw }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function dropLegacy(): void {
  document.cookie = 'cb_pw=; path=/; max-age=0; SameSite=Strict';
}

// La cookie vieja (contraseña legible desde JS) se cambia una vez por la HttpOnly.
let migrated = false;
function migrateLegacy(): void {
  if (migrated) return;
  migrated = true;
  const m = LEGACY.exec(document.cookie);
  if (!m) return;
  let pw = '';
  try { pw = decodeURIComponent(m[1]); } catch { /* */ }
  void login(pw).then((ok) => { if (ok) dropLegacy(); });
}

// ¿ya está desbloqueado en este navegador? (marca guardada o cookie vieja)
export function hasCloudUnlock(): boolean {
  try {
    migrateLegacy();
    return localStorage.getItem(FLAG) === '1' || LEGACY.test(document.cookie);
  } catch {
    return false;
  }
}

// Valida contra el servidor. true si la contraseña es correcta (o si el servidor no tiene
// candado configurado).
export async function unlockCloud(pw: string): Promise<boolean> {
  if (!(await login(pw))) return false;
  dropLegacy();
  try { localStorage.setItem(FLAG, '1'); } catch { /* */ }
  return true;
}
