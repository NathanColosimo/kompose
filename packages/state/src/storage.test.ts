import { expect, test } from "bun:test";
import { createStore } from "jotai";
import { visibleDaysCountAtom } from "./atoms/current-date";
import {
  type VisibleCalendars,
  visibleCalendarsAtom,
  visibleCalendarsStateAtom,
} from "./atoms/visible-calendars";
import { createPersistedAtom, setStorageAdapter } from "./storage";

test("a visible-days write owns memory when an older storage read resolves", async () => {
  const read = Promise.withResolvers<string | null>();
  let stored = "7";
  setStorageAdapter({
    getItem: () => read.promise,
    removeItem: () => undefined,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  const store = createStore();
  const unmount = store.sub(visibleDaysCountAtom, () => undefined);
  try {
    store.set(visibleDaysCountAtom, 3);
    read.resolve("7");
    await read.promise;

    expect(store.get(visibleDaysCountAtom)).toBe(3);
    expect(stored).toBe("3");
  } finally {
    unmount();
  }
});

test("a calendar write owns memory when an older storage read resolves", async () => {
  const read = Promise.withResolvers<string | null>();
  let stored = "null";
  setStorageAdapter({
    getItem: () => read.promise,
    removeItem: () => undefined,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  const store = createStore();
  const unmount = store.sub(visibleCalendarsAtom, () => undefined);
  const selected = [{ accountId: "account", calendarId: "new" }];
  try {
    store.set(visibleCalendarsAtom, selected);
    read.resolve('[{"accountId":"account","calendarId":"old"}]');
    await read.promise;

    expect(store.get(visibleCalendarsAtom)).toEqual(selected);
    expect(stored).toBe(JSON.stringify(selected));
  } finally {
    unmount();
  }
});

test("calendar writes are immediately ready while hydration is pending", () => {
  const read = Promise.withResolvers<string | null>();
  setStorageAdapter({
    getItem: () => read.promise,
    removeItem: () => undefined,
    setItem: () => undefined,
  });
  const store = createStore();
  const unmount = store.sub(visibleCalendarsStateAtom, () => undefined);
  try {
    expect(store.get(visibleCalendarsStateAtom).kind).toBe("loading");
    const selected = [{ accountId: "account", calendarId: "new" }];
    store.set(visibleCalendarsAtom, selected);
    expect(store.get(visibleCalendarsStateAtom).kind).toBe("ready");
    expect(store.get(visibleCalendarsAtom)).toEqual(selected);
  } finally {
    unmount();
  }
});

const calendarHydrationCases: {
  raw: string | null;
  value: VisibleCalendars;
}[] = [
  { raw: null, value: null },
  { raw: "invalid JSON", value: null },
  { raw: "null", value: null },
  { raw: "[]", value: [] },
];

test.each(calendarHydrationCases)(
  "calendar hydration preserves preference semantics for $raw",
  ({ raw, value }) => {
    setStorageAdapter({
      getItem: () => raw,
      removeItem: () => undefined,
      setItem: () => undefined,
    });
    const store = createStore();
    const unmount = store.sub(visibleCalendarsStateAtom, () => undefined);
    try {
      expect(store.get(visibleCalendarsStateAtom).kind).toBe("ready");
      expect(store.get(visibleCalendarsAtom)).toEqual(value);
    } finally {
      unmount();
    }
  }
);

test("an unmounted load cannot hydrate a later mount", async () => {
  const oldRead = Promise.withResolvers<string | null>();
  const newRead = Promise.withResolvers<string | null>();
  let reads = 0;
  setStorageAdapter({
    getItem: () => {
      reads += 1;
      return reads === 1 ? oldRead.promise : newRead.promise;
    },
    removeItem: () => undefined,
    setItem: () => undefined,
  });
  const { stateAtom, valueAtom } = createPersistedAtom("unmount", 7);
  const store = createStore();
  store.sub(valueAtom, () => undefined)();
  const unmount = store.sub(valueAtom, () => undefined);
  try {
    oldRead.resolve("1");
    await oldRead.promise;
    expect(store.get(stateAtom).kind).toBe("loading");
    expect(store.get(valueAtom)).toBe(7);

    newRead.resolve("3");
    await newRead.promise;
    expect(store.get(stateAtom).kind).toBe("ready");
    expect(store.get(valueAtom)).toBe(3);
  } finally {
    unmount();
  }
});

test("a write before mount is ready and is not rehydrated on mount", () => {
  let reads = 0;
  setStorageAdapter({
    getItem: () => {
      reads += 1;
      return "7";
    },
    removeItem: () => undefined,
    setItem: () => undefined,
  });
  const { stateAtom, valueAtom } = createPersistedAtom("before-mount", 7);
  const store = createStore();
  store.set(valueAtom, (previous) => previous - 4);
  const unmount = store.sub(valueAtom, () => undefined);
  try {
    expect(store.get(stateAtom).kind).toBe("ready");
    expect(store.get(valueAtom)).toBe(3);
    expect(reads).toBe(0);
  } finally {
    unmount();
  }
});

test("a failed read finishes loading with the fallback", async () => {
  const read = Promise.withResolvers<string | null>();
  setStorageAdapter({
    getItem: () => read.promise,
    removeItem: () => undefined,
    setItem: () => undefined,
  });
  const { stateAtom, valueAtom } = createPersistedAtom("failed-read", 7);
  const store = createStore();
  const unmount = store.sub(valueAtom, () => undefined);
  try {
    read.reject(new Error("Storage unavailable"));
    await read.promise.catch(() => undefined);
    expect(store.get(stateAtom).kind).toBe("ready");
    expect(store.get(valueAtom)).toBe(7);
  } finally {
    unmount();
  }
});

test.each([false, true])(
  "async writes are serialized per key, including after failure (%s)",
  async (failFirstWrite) => {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const writes: string[] = [];
    let stored = "7";
    setStorageAdapter({
      getItem: () => "7",
      removeItem: () => undefined,
      setItem: async (_key, value) => {
        writes.push(value);
        if (writes.length === 1) {
          await first.promise;
        } else {
          secondStarted.resolve();
          await second.promise;
        }
        stored = value;
      },
    });
    const { valueAtom } = createPersistedAtom("ordered-writes", 7);
    const store = createStore();
    const firstWrite = store.set(valueAtom, 1);
    const secondWrite = store.set(valueAtom, 3);
    expect(store.get(valueAtom)).toBe(3);
    expect(writes).toEqual(["1"]);

    if (failFirstWrite) {
      first.reject(new Error("Write failed"));
      await expect(firstWrite).rejects.toThrow("Write failed");
    } else {
      first.resolve();
      await firstWrite;
    }
    await secondStarted.promise;
    expect(writes).toEqual(["1", "3"]);
    second.resolve();
    await secondWrite;
    expect(stored).toBe("3");
    expect(store.get(valueAtom)).toBe(3);
  }
);

test("write queues share a key across stores without blocking other keys", async () => {
  const first = Promise.withResolvers<void>();
  const writes: string[] = [];
  setStorageAdapter({
    getItem: () => null,
    removeItem: () => undefined,
    setItem: async (key, value) => {
      writes.push(`${key}:${value}`);
      if (key === "shared" && value === "1") {
        await first.promise;
      }
    },
  });
  const { valueAtom: firstAtom } = createPersistedAtom("shared", 7);
  const { valueAtom: secondAtom } = createPersistedAtom("shared", 7);
  const { valueAtom: otherAtom } = createPersistedAtom("other", 7);
  const firstStore = createStore();
  const secondStore = createStore();
  const firstWrite = firstStore.set(firstAtom, 1);
  const secondWrite = secondStore.set(secondAtom, 3);
  await secondStore.set(otherAtom, 5);
  expect(writes).toEqual(["shared:1", "other:5"]);

  first.resolve();
  await firstWrite;
  await secondWrite;
  expect(writes).toEqual(["shared:1", "other:5", "shared:3"]);
});
