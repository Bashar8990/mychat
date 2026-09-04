// Vault logic - hidden calculator unlock
export const DEFAULT_VAULT_CODE = "2025147151";
export const VAULT_UNLOCK_KEY = "vault_unlocked";
export const VAULT_CODE_KEY = "vault_code";
export const VAULT_UNLOCK_EXPIRY_KEY = "vault_unlocked_at";

const UNLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes session

export function getVaultCode(): string {
  if (typeof window === "undefined") return DEFAULT_VAULT_CODE;
  return localStorage.getItem(VAULT_CODE_KEY) || DEFAULT_VAULT_CODE;
}

export function setVaultCode(code: string) {
  localStorage.setItem(VAULT_CODE_KEY, code);
}

export function isVaultUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  const unlocked = localStorage.getItem(VAULT_UNLOCK_KEY) === "true";
  const at = Number(localStorage.getItem(VAULT_UNLOCK_EXPIRY_KEY) || "0");
  if (!unlocked) return false;
  if (Date.now() - at > UNLOCK_DURATION_MS) {
    lockVault();
    return false;
  }
  return true;
}

export function unlockVault() {
  localStorage.setItem(VAULT_UNLOCK_KEY, "true");
  localStorage.setItem(VAULT_UNLOCK_EXPIRY_KEY, String(Date.now()));
}

export function lockVault() {
  localStorage.removeItem(VAULT_UNLOCK_KEY);
  localStorage.removeItem(VAULT_UNLOCK_EXPIRY_KEY);
}

// Check if display equals vault code - used by Calculator with == logic
export function isVaultCode(display: string): boolean {
  // strip commas and spaces
  const clean = display.replace(/,/g, "").trim();
  return clean === getVaultCode();
}
