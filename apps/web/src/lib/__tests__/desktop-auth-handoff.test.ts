/// <reference types="bun" />

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { electronProxyClient } from "@better-auth/electron/proxy";
import {
  createDesktopAuthHandoff,
  electronAuthProxyOptions,
  parseElectronAuthQuery,
  redirectElectronAuth,
} from "../desktop-auth-handoff";

const query = {
  client_id: "kompose-electron",
  code_challenge: "pkce-challenge",
  state: "request-state",
};

function createHarness() {
  const getAuthorizationCode = mock((): string | null => null);
  const transferUser = mock((_query: typeof query, _signal: AbortSignal) =>
    Promise.resolve()
  );
  const redirect = mock((_code: string) => undefined);
  const handoff = createDesktopAuthHandoff({
    getAuthorizationCode,
    redirect,
    transferUser,
  });
  return { getAuthorizationCode, handoff, redirect, transferUser };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("desktop auth handoff", () => {
  test("ordinary browser mounts stay idle and never transfer or poll", () => {
    const { handoff, getAuthorizationCode, transferUser, redirect } =
      createHarness();
    const stop = handoff.start({ query: null, signedIn: true });
    jest.advanceTimersByTime(20_000);
    expect(handoff.getSnapshot()).toEqual({ status: "idle" });
    expect(getAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(transferUser).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    stop();
  });

  test("signed-out desktop login waits for authentication without polling", () => {
    const { handoff, transferUser } = createHarness();
    const stop = handoff.start({ query, signedIn: false });
    expect(handoff.getSnapshot()).toEqual({ status: "idle" });
    expect(transferUser).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    stop();
  });

  test("a signed-in handoff transfers once, then polls and completes once", async () => {
    const { handoff, transferUser, getAuthorizationCode, redirect } =
      createHarness();
    const transfer = Promise.withResolvers<void>();
    transferUser.mockImplementation(() => transfer.promise);
    const stop = handoff.start({ query, signedIn: true });
    expect(handoff.getSnapshot()).toEqual({ status: "transferring" });
    expect(transferUser).toHaveBeenCalledTimes(1);
    expect(transferUser.mock.calls[0]?.[0]).toEqual(query);
    expect(jest.getTimerCount()).toBe(0);
    transfer.resolve();
    await transfer.promise;
    expect(handoff.getSnapshot()).toEqual({ status: "waiting-for-code" });
    expect(jest.getTimerCount()).toBe(1);
    getAuthorizationCode.mockReturnValue("encoded-authorization-code");
    jest.advanceTimersByTime(100);
    expect(redirect).toHaveBeenCalledWith("encoded-authorization-code");
    expect(handoff.getSnapshot()).toEqual({ status: "complete" });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(redirect).toHaveBeenCalledTimes(1);
    stop();
  });

  test("transfer errors are retryable and never start a poller", async () => {
    const { handoff, transferUser, getAuthorizationCode, redirect } =
      createHarness();
    transferUser.mockRejectedValueOnce(
      new Error("Authorization service unavailable")
    );
    const stop = handoff.start({ query, signedIn: true });
    await Promise.resolve();
    expect(handoff.getSnapshot()).toEqual({
      message: "Authorization service unavailable",
      status: "error",
    });
    expect(jest.getTimerCount()).toBe(0);
    handoff.retry();
    handoff.retry();
    expect(transferUser).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1);
    getAuthorizationCode.mockReturnValue("retry-code");
    jest.advanceTimersByTime(100);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    stop();
  });

  test("unmount also cancels a retry started after the initial effect", async () => {
    const { handoff, transferUser, getAuthorizationCode, redirect } =
      createHarness();
    transferUser.mockRejectedValueOnce(new Error("Try later"));
    const stop = handoff.start({ query, signedIn: true });
    await Promise.resolve();
    handoff.retry();
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1);
    stop();
    getAuthorizationCode.mockReturnValue("late-retry-code");
    jest.advanceTimersByTime(100);
    expect(redirect).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("unmount cancels waiting and ignores a late transfer response", async () => {
    const { handoff, transferUser, redirect } = createHarness();
    const transfer = Promise.withResolvers<void>();
    transferUser.mockImplementation(() => transfer.promise);
    const stop = handoff.start({ query, signedIn: true });
    const signal = transferUser.mock.calls[0]?.[1];
    stop();
    expect(signal?.aborted).toBe(true);
    transfer.resolve();
    await transfer.promise;
    jest.advanceTimersByTime(20_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  test("unmount clears polling and a replacement run ignores stale results", async () => {
    const { handoff, transferUser, getAuthorizationCode, redirect } =
      createHarness();
    const stale = Promise.withResolvers<void>();
    transferUser.mockImplementationOnce(() => stale.promise);
    handoff.start({ query, signedIn: true });
    const stop = handoff.start({ query, signedIn: true });
    await Promise.resolve();
    stale.resolve();
    await stale.promise;
    expect(jest.getTimerCount()).toBe(1);
    stop();
    getAuthorizationCode.mockReturnValue("late-code");
    jest.advanceTimersByTime(20_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  test("missing codes time out with a retry and no lingering timer", async () => {
    const { handoff, transferUser } = createHarness();
    handoff.start({ query, signedIn: true });
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);
    expect(handoff.getSnapshot()).toEqual({
      message: "Timed out waiting for desktop authorization. Please try again.",
      status: "error",
    });
    expect(jest.getTimerCount()).toBe(0);
    handoff.retry();
    await Promise.resolve();
    expect(transferUser).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
    handoff.start({ query: null, signedIn: false })();
  });
});

test("only a complete query for this Electron client enables transfer", () => {
  expect(parseElectronAuthQuery(`?${new URLSearchParams(query)}`)).toEqual(
    query
  );
  expect(
    parseElectronAuthQuery("?client_id=other&state=x&code_challenge=y")
  ).toBeNull();
  expect(
    parseElectronAuthQuery("?client_id=kompose-electron&state=x")
  ).toBeNull();
  expect(
    parseElectronAuthQuery(
      "?client_id=kompose-electron&state=&code_challenge=y"
    )
  ).toBeNull();
  expect(parseElectronAuthQuery("?sig=ordinary-oauth")).toBeNull();
});

test("the real plugin's OAuth cookie completes without a query or second transfer", () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window"
  );
  const replace = mock((_url: string) => undefined);
  const browserDocument = {
    cookie: "kompose.kompose-electron=opaque-pkce-token",
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: browserDocument,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { replace } },
  });
  try {
    const plugin = electronProxyClient(electronAuthProxyOptions).getActions();
    plugin.ensureElectronRedirect();
    jest.advanceTimersByTime(100);
    const sdkRedirect = replace.mock.calls[0]?.[0];
    const sdkCookieDeletion = browserDocument.cookie;
    replace.mockClear();
    browserDocument.cookie = "kompose.kompose-electron=opaque-pkce-token";
    const transferUser = mock(() => Promise.resolve());
    const handoff = createDesktopAuthHandoff({
      getAuthorizationCode: plugin.electron.getAuthorizationCode,
      redirect: redirectElectronAuth,
      transferUser,
    });
    const stop = handoff.start({ query: null, signedIn: false });
    expect(handoff.getSnapshot()).toEqual({ status: "waiting-for-code" });
    jest.advanceTimersByTime(100);
    expect(transferUser).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(
      "com.nathancolosimo.kompose://auth/callback#token=opaque-pkce-token"
    );
    expect(browserDocument.cookie).toBe(
      "kompose.kompose-electron=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/"
    );
    expect(replace).toHaveBeenCalledWith(sdkRedirect);
    expect(browserDocument.cookie).toBe(sdkCookieDeletion);
    expect(handoff.getSnapshot()).toEqual({ status: "complete" });
    expect(jest.getTimerCount()).toBe(0);
    stop();
  } finally {
    if (documentDescriptor) {
      Object.defineProperty(globalThis, "document", documentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (windowDescriptor) {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
