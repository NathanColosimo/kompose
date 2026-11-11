import { expect, test } from "bun:test";
import { createStore } from "jotai";
import { visibleDaysCountAtom } from "./atoms/current-date";
import {
  visibleCalendarsAtom,
  visibleCalendarsHydratedAtom,
} from "./atoms/visible-calendars";
import { setStorageAdapter } from "./storage";

test("a day-count change survives an older startup storage read", async () => {
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
  const unsubscribe = store.sub(visibleDaysCountAtom, () => undefined);
  try {
    store.set(visibleDaysCountAtom, 3);
    read.resolve("7");
    await read.promise;

    expect(store.get(visibleDaysCountAtom)).toBe(3);
    expect(stored).toBe("3");
  } finally {
    unsubscribe();
  }
});

test("a calendar choice survives an older startup storage read", async () => {
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
  const unsubscribe = store.sub(visibleCalendarsAtom, () => undefined);
  try {
    store.set(visibleCalendarsAtom, []);
    expect(store.get(visibleCalendarsHydratedAtom)).toBe(true);
    read.resolve('[{"accountId":"personal","calendarId":"primary"}]');
    await read.promise;

    expect(store.get(visibleCalendarsAtom)).toEqual([]);
    expect(store.get(visibleCalendarsHydratedAtom)).toBe(true);
    expect(stored).toBe("[]");
  } finally {
    unsubscribe();
  }
});
