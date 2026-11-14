// Saved settings and records. localStorage can be missing or throw (private windows, blocked
// storage), so every access goes through here and quietly falls back to the default.

/** Every key the game stores, in one place. */
export type StorageKey =
  | 'ps-best'
  | 'ps-best-run'
  | 'ps-style'
  | 'ps-bumpers'
  | 'ps-muted'
  | 'ps-swing'
  | 'ps-swing-intro';

export function load(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: StorageKey, value: string | number | boolean): void {
  const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export const loadFlag = (key: StorageKey): boolean => load(key) === '1';
export const loadNumber = (key: StorageKey): number => Number(load(key) ?? 0) || 0;
