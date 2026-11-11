import { atom } from "jotai";

export interface StorageAdapter {
  getItem: (key: string) => string | null | Promise<string | null>;
  removeItem: (key: string) => void | Promise<void>;
  setItem: (key: string, value: string) => void | Promise<void>;
}

let storageAdapter: StorageAdapter | null = null;

/** Configure before persisted atoms mount; StateProvider handles this for both apps. */
export function setStorageAdapter(adapter: StorageAdapter) {
  storageAdapter = adapter;
}

export function getStorageAdapter() {
  return storageAdapter;
}

/** Missing or invalid JSON falls back to the initial atom value. */
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

/** Stored data loads on mount; reads before hydration use the initial value. */
export function createPersistedAtom<T>(key: string, initialValue: T) {
  const baseAtom = atom({ value: initialValue, written: false });

  baseAtom.onMount = (setValue) => {
    const adapter = storageAdapter;
    if (!adapter) {
      return;
    }
    const read = adapter.getItem(key);
    const apply = (raw: string | null) => {
      setValue((current) =>
        current.written
          ? current
          : { value: parseStoredValue(raw, initialValue), written: false }
      );
    };

    if (read && typeof (read as Promise<string | null>).then === "function") {
      (read as Promise<string | null>).then(apply).catch(() => undefined);
    } else {
      apply(read as string | null);
    }
  };

  return atom(
    (get) => get(baseAtom).value,
    (get, set, update: T | ((prev: T) => T)) => {
      const next =
        typeof update === "function"
          ? (update as (prev: T) => T)(get(baseAtom).value)
          : update;
      set(baseAtom, { value: next, written: true });

      const adapter = storageAdapter;
      if (!adapter) {
        return;
      }
      adapter.setItem(key, JSON.stringify(next));
    }
  );
}

/** Storage is a no-op when localStorage is unavailable, including during SSR. */
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
    removeItem: (key) => {
      localStorage?.removeItem(key);
    },
    setItem: (key, value) => {
      localStorage?.setItem(key, value);
    },
  };
}
