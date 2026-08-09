const RECONNECT_STORAGE_KEY = "pt.reconnectRequired";
const RECONNECT_STORAGE_VALUE = "session-invalidated-v2";

export function ricollegamentoRichiesto(): boolean {
  try {
    return localStorage.getItem(RECONNECT_STORAGE_KEY) === RECONNECT_STORAGE_VALUE;
  } catch {
    return false;
  }
}

export function marcaRicollegamentoRichiesto(): void {
  try {
    localStorage.setItem(RECONNECT_STORAGE_KEY, RECONNECT_STORAGE_VALUE);
  } catch {}
}

export function completaRicollegamento(): void {
  try {
    localStorage.removeItem(RECONNECT_STORAGE_KEY);
  } catch {}
}
