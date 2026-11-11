import { afterAll, afterEach, expect, mock, test, vi } from "bun:test";
import type { AppRouterClient } from "@kompose/api/routers/index";
import type { SyncEvent } from "@kompose/api/routers/sync/contract";
import { type ClientOptions, createORPCClient } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { stateConfigAtom } from "../config";
import { type RealtimeSyncOptions, useRealtimeSync } from "./use-realtime-sync";

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document"
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(() => {
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  queryClient.clear();
  vi.useRealTimers();
  for (const [key, descriptor] of [
    ["document", originalDocument],
    ["window", originalWindow],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

async function setup() {
  vi.useFakeTimers();
  queryClient = new QueryClient();
  const refresh = mock(() => Promise.resolve());
  queryClient.refetchQueries = refresh;
  const streams: ReadableStreamDefaultController<SyncEvent>[] = [];
  const closed = mock();
  const call = mock(
    (
      _path: string[],
      _input: unknown,
      { signal }: ClientOptions<Record<never, never>>
    ) =>
      Promise.resolve(
        new ReadableStream<SyncEvent>({
          start(controller) {
            streams.push(controller);
            signal?.addEventListener(
              "abort",
              () => {
                closed();
                controller.error(signal.reason);
              },
              { once: true }
            );
          },
          cancel: closed,
        }).values()
      )
  );
  const store = createStore();
  store.set(stateConfigAtom, {
    authClient: {
      accountInfo: async () => null,
      listAccounts: async () => [],
      unlinkAccount: async () => undefined,
    },
    orpc: createORPCClient<AppRouterClient>({ call }),
  });
  function Harness(options: RealtimeSyncOptions) {
    useRealtimeSync({ userId: "test", ...options });
    return null;
  }
  const render = async (options: RealtimeSyncOptions = {}) => {
    const tree = (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <Harness {...options} />
        </QueryClientProvider>
      </Provider>
    );
    await act(() => {
      if (renderer) {
        renderer.update(tree);
      } else {
        renderer = create(tree);
      }
    });
  };
  renderer = undefined;
  await render();
  const send = async () => {
    await act(() =>
      streams.at(-1)?.enqueue({ type: "keepalive", payload: {} })
    );
  };
  const advance = async (ms: number) => {
    await act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  return { advance, call, closed, refresh, render, send, streams };
}

test("refreshes changes missed during a broken connection after the replacement subscribes", async () => {
  const { advance, call, refresh, send, streams } = await setup();
  await send();
  expect(refresh).not.toHaveBeenCalled();
  await act(() => streams[0]?.error(new Error("Connection lost")));
  await advance(1000);
  expect(call).toHaveBeenCalledTimes(2);
  expect(refresh).not.toHaveBeenCalled();
  await send();
  expect(refresh).toHaveBeenCalled();
});

test("native backgrounding disconnects after 30 seconds and catches up on return", async () => {
  const { advance, call, closed, refresh, render, send } = await setup();
  await send();
  await render({ foreground: false });
  await advance(29_999);
  expect(closed).not.toHaveBeenCalled();
  await send();
  await advance(1);
  expect(closed).toHaveBeenCalledTimes(1);
  await render({ foreground: true });
  await advance(0);
  expect(call).toHaveBeenCalledTimes(2);
  expect(refresh).not.toHaveBeenCalled();
  await send();
  expect(refresh).toHaveBeenCalled();
});

test("browser blur disconnects at 30 seconds despite keepalives and reconnects on focus", async () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    hasFocus: () => document.visibilityState === "visible",
    visibilityState: "visible",
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  const { advance, call, closed, send } = await setup();
  await send();
  document.visibilityState = "hidden";
  window.dispatchEvent(new Event("blur"));
  await advance(29_999);
  await send();
  document.dispatchEvent(new Event("visibilitychange"));
  expect(closed).not.toHaveBeenCalled();
  await advance(1);
  expect(closed).toHaveBeenCalledTimes(1);
  document.visibilityState = "visible";
  window.dispatchEvent(new Event("focus"));
  await advance(0);
  expect(call).toHaveBeenCalledTimes(2);
});
