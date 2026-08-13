"use client";

import type {
  AiSessionOutput,
  CreateAiSessionInput,
  ReconnectAiStreamInput,
  SendAiStreamInput,
} from "@kompose/api/routers/ai/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useStateConfig } from "../config";

export type SendSessionMessageInput = SendAiStreamInput & {
  signal?: AbortSignal;
};
export type ResumeSessionStreamInput = ReconnectAiStreamInput & {
  signal?: AbortSignal;
};

export const AI_CHAT_QUERY_ROOT = ["ai"] as const;
export const AI_CHAT_SESSIONS_QUERY_KEY = ["ai", "sessions"] as const;
const EMPTY_AI_SESSIONS: AiSessionOutput[] = [];

export function getAiChatMessagesQueryKey(sessionId: string | null) {
  return ["ai", "messages", sessionId] as const;
}

/**
 * Shared AI chat state and operations backed by oRPC procedures.
 * This keeps web/native consumers on the same query/mutation contract.
 */
export function useAiChat(selectedSessionId: string | null) {
  const queryClient = useQueryClient();
  const { orpc } = useStateConfig();

  // Session list for the current authenticated user.
  const sessionsQuery = useQuery({
    queryFn: async () => await orpc.ai.sessions.list(),
    queryKey: AI_CHAT_SESSIONS_QUERY_KEY,
  });
  const sessions = sessionsQuery.data ?? EMPTY_AI_SESSIONS;
  const activeSession =
    sessions.find((session) => session.id === selectedSessionId) ??
    sessions[0] ??
    null;
  const activeSessionId = activeSession?.id ?? null;

  // Messages for the currently selected chat session.
  const messagesQuery = useQuery({
    enabled: Boolean(activeSessionId),
    queryFn: async () =>
      await orpc.ai.messages.list({ sessionId: activeSessionId as string }),
    queryKey: getAiChatMessagesQueryKey(activeSessionId),
  });

  // Creates a new chat session and refreshes the sessions list.
  const createSession = useMutation({
    mutationFn: async (input: CreateAiSessionInput) =>
      await orpc.ai.sessions.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: AI_CHAT_SESSIONS_QUERY_KEY,
      });
    },
  });

  // Deletes a chat session and invalidates both session + message caches.
  const deleteSession = useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) =>
      await orpc.ai.sessions.delete({ sessionId }),
    onSuccess: async (_value, variables) => {
      const deletedSessionMessagesQueryKey = getAiChatMessagesQueryKey(
        variables.sessionId
      );
      await queryClient.invalidateQueries({
        queryKey: AI_CHAT_SESSIONS_QUERY_KEY,
      });
      await queryClient.cancelQueries({
        queryKey: deletedSessionMessagesQueryKey,
      });
      queryClient.removeQueries({
        queryKey: deletedSessionMessagesQueryKey,
      });
    },
  });

  // Sends a message and starts a streaming iterator from the server.
  const streamSessionMessage = useCallback(
    async (input: SendSessionMessageInput) =>
      await orpc.ai.stream.send(
        {
          messages: input.messages,
          sessionId: input.sessionId,
          timeZone: input.timeZone,
        },
        { signal: input.signal }
      ),
    [orpc]
  );

  // Reconnects to an active server stream for resumable chat.
  const resumeSessionStream = useCallback(
    async (input: ResumeSessionStreamInput) =>
      await orpc.ai.stream.reconnect(
        { sessionId: input.sessionId },
        { signal: input.signal }
      ),
    [orpc]
  );

  return {
    activeSession,
    activeSessionId,
    createSession,
    deleteSession,
    messagesQuery,
    resumeSessionStream,
    sessions,
    sessionsQuery,
    streamSessionMessage,
  };
}
