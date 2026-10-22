"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSmartTaskInputAvailable,
  type SmartTaskInput,
  smartParseTaskInput,
} from "@/lib/smart-task-input";

/** How long typing must pause before the model runs for the preview. */
const DEBOUNCE_MS = 300;
/** Enter waits at most this long for the model before creating without it. */
const SUBMIT_TIMEOUT_MS = 3000;

interface Request {
  controller: AbortController;
  promise: Promise<SmartTaskInput | null>;
  settled: boolean;
}

/**
 * Runs on-device parsing for `text` once typing pauses, for the live preview.
 * `resolve` returns the result for submit, reusing the in-flight request.
 * Pass null to skip parsing (for example, when explicit tokens are present).
 */
export function useSmartTaskInput(text: string | null, tagNames: string[]) {
  const [available, setAvailable] = useState(false);
  const [latest, setLatest] = useState<{
    result: SmartTaskInput | null;
    text: string;
  } | null>(null);
  const requests = useRef(new Map<string, Request>());

  useEffect(() => {
    isSmartTaskInputAvailable()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  // A different tag list changes the schema, so earlier answers are stale.
  const tagKey = tagNames.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset on tag changes.
  useEffect(() => {
    for (const request of requests.current.values()) {
      request.controller.abort();
    }
    requests.current.clear();
    setLatest(null);
  }, [tagKey]);

  const start = useCallback(
    (value: string) => {
      const existing = requests.current.get(value);
      if (existing) {
        return existing;
      }
      const controller = new AbortController();
      const request: Request = {
        controller,
        promise: smartParseTaskInput(value, {
          signal: controller.signal,
          tagNames,
        })
          .catch(() => null)
          .finally(() => {
            request.settled = true;
          }),
        settled: false,
      };
      requests.current.set(value, request);
      return request;
    },
    [tagNames]
  );

  useEffect(() => {
    if (!(available && text)) {
      return;
    }
    let current = true;
    let request: Request | undefined;
    const timer = setTimeout(() => {
      request = start(text);
      request.promise.then((parsed) => {
        if (current) {
          setLatest({ result: parsed, text });
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
      // Stop superseded work so it doesn't slow the next request.
      if (request && !request.settled) {
        request.controller.abort();
        requests.current.delete(text);
      }
    };
  }, [available, text, start]);

  const resolve = useCallback(() => {
    if (!(available && text)) {
      return Promise.resolve(null);
    }
    const timeout = new Promise<null>((done) =>
      setTimeout(() => done(null), SUBMIT_TIMEOUT_MS)
    );
    return Promise.race([start(text).promise, timeout]);
  }, [available, text, start]);

  const result = latest?.text === text ? latest.result : null;
  return {
    available,
    pending: available && !!text && latest?.text !== text,
    resolve,
    result,
  };
}
