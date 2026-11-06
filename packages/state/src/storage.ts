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

export type PersistedState<T> =
  | { kind: "loading"; revision: number }
  | { kind: "ready"; revision: number; value: T };

const pendingWritesByAdapter = new WeakMap<
  StorageAdapter,
  Map<string, Promise<void>>
>();

function writeStoredValue(adapter: StorageAdapter, key: string, value: string) {
  let pendingWrites = pendingWritesByAdapter.get(adapter);
  if (!pendingWrites) {
    pendingWrites = new Map();
    pendingWritesByAdapter.set(adapter, pendingWrites);
  }

  const previous = pendingWrites.get(key);
  const write = () => adapter.setItem(key, value);
  const result = previous ? previous.then(write) : write();
  if (!result) {
    return;
  }

  const cleanup = () => {
    if (pendingWrites.get(key) === settled) {
      pendingWrites.delete(key);
    }
  };
  // A failed write still releases the queue; its rejection is returned to callers.
  const settled = result.then(cleanup, cleanup);
  pendingWrites.set(key, settled);
  return result;
}

/** User writes own the value; only a still-current, mounted load can hydrate it. */
export function createPersistedAtom<T>(key: string, initialValue: T) {
  const baseAtom = atom<PersistedState<T>>({ kind: "loading", revision: 0 });

  baseAtom.onMount = (setState) => {
    let revision = 0;
    let ready = false;
    setState((current) => {
      revision = current.revision;
      ready = current.kind === "ready";
      return current;
    });
    if (ready) {
      return;
    }

    let active = true;
    const apply = (raw: string | null) => {
      if (!active) {
        return;
      }
      setState((current) =>
        current.revision === revision
          ? {
              kind: "ready",
              revision,
              value: parseStoredValue(raw, initialValue),
            }
          : current
      );
    };

    try {
      const read = storageAdapter?.getItem(key) ?? null;
      if (typeof read === "string" || read === null) {
        apply(read);
      } else {
        read.then(apply).catch(() => apply(null));
      }
    } catch {
      apply(null);
    }

    return () => {
      active = false;
    };
  };

  const stateAtom = atom((get) => get(baseAtom));
  const valueAtom = atom(
    (get) => {
      const state = get(baseAtom);
      return state.kind === "ready" ? state.value : initialValue;
    },
    (get, set, update: T | ((prev: T) => T)) => {
      const current = get(baseAtom);
      const value = current.kind === "ready" ? current.value : initialValue;
      const next =
        typeof update === "function"
          ? (update as (prev: T) => T)(value)
          : update;
      set(baseAtom, {
        kind: "ready",
        revision: current.revision + 1,
        value: next,
      });

      const adapter = storageAdapter;
      if (adapter) {
        return writeStoredValue(adapter, key, JSON.stringify(next));
      }
    }
  );

  return { stateAtom, valueAtom };
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
