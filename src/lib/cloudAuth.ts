// Candado del banco de nube: la contraseña se guarda como COOKIE (cb_pw), que viaja
// sola en las peticiones same-origin al proxy /api/sample → el servidor la valida
// (no va en la URL, no se filtra en logs). El proxy exige que coincida con la env
// CLOUD_BANK_PW. Aquí solo la fijamos y comprobamos contra el servidor con ?probe=1.

const FLAG = 'telar.cloudbank.unlocked';

export function setCloudCookie(pw: string): void {
  document.cookie = `cb_pw=${encodeURIComponent(pw)}; path=/; max-age=31536000; SameSite=Strict`;
}

// ¿ya está desbloqueado en este navegador? (cookie presente o marca guardada)
export function hasCloudUnlock(): boolean {
  try {
    return /(?:^|;\s*)cb_pw=/.test(document.cookie) || localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

// Fija la cookie y valida contra el servidor. Devuelve true si la contraseña es correcta
// (o si el servidor no tiene candado configurado → probe responde 200).
export async function unlockCloud(pw: string): Promise<boolean> {
  setCloudCookie(pw);
  try {
    const r = await fetch('/api/sample?probe=1', { credentials: 'same-origin', cache: 'no-store' });
    if (r.ok) {
      try { localStorage.setItem(FLAG, '1'); } catch { /* */ }
      return true;
    }
  } catch {
    /* red caída */
  }
  return false;
}
