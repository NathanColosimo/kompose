"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { authClient } from "@/lib/auth-client";
import {
  clearPersistedQueries,
  getQueryCacheUser,
  queryPersister,
  setQueryCacheUser,
} from "@/lib/query-persistence";

type Session = typeof authClient.$Infer.Session;
// The token stays in the httpOnly cookie, and nothing on the client reads the
// IP address or user agent, so none of them are stored.
type StoredSession = Omit<
  Session["session"],
  "ipAddress" | "token" | "userAgent"
> & {
  user: Session["user"];
};

const STORAGE_KEY = "kompose.session";

/** Read the last session, unless it has expired or can't be parsed. */
function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const { user, ...session } = JSON.parse(raw) as StoredSession;
    const expiresAt = new Date(session.expiresAt);
    if (!(expiresAt.getTime() > Date.now())) {
      return null;
    }
    return {
      session: {
        ...session,
        createdAt: new Date(session.createdAt),
        expiresAt,
        ipAddress: null,
        token: "",
        updatedAt: new Date(session.updatedAt),
        userAgent: null,
      },
      user: {
        ...user,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      },
    };
  } catch {
    return null;
  }
}

function writeStoredSession({ session, user }: Session) {
  const { ipAddress: _ip, token: _token, userAgent: _agent, ...rest } = session;
  const stored: StoredSession = { ...rest, user };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be full or blocked; the session check still works without it.
  }
}

function removeStoredSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored if storage is blocked.
  }
}

/**
 * Shows the signed-in app without waiting for the session check. The last
 * session is restored before the first paint and checked in the background;
 * if the check signs the user out, the dashboard redirects to /login as it
 * would have, and the stored session and query cache are cleared.
 */
export function SessionCache() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = authClient.useSession();

  // A layout effect, so the restored session renders before the first paint.
  // It runs after hydration because the server never knows the session.
  useLayoutEffect(() => {
    const stored = readStoredSession();
    if (stored) {
      setQueryCacheUser(stored.user.id);
      authClient.hydrateSession(stored);
    }
  }, []);

  useEffect(() => {
    // A pending or failed check says nothing about who is signed in.
    if (isPending || error) {
      return;
    }
    const userId = data?.user.id ?? null;
    const previousUserId = getQueryCacheUser();
    setQueryCacheUser(userId);
    if (previousUserId && previousUserId !== userId) {
      // Signed out, or signed in as someone else: drop the previous user's
      // data. Mounted queries refetch for the new user.
      clearPersistedQueries().catch(() => undefined);
      if (userId) {
        queryClient.resetQueries();
      } else {
        queryClient.clear();
      }
    }
    if (data) {
      writeStoredSession(data);
    } else {
      removeStoredSession();
    }
  }, [data, error, isPending, queryClient]);

  // Drop entries that expired since the last visit, after the first paint.
  useEffect(() => {
    queryPersister.persisterGc().catch(() => undefined);
  }, []);

  return null;
}
