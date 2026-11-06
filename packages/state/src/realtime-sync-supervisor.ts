import type { SyncEvent } from "@kompose/api/realtime/events";

const BACKGROUND_DISCONNECT_DELAY_MS = 30_000;
const INACTIVITY_TIMEOUT_MS = 30_000;
const HEALTHY_CONNECTION_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

type Phase =
  | "disabled"
  | "connecting"
  | "consuming"
  | "backoff"
  | "blur-grace"
  | "paused"
  | "exhausted";

type CancelTimer = () => void;

interface SupervisorOptions {
  connect: (signal: AbortSignal) => Promise<AsyncIterator<SyncEvent>>;
  now?: () => number;
  onEvent: (event: SyncEvent) => void;
  onResubscribe: () => void;
  schedule?: (callback: () => void, delayMs: number) => CancelTimer;
}

interface Attempt {
  controller: AbortController;
  generation: number;
  inactivityTimer?: CancelTimer;
  iterator?: AsyncIterator<SyncEvent>;
  startedAt: number;
}

function schedule(callback: () => void, delayMs: number): CancelTimer {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

/** Owns transport lifetimes independently of React renders and foreground events. */
export class RealtimeSyncSupervisor {
  private attempt?: Attempt;
  private backgroundTimer?: CancelTimer;
  private foreground = true;
  private generation = 0;
  private hasConnected = false;
  private reconnectAttempts = 0;
  private retryTimer?: CancelTimer;
  private state: Exclude<Phase, "blur-grace"> = "disabled";
  private readonly now: () => number;
  private readonly schedule: NonNullable<SupervisorOptions["schedule"]>;
  private readonly options: SupervisorOptions;

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? schedule;
  }

  get phase(): Phase {
    return this.backgroundTimer ? "blur-grace" : this.state;
  }

  start(foreground: boolean) {
    this.foreground = foreground;
    this.state = "paused";
    if (foreground) {
      this.connect();
    }
  }

  setForeground(foreground: boolean) {
    if (this.state === "disabled" || this.foreground === foreground) {
      return;
    }
    this.foreground = foreground;
    if (foreground) {
      this.backgroundTimer?.();
      this.backgroundTimer = undefined;
      if (this.state === "paused" || this.state === "exhausted") {
        this.reconnectAttempts = 0;
        this.connect();
      }
      return;
    }

    // Repeated blur/hidden notifications must not extend the Vercel cost limit.
    this.backgroundTimer = this.schedule(() => {
      this.backgroundTimer = undefined;
      this.retryTimer?.();
      this.retryTimer = undefined;
      this.state = "paused";
      this.retireAttempt();
    }, BACKGROUND_DISCONNECT_DELAY_MS);
  }

  stop() {
    this.state = "disabled";
    this.retryTimer?.();
    this.retryTimer = undefined;
    this.backgroundTimer?.();
    this.backgroundTimer = undefined;
    this.retireAttempt();
  }

  private isCurrent(attempt: Attempt) {
    return this.attempt?.generation === attempt.generation;
  }

  private closeIterator(attempt: Attempt) {
    const iterator = attempt.iterator;
    attempt.iterator = undefined;
    if (!iterator) {
      return;
    }
    // Some native streams throw if the server has already closed them.
    Promise.resolve()
      .then(() => iterator.return?.())
      .catch(() => undefined);
  }

  private retireAttempt() {
    const attempt = this.attempt;
    this.attempt = undefined;
    if (!attempt) {
      return;
    }
    attempt.inactivityTimer?.();
    attempt.controller.abort();
    this.closeIterator(attempt);
  }

  private resetInactivity(attempt: Attempt) {
    attempt.inactivityTimer?.();
    attempt.inactivityTimer = this.schedule(() => {
      if (this.isCurrent(attempt)) {
        this.retireAttempt();
        this.retry(false);
      }
    }, INACTIVITY_TIMEOUT_MS);
  }

  private retry(immediate: boolean) {
    if (!this.foreground) {
      this.state = "paused";
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.state = "exhausted";
      return;
    }
    const delay = immediate
      ? 0
      : Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;
    this.state = "backoff";
    this.retryTimer = this.schedule(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private connect() {
    if (!this.foreground) {
      this.state = "paused";
      return;
    }
    this.generation += 1;
    const attempt: Attempt = {
      controller: new AbortController(),
      generation: this.generation,
      startedAt: this.now(),
    };
    this.attempt = attempt;
    this.state = "connecting";
    this.resetInactivity(attempt);
    this.consume(attempt);
  }

  private async consume(attempt: Attempt) {
    let reconnectRequested = false;
    try {
      const iterator = await this.options.connect(attempt.controller.signal);
      attempt.iterator = iterator;
      if (!this.isCurrent(attempt)) {
        return;
      }
      attempt.startedAt = this.now();
      this.state = "consuming";
      this.resetInactivity(attempt);
      if (this.hasConnected) {
        this.options.onResubscribe();
      }
      this.hasConnected = true;

      while (this.isCurrent(attempt)) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential async iterator
        const next = await iterator.next();
        if (!this.isCurrent(attempt) || next.done) {
          break;
        }
        this.resetInactivity(attempt);
        if (next.value.type === "reconnect") {
          reconnectRequested = true;
          break;
        }
        // Acquiring an iterator or receiving one keepalive isn't proof of health.
        if (
          next.value.type !== "keepalive" ||
          this.now() - attempt.startedAt >= HEALTHY_CONNECTION_MS
        ) {
          this.reconnectAttempts = 0;
        }
        this.options.onEvent(next.value);
      }
    } catch {
      // The same bounded retry policy covers acquisition and consumption errors.
    } finally {
      if (this.isCurrent(attempt)) {
        this.retireAttempt();
        this.retry(reconnectRequested);
      } else {
        this.closeIterator(attempt);
      }
    }
  }
}
