"use client";

import { useChat } from "@ai-sdk/react";
import {
  buildMessageSegments,
  extractAttachments,
  extractText,
  formatToolName,
  type ToolPart,
  toUiMessage,
} from "@kompose/ai/ai-message-utils";
import {
  AI_CHAT_SESSIONS_QUERY_KEY,
  getAiChatMessagesQueryKey,
  useAiChat,
} from "@kompose/state/hooks/use-ai-chat";
import { eventIteratorToUnproxiedDataStream, ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ChatAddToolApproveResponseFunction,
  type ChatTransport,
  type FileUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import {
  BotIcon,
  CheckIcon,
  Loader2Icon,
  MessageCircleIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
} from "@/components/ai-elements/confirmation";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
} from "@/components/ui/sidebar";

type ChatModelId = "gpt-5" | "gpt-5-mini";

const CHAT_MODELS: { id: ChatModelId; label: string }[] = [
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
];
const MAX_STREAM_RESUME_ATTEMPTS = 4;
const STREAM_RESUME_RETRY_INTERVAL_MS = 750;

function ComposerAttachmentsPreview() {
  const { files, remove } = usePromptInputAttachments();

  if (files.length === 0) {
    return null;
  }

  return (
    <PromptInputHeader>
      <Attachments variant="inline">
        {files.map((file) => (
          <Attachment
            data={file}
            key={file.id}
            onRemove={() => remove(file.id)}
          >
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

/**
 * Renders a single tool invocation with its input, confirmation (if approval-based),
 * and output—all inside a single collapsible Tool component.
 */
function ToolInvocationPart({
  part,
  onApprovalResponse,
}: {
  part: ToolPart;
  onApprovalResponse: ChatAddToolApproveResponseFunction;
}) {
  const defaultOpen =
    part.state === "approval-requested" ||
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "output-denied";

  return (
    <Tool defaultOpen={defaultOpen}>
      <ToolHeader
        state={part.state}
        title={formatToolName(part.type)}
        type={part.type as `tool-${string}`}
      />
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}

        {part.approval && (
          <Confirmation approval={part.approval} state={part.state}>
            <ConfirmationRequest>
              <span className="text-xs">Approve this action?</span>
              <ConfirmationActions>
                <ConfirmationAction
                  onClick={() =>
                    onApprovalResponse({
                      id: part.approval!.id,
                      approved: false,
                    })
                  }
                  variant="outline"
                >
                  Reject
                </ConfirmationAction>
                <ConfirmationAction
                  onClick={() =>
                    onApprovalResponse({
                      id: part.approval!.id,
                      approved: true,
                    })
                  }
                >
                  Approve
                </ConfirmationAction>
              </ConfirmationActions>
            </ConfirmationRequest>
            <ConfirmationAccepted>
              <CheckIcon className="size-3" />
              <span className="text-xs">Approved</span>
            </ConfirmationAccepted>
            <ConfirmationRejected>
              <XIcon className="size-3" />
              <span className="text-xs">Rejected</span>
            </ConfirmationRejected>
          </Confirmation>
        )}

        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

interface SidebarChatMessageProps {
  isStreamingAssistant: boolean;
  message: UIMessage;
  onApprovalResponse: ChatAddToolApproveResponseFunction;
}

function SidebarChatMessage({
  message,
  isStreamingAssistant,
  onApprovalResponse,
}: SidebarChatMessageProps) {
  const attachments = useMemo(
    () => extractAttachments(message.id, message.parts),
    [message.id, message.parts]
  );
  const segments = useMemo(
    () => buildMessageSegments(message.parts),
    [message.parts]
  );

  return (
    <Message from={message.role}>
      <MessageContent className="text-xs">
        {attachments.length > 0 ? (
          <Attachments variant="inline">
            {attachments.map((attachment) => (
              <Attachment data={attachment} key={attachment.id}>
                <AttachmentPreview />
                <AttachmentInfo />
              </Attachment>
            ))}
          </Attachments>
        ) : null}

        {segments.map((segment, index) => {
          if (segment.kind === "reasoning" && message.role === "assistant") {
            const isLastSegment = index === segments.length - 1;
            const isActive = isStreamingAssistant && isLastSegment;
            const showContent = segment.text.length > 0 || isActive;

            return (
              <ChainOfThought
                defaultOpen={isActive}
                key={`${message.id}-cot-${index}`}
              >
                <ChainOfThoughtHeader className="text-xs" />
                {showContent ? (
                  <ChainOfThoughtContent>
                    <ChainOfThoughtStep
                      className="text-xs"
                      label={isActive ? "Reasoning (streaming)" : "Reasoning"}
                      status={isActive ? "active" : "complete"}
                    >
                      <MessageResponse>
                        {segment.text || "Thinking..."}
                      </MessageResponse>
                    </ChainOfThoughtStep>
                  </ChainOfThoughtContent>
                ) : null}
              </ChainOfThought>
            );
          }

          if (segment.kind === "text") {
            if (message.role === "user") {
              return (
                <p
                  className="whitespace-pre-wrap"
                  key={`${message.id}-text-${index}`}
                >
                  {segment.text}
                </p>
              );
            }
            return (
              <MessageResponse key={`${message.id}-text-${index}`}>
                {segment.text}
              </MessageResponse>
            );
          }

          if (segment.kind === "tool") {
            return (
              <ToolInvocationPart
                key={segment.part.toolCallId}
                onApprovalResponse={onApprovalResponse}
                part={segment.part}
              />
            );
          }

          return null;
        })}
      </MessageContent>
    </Message>
  );
}

export function SidebarRightChat() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ChatModelId>("gpt-5-mini");
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const autoCreateAttemptedRef = useRef(false);
  const localSubmitPendingRef = useRef(false);
  const approvalPendingRef = useRef(false);
  const prevStatusRef = useRef<string>("ready");
  const streamResumeStateRef = useRef<{
    attempts: number;
    streamId: string | null;
  }>({ attempts: 0, streamId: null });
  const queryClient = useQueryClient();
  const {
    sessionsQuery,
    messagesQuery,
    createSession,
    deleteSession,
    streamSessionMessage,
    resumeSessionStream,
  } = useAiChat(activeSessionId);

  const sessions = sessionsQuery.data ?? [];
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const shouldResumeStream = Boolean(
    activeSessionId && activeSession?.activeStreamId
  );
  const modelLabel =
    CHAT_MODELS.find((model) => model.id === selectedModel)?.label ??
    "GPT-5 Mini";
  const cachedSessionRows = useMemo(() => {
    if (!activeSessionId) {
      return [];
    }
    // Read per-session cache directly so session switches render instantly
    // even before the observer settles on the new query result.
    return (
      queryClient.getQueryData<
        {
          id: string;
          role: string;
          content: string;
          parts: unknown;
        }[]
      >(getAiChatMessagesQueryKey(activeSessionId)) ?? []
    );
  }, [activeSessionId, queryClient]);

  // Keep local model selector aligned with the active session model when possible.
  useEffect(() => {
    if (!activeSession?.model) {
      return;
    }
    if (
      activeSession.model === "gpt-5" ||
      activeSession.model === "gpt-5-mini"
    ) {
      setSelectedModel(activeSession.model);
    }
  }, [activeSession?.model]);

  // Ensure there is always a selected session when sessions exist.
  useEffect(() => {
    if (sessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null);
      }
      return;
    }
    if (!activeSessionId) {
      setActiveSessionId(sessions[0]?.id ?? null);
      return;
    }
    const exists = sessions.some((session) => session.id === activeSessionId);
    if (!exists) {
      setActiveSessionId(sessions[0]?.id ?? null);
    }
  }, [activeSessionId, sessions]);

  // Auto-create a default session on first load so the composer is immediately usable.
  useEffect(() => {
    if (
      !sessionsQuery.isSuccess ||
      sessions.length > 0 ||
      createSession.isPending
    ) {
      return;
    }
    if (autoCreateAttemptedRef.current) {
      return;
    }
    autoCreateAttemptedRef.current = true;
    createSession
      .mutateAsync({ model: selectedModel })
      .then((session) => {
        setActiveSessionId(session.id);
      })
      .catch(() => {
        autoCreateAttemptedRef.current = false;
      });
  }, [
    createSession,
    createSession.isPending,
    selectedModel,
    sessions.length,
    sessionsQuery.isSuccess,
  ]);

  const persistedMessages = useMemo(
    () =>
      (messagesQuery.data ?? cachedSessionRows).map((message) =>
        toUiMessage(message)
      ),
    [cachedSessionRows, messagesQuery.data]
  );

  const transport = useMemo<ChatTransport<UIMessage>>(
    () => ({
      sendMessages: async ({ abortSignal, messages }) => {
        if (!activeSessionId) {
          throw new Error(
            "Cannot send a message without an active chat session."
          );
        }

        if (messages.length === 0) {
          throw new Error("A message payload is required.");
        }

        const iterator = await streamSessionMessage({
          sessionId: activeSessionId,
          messages,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          signal: abortSignal,
        });

        return eventIteratorToUnproxiedDataStream(iterator);
      },

      reconnectToStream: async ({ chatId }) => {
        // Reconnect is best-effort: only attempt it when this session has an
        // active stream pointer from the server.
        if (
          !activeSessionId ||
          chatId !== activeSessionId ||
          !activeSession?.activeStreamId
        ) {
          return null;
        }

        try {
          const iterator = await resumeSessionStream({
            sessionId: activeSessionId,
          });
          return eventIteratorToUnproxiedDataStream(iterator);
        } catch (error) {
          if (error instanceof ORPCError) {
            return null;
          }
          throw error;
        }
      },
    }),
    [
      activeSession?.activeStreamId,
      activeSessionId,
      resumeSessionStream,
      streamSessionMessage,
    ]
  );

  const {
    addToolApprovalResponse,
    error,
    messages,
    resumeStream,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat({
    id: activeSessionId ?? "pending-chat",
    experimental_throttle: 50,
    messages: persistedMessages,
    resume: shouldResumeStream,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport,
    onFinish: async () => {
      approvalPendingRef.current = false;
      if (!activeSessionId) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AI_CHAT_SESSIONS_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: getAiChatMessagesQueryKey(activeSessionId),
        }),
      ]);
    },
  });

  // Wrap addToolApprovalResponse so the rehydration effect doesn't
  // overwrite the approval state before the auto-send microtask fires.
  const handleApprovalResponse =
    useCallback<ChatAddToolApproveResponseFunction>(
      (response) => {
        approvalPendingRef.current = true;
        addToolApprovalResponse(response);
      },
      [addToolApprovalResponse]
    );

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages]
  );

  // Retry resume a few times for active-session cross-device streams to avoid
  // missing the stream when reconnect races initial stream setup.
  useEffect(() => {
    const activeStreamId = activeSession?.activeStreamId ?? null;
    if (!activeStreamId) {
      streamResumeStateRef.current = { attempts: 0, streamId: null };
      return;
    }

    if (status === "submitted" || status === "streaming") {
      return;
    }

    if (streamResumeStateRef.current.streamId !== activeStreamId) {
      streamResumeStateRef.current = { attempts: 0, streamId: activeStreamId };
    }

    const tryResume = () => {
      if (streamResumeStateRef.current.streamId !== activeStreamId) {
        return;
      }
      if (streamResumeStateRef.current.attempts >= MAX_STREAM_RESUME_ATTEMPTS) {
        return;
      }
      streamResumeStateRef.current.attempts += 1;
      resumeStream();
    };

    tryResume();

    const timer = setInterval(() => {
      if (streamResumeStateRef.current.streamId !== activeStreamId) {
        clearInterval(timer);
        return;
      }
      if (
        status !== "ready" ||
        streamResumeStateRef.current.attempts >= MAX_STREAM_RESUME_ATTEMPTS
      ) {
        clearInterval(timer);
        return;
      }
      tryResume();
    }, STREAM_RESUME_RETRY_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [activeSession?.activeStreamId, resumeStream, status]);

  // Rehydrate local stream state from persisted session messages before paint
  // to avoid visible top-to-bottom jumps during session switches.
  useLayoutEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (localSubmitPendingRef.current) {
      return;
    }
    if (status === "streaming" || status === "submitted") {
      approvalPendingRef.current = false;
      return;
    }
    if (approvalPendingRef.current) {
      approvalPendingRef.current = false;
      return;
    }
    // When transitioning from streaming → ready, persistedMessages is still
    // stale (onFinish query invalidation hasn't resolved yet). Skip this
    // cycle to avoid flashing old data; the next run after queries settle
    // will rehydrate with fresh data.
    if (
      (prevStatus === "streaming" || prevStatus === "submitted") &&
      status === "ready"
    ) {
      return;
    }
    setMessages(persistedMessages);
  }, [persistedMessages, setMessages, status]);

  const estimatedUsedTokens = useMemo(() => {
    const combined = visibleMessages
      .map((message) => extractText(message.parts))
      .join("\n");
    const roughTokenEstimate = Math.ceil(combined.length / 4);
    return Math.max(roughTokenEstimate, 1);
  }, [visibleMessages]);

  const handleCreateSession = useCallback(async () => {
    const session = await createSession.mutateAsync({ model: selectedModel });
    setActiveSessionId(session.id);
  }, [createSession, selectedModel]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await deleteSession.mutateAsync({ sessionId });
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
    },
    [activeSessionId, deleteSession]
  );

  const handleSubmit = useCallback(
    (input: { text: string; files: FileUIPart[] }) => {
      const text = input.text.trim();
      const hasFiles = input.files.length > 0;

      if (!activeSessionId || (!hasFiles && text.length === 0)) {
        return;
      }

      // Fire-and-forget so PromptInput can clear immediately after submit.
      // useChat will still manage streaming state and expose errors.
      localSubmitPendingRef.current = true;
      sendMessage({
        text,
        files: input.files,
      })
        .catch((_error) => undefined)
        .finally(() => {
          localSubmitPendingRef.current = false;
        });
    },
    [activeSessionId, sendMessage]
  );

  const hasMessages = visibleMessages.length > 0;
  const isComposerDisabled = !activeSessionId || createSession.isPending;
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === activeSessionId) {
        return;
      }
      setActiveSessionId(sessionId);
    },
    [activeSessionId]
  );

  return (
    <>
      <SidebarHeader className="h-auto shrink-0 border-sidebar-border border-b px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BotIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium text-xs">AI Assistant</span>
          </div>
          <Button
            className="shrink-0"
            onClick={handleCreateSession}
            size="sm"
            type="button"
            variant="outline"
          >
            <PlusIcon className="mr-1 size-3.5" />
            New
          </Button>
        </div>

        <SidebarMenu className="flex-row gap-1 overflow-x-auto pb-1">
          {sessions.map((session) => (
            <div className="flex items-center gap-1" key={session.id}>
              <Button
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => handleSelectSession(session.id)}
                size="sm"
                type="button"
                variant={activeSessionId === session.id ? "secondary" : "ghost"}
              >
                {session.title?.trim().length ? session.title : "Untitled chat"}
              </Button>
              <Button
                className="size-7 rounded-full p-0"
                onClick={() => handleDeleteSession(session.id)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ))}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="min-h-0 gap-0 px-0 py-0">
        <Conversation
          className="min-h-0"
          initial="instant"
          key={activeSessionId ?? "pending-chat"}
          resize="instant"
        >
          <ConversationContent className="gap-4 px-3 py-3">
            {hasMessages ? (
              visibleMessages.map((message, index) => {
                const isLatest = index === visibleMessages.length - 1;
                const isStreamingAssistant =
                  message.role === "assistant" &&
                  isLatest &&
                  (status === "submitted" || status === "streaming");

                return (
                  <SidebarChatMessage
                    isStreamingAssistant={isStreamingAssistant}
                    key={message.id}
                    message={message}
                    onApprovalResponse={handleApprovalResponse}
                  />
                );
              })
            ) : (
              <ConversationEmptyState
                description="Use the composer below to start chatting."
                icon={<MessageCircleIcon className="size-5" />}
                title="No chat messages yet"
              />
            )}

            {error ? (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-destructive text-xs">
                {error.message}
              </div>
            ) : null}

            {messagesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Loader2Icon className="size-3.5 animate-spin" />
                Loading session messages...
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t px-2 py-2">
        <PromptInputProvider>
          <PromptInput
            className="w-full"
            maxFiles={6}
            multiple
            onSubmit={(input) =>
              handleSubmit({
                text: input.text,
                files: input.files,
              })
            }
          >
            {/* Keep header/body/footer as direct children of PromptInput so
                AI Elements input-group layout selectors can size correctly. */}
            <ComposerAttachmentsPreview />

            <PromptInputBody>
              <PromptInputTextarea
                className="min-h-10 text-xs"
                disabled={isComposerDisabled}
                placeholder={
                  isComposerDisabled
                    ? "Preparing chat session..."
                    : "Ask anything..."
                }
                rows={1}
              />
            </PromptInputBody>

            <PromptInputFooter>
              <PromptInputTools className="flex-wrap">
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger disabled={isComposerDisabled} />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <ModelSelector
                  onOpenChange={setModelSelectorOpen}
                  open={modelSelectorOpen}
                >
                  <ModelSelectorTrigger asChild>
                    <PromptInputButton
                      className="shrink-0 whitespace-nowrap px-2.5"
                      disabled={isComposerDisabled}
                      size="sm"
                      tooltip="Select model"
                    >
                      {modelLabel}
                    </PromptInputButton>
                  </ModelSelectorTrigger>
                  <ModelSelectorContent title="Choose model">
                    <ModelSelectorInput placeholder="Filter models..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No model found.</ModelSelectorEmpty>
                      <ModelSelectorGroup heading="OpenAI">
                        {CHAT_MODELS.map((model) => (
                          <ModelSelectorItem
                            key={model.id}
                            onSelect={() => {
                              setSelectedModel(model.id);
                              setModelSelectorOpen(false);
                            }}
                            value={model.label}
                          >
                            <ModelSelectorLogo provider="openai" />
                            <ModelSelectorName>{model.label}</ModelSelectorName>
                          </ModelSelectorItem>
                        ))}
                      </ModelSelectorGroup>
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>

                <Context
                  maxTokens={128_000}
                  modelId={selectedModel}
                  usedTokens={estimatedUsedTokens}
                >
                  <ContextTrigger className="h-8 shrink-0 px-2 text-xs" />
                  <ContextContent align="start">
                    <ContextContentHeader />
                    <ContextContentBody className="space-y-1">
                      <ContextInputUsage />
                      <ContextOutputUsage />
                      <ContextReasoningUsage />
                    </ContextContentBody>
                  </ContextContent>
                </Context>
              </PromptInputTools>

              <PromptInputSubmit
                disabled={isComposerDisabled}
                onStop={stop}
                status={status}
              />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
      </SidebarFooter>
    </>
  );
}
