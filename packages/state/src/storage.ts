import { atom } from "jotai";

/**
 * Minimal storage adapter interface for Jotai persistence.
 */
export interface StorageAdapter {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

let storageAdapter: StorageAdapter | null = null;

/**
 * Register a storage adapter for persisted atoms.
 * Call this once during app startup (e.g., in StateProvider).
 */
export function setStorageAdapter(adapter: StorageAdapter) {
  storageAdapter = adapter;
}

/**
 * JSON storage wrapper used by atomWithStorage.
 * Storage is resolved lazily so adapters can be configured at runtime.
 */
function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Create a persisted atom backed by the configured storage adapter.
 * Uses the initial value until stored data is loaded.
 */
export function createPersistedAtom<T>(key: string, initialValue: T) {
  const baseAtom = atom(initialValue);

  baseAtom.onMount = (setValue) => {
    const adapter = storageAdapter;
    if (!adapter) {
      return;
    }
    const read = adapter.getItem(key);
    const apply = (raw: string | null) => {
      setValue(parseStoredValue(raw, initialValue));
    };

    if (read && typeof (read as Promise<string | null>).then === "function") {
      (read as Promise<string | null>).then(apply).catch(() => undefined);
    } else {
      apply(read as string | null);
    }
  };

  return atom(
    (get) => get(baseAtom),
    (get, set, update: T | ((prev: T) => T)) => {
      const next =
        typeof update === "function"
          ? (update as (prev: T) => T)(get(baseAtom))
          : update;
      set(baseAtom, next);

      const adapter = storageAdapter;
      if (!adapter) {
        return;
      }
      adapter.setItem(key, JSON.stringify(next));
    }
  );
}

/**
 * Web storage adapter based on localStorage.
 * Guards against server-side access in Next.js.
 */
export function createWebStorageAdapter(): StorageAdapter {
  const localStorage =
    typeof globalThis !== "undefined" &&
    "localStorage" in globalThis &&
    typeof (globalThis as { localStorage?: unknown }).localStorage !==
      "undefined"
      ? (
          globalThis as {
            localStorage: {
              getItem: (key: string) => string | null;
              setItem: (key: string, value: string) => void;
              removeItem: (key: string) => void;
            };
          }
        ).localStorage
      : null;

  return {
    getItem: (key) => (localStorage ? localStorage.getItem(key) : null),
    setItem: (key, value) => {
      localStorage?.setItem(key, value);
    },
    removeItem: (key) => {
      localStorage?.removeItem(key);
    },
  };
}
