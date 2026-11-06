import {
  ELECTRON_AUTH_CLIENT_ID,
  ELECTRON_AUTH_SCHEME,
} from "@kompose/desktop";

export const electronAuthProxyOptions = {
  callbackPath: "/auth/callback",
  clientID: ELECTRON_AUTH_CLIENT_ID,
  cookiePrefix: "kompose",
  protocol: { scheme: ELECTRON_AUTH_SCHEME },
};

export function redirectElectronAuth(code: string) {
  // Match @better-auth/electron's proxy redirect, which has no completion callback.
  const { callbackPath, clientID, cookiePrefix, protocol } =
    electronAuthProxyOptions;
  // biome-ignore lint/suspicious/noDocumentCookie: Preserve synchronous plugin cookie consumption in browsers without Cookie Store.
  document.cookie = `${cookiePrefix}.${clientID}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
  window.location.replace(`${protocol.scheme}:/${callbackPath}#token=${code}`);
}

export function parseElectronAuthQuery(search: string) {
  const query = new URLSearchParams(search);
  const client_id = query.get("client_id");
  const state = query.get("state");
  const code_challenge = query.get("code_challenge");
  return client_id === ELECTRON_AUTH_CLIENT_ID && state && code_challenge
    ? { client_id, code_challenge, state }
    : null;
}

type ElectronAuthQuery = NonNullable<ReturnType<typeof parseElectronAuthQuery>>;
type DesktopAuthState =
  | { status: "idle" | "transferring" | "waiting-for-code" | "complete" }
  | { status: "error"; message: string };

interface HandoffClient {
  getAuthorizationCode: () => string | null;
  redirect: (code: string) => void;
  transferUser: (
    query: ElectronAuthQuery,
    signal: AbortSignal
  ) => Promise<void>;
}

const CODE_TIMEOUT_MS = 10_000;
const CODE_POLL_INTERVAL_MS = 100;
const IDLE: DesktopAuthState = { status: "idle" };

/** A cancellable subscription to the browser side of Better Auth's handoff. */
export function createDesktopAuthHandoff(client: HandoffClient) {
  let state = IDLE;
  const listeners = new Set<() => void>();
  let cancel: () => void = () => undefined;
  let retry: () => void = () => undefined;

  const update = (next: DesktopAuthState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const start = (input: {
    query: ElectronAuthQuery | null;
    signedIn: boolean;
  }) => {
    cancel();
    let timer: ReturnType<typeof setInterval> | undefined;
    const abort = new AbortController();
    const stop = () => {
      clearInterval(timer);
      abort.abort();
    };
    cancel = stop;
    retry = () => {
      if (state.status === "error") {
        start(input);
      }
    };

    const fail = (error: unknown) => {
      if (abort.signal.aborted) {
        return;
      }
      clearInterval(timer);
      update({
        message:
          error instanceof Error
            ? error.message
            : "Desktop sign-in failed. Please try again.",
        status: "error",
      });
    };

    const waitForCode = () => {
      if (abort.signal.aborted) {
        return;
      }
      update({ status: "waiting-for-code" });
      const started = Date.now();
      timer = setInterval(() => {
        try {
          const code = client.getAuthorizationCode();
          if (code) {
            clearInterval(timer);
            client.redirect(code);
            update({ status: "complete" });
          } else if (Date.now() - started >= CODE_TIMEOUT_MS) {
            fail(
              new Error(
                "Timed out waiting for desktop authorization. Please try again."
              )
            );
          }
        } catch (error) {
          fail(error);
        }
      }, CODE_POLL_INTERVAL_MS);
    };

    update(IDLE);
    if (client.getAuthorizationCode()) {
      waitForCode();
    } else if (input.query && input.signedIn) {
      update({ status: "transferring" });
      client.transferUser(input.query, abort.signal).then(waitForCode, fail);
    }
    return () => cancel();
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => IDLE,
    retry: () => retry(),
    start,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
