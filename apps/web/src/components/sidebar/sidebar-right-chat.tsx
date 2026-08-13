"use client";

import { useChat } from "@ai-sdk/react";
import {
  buildMessageSegments,
  extractAttachments,
  extractText,
  formatToolName,
  type MessageSegment,
  type ToolPart,
  toUiMessage,
} from "@kompose/ai/ai-message-utils";
import type { AiSessionOutput } from "@kompose/api/routers/ai/contract";
import { useAiChat } from "@kompose/state/hooks/use-ai-chat";
import { eventIteratorToUnproxiedDataStream, ORPCError } from "@orpc/client";
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
interface ChatModelOverride {
  model: ChatModelId;
  sessionId: string | null;
}

const CHAT_MODELS: { id: ChatModelId; label: string }[] = [
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
];
const DEFAULT_CHAT_MODEL: ChatModelId = "gpt-5-mini";
const MAX_STREAM_RESUME_ATTEMPTS = 4;
const STREAM_RESUME_RETRY_INTERVAL_MS = 750;

function getSessionModel(model: string | null | undefined): ChatModelId {
  return model === "gpt-5" || model === "gpt-5-mini"
    ? model
    : DEFAULT_CHAT_MODEL;
}

function ComposerAttachmentsPreview() {
  const { files, remove } = usePromptInputAttachments();

  if (files.length === 0) {
    return null;
  }

  return (
    <PromptInputHeader>
      <Attachments variant="inline">
        {files.map((file) => (
          <ComposerAttachment file={file} key={file.id} onRemove={remove} />
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

function ComposerAttachment({
  file,
  onRemove,
}: {
  file: FileUIPart & { id: string };
  onRemove: (id: string) => void;
}) {
  const handleRemove = useCallback(
    () => onRemove(file.id),
    [file.id, onRemove]
  );

  return (
    <Attachment data={file} onRemove={handleRemove}>
      <AttachmentPreview />
      <AttachmentInfo />
      <AttachmentRemove />
    </Attachment>
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
  const approvalId = part.approval?.id;
  const handleReject = useCallback(() => {
    if (approvalId) {
      onApprovalResponse({ approved: false, id: approvalId });
    }
  }, [approvalId, onApprovalResponse]);
  const handleApprove = useCallback(() => {
    if (approvalId) {
      onApprovalResponse({ approved: true, id: approvalId });
    }
  }, [approvalId, onApprovalResponse]);
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

        {part.approval ? (
          <Confirmation approval={part.approval} state={part.state}>
            <ConfirmationRequest>
              <span className="text-xs">Approve this action?</span>
              <ConfirmationActions>
                <ConfirmationAction onClick={handleReject} variant="outline">
                  Reject
                </ConfirmationAction>
                <ConfirmationAction onClick={handleApprove}>
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
        ) : null}

        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

interface SegmentRendererProps {
  isLastSegment: boolean;
  isStreamingAssistant: boolean;
  messageRole: UIMessage["role"];
  onApprovalResponse: ChatAddToolApproveResponseFunction;
  segment: MessageSegment;
}

function SegmentRenderer({
  segment,
  messageRole,
  isStreamingAssistant,
  isLastSegment,
  onApprovalResponse,
}: SegmentRendererProps) {
  if (segment.kind === "reasoning" && messageRole === "assistant") {
    const isActive = isStreamingAssistant && isLastSegment;
    const showContent = segment.text.length > 0 || isActive;

    return (
      <ChainOfThought defaultOpen={isActive}>
        <ChainOfThoughtHeader className="text-xs" />
        {showContent ? (
          <ChainOfThoughtContent>
            <ChainOfThoughtStep
              className="text-xs"
              label={isActive ? "Reasoning (streaming)" : "Reasoning"}
              status={isActive ? "active" : "complete"}
            >
              <MessageResponse>{segment.text || "Thinking…"}</MessageResponse>
            </ChainOfThoughtStep>
          </ChainOfThoughtContent>
        ) : null}
      </ChainOfThought>
    );
  }

  if (segment.kind === "text") {
    if (messageRole === "user") {
      return <p className="whitespace-pre-wrap">{segment.text}</p>;
    }
    return <MessageResponse>{segment.text}</MessageResponse>;
  }

  if (segment.kind === "tool") {
    return (
      <ToolInvocationPart
        onApprovalResponse={onApprovalResponse}
        part={segment.part}
      />
    );
  }

  return null;
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

        {segments.map((segment, index) => (
          <SegmentRenderer
            isLastSegment={index === segments.length - 1}
            isStreamingAssistant={isStreamingAssistant}
            key={
              segment.kind === "tool"
                ? segment.part.toolCallId
                : `${message.id}-${segment.id}`
            }
            messageRole={message.role}
            onApprovalResponse={onApprovalResponse}
            segment={segment}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function ChatSessionTab({
  active,
  onDelete,
  onSelect,
  session,
}: {
  active: boolean;
  onDelete: (sessionId: string) => Promise<void>;
  onSelect: (sessionId: string) => void;
  session: AiSessionOutput;
}) {
  const handleSelect = useCallback(
    () => onSelect(session.id),
    [onSelect, session.id]
  );
  const handleDelete = useCallback(() => {
    onDelete(session.id).catch((error) => {
      console.warn("Failed to delete chat session.", error);
    });
  }, [onDelete, session.id]);

  return (
    <div className="flex items-center gap-1">
      <Button
        className="h-7 rounded-full px-3 text-xs"
        onClick={handleSelect}
        size="sm"
        type="button"
        variant={active ? "secondary" : "ghost"}
      >
        {session.title?.trim().length ? session.title : "Untitled chat"}
      </Button>
      <Button
        aria-label={`Delete ${session.title?.trim() || "untitled chat"}`}
        className="size-7 rounded-full p-0"
        onClick={handleDelete}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  );
}

function ChatModelOption({
  model,
  onSelect,
}: {
  model: (typeof CHAT_MODELS)[number];
  onSelect: (modelId: ChatModelId) => void;
}) {
  const handleSelect = useCallback(
    () => onSelect(model.id),
    [model.id, onSelect]
  );

  return (
    <ModelSelectorItem onSelect={handleSelect} value={model.label}>
      <ModelSelectorLogo provider="openai" />
      <ModelSelectorName>{model.label}</ModelSelectorName>
    </ModelSelectorItem>
  );
}

function useSidebarChatController() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [modelOverride, setModelOverride] = useState<ChatModelOverride | null>(
    null
  );
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const autoCreateAttemptedRef = useRef<boolean>(false);
  const localSubmitPendingRef = useRef<boolean>(false);
  const approvalPendingRef = useRef<boolean>(false);
  const streamResumeStateRef = useRef<{
    attempts: number;
    streamId: string | null;
  }>({ attempts: 0, streamId: null });
  const {
    activeSession,
    activeSessionId,
    sessions,
    sessionsQuery,
    messagesQuery,
    createSession,
    deleteSession,
    streamSessionMessage,
    resumeSessionStream,
  } = useAiChat(selectedSessionId);
  const selectedModel =
    modelOverride?.sessionId === activeSessionId
      ? modelOverride.model
      : getSessionModel(activeSession?.model);
  const modelLabel =
    CHAT_MODELS.find((model) => model.id === selectedModel)?.label ??
    "GPT-5 Mini";

  // Auto-create a default session on first load so the composer is immediately usable.
  useEffect(() => {
    if (
      !sessionsQuery.isSuccess ||
      sessions.length > 0 ||
      createSession.isPending
    ) {
      return;
    }
    // Biome cannot see the async mutation callback that flips this ref.
    // biome-ignore lint/suspicious/noUnnecessaryConditions: updated asynchronously
    if (autoCreateAttemptedRef.current) {
      return;
    }
    autoCreateAttemptedRef.current = true;
    createSession
      .mutateAsync({ model: selectedModel })
      .then((session) => {
        setSelectedSessionId(session.id);
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
    () => (messagesQuery.data ?? []).map((message) => toUiMessage(message)),
    [messagesQuery.data]
  );

  const transport = useMemo<ChatTransport<UIMessage>>(
    () => ({
      reconnectToStream: async ({ chatId }) => {
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
        } catch (caughtError) {
          if (caughtError instanceof ORPCError) {
            return null;
          }
          throw caughtError;
        }
      },
      sendMessages: async ({ abortSignal, messages: outgoingMessages }) => {
        if (!activeSessionId) {
          throw new Error(
            "Cannot send a message without an active chat session."
          );
        }

        if (outgoingMessages.length === 0) {
          throw new Error("A message payload is required.");
        }

        const iterator = await streamSessionMessage({
          messages: outgoingMessages,
          sessionId: activeSessionId,
          signal: abortSignal,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });

        return eventIteratorToUnproxiedDataStream(iterator);
      },
    }),
    [
      activeSessionId,
      activeSession?.activeStreamId,
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
    experimental_throttle: 50,
    id: activeSessionId ?? "pending-chat",
    messages: persistedMessages,
    onFinish: () => {
      approvalPendingRef.current = false;
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    transport,
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
      // Hydrate persisted messages (including the user message from the other
      // device) before connecting to the stream. The normal rehydration effect
      // is blocked while status is "streaming", so this is the only chance.
      setMessages(persistedMessages);
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
  }, [
    activeSession?.activeStreamId,
    persistedMessages,
    resumeStream,
    setMessages,
    status,
  ]);

  // Rehydrate local stream state from persisted session messages before paint
  // to avoid visible top-to-bottom jumps during session switches.
  const prevStatusRef = useRef<string>("ready");
  useLayoutEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // Biome cannot see the promise callback that flips this ref.
    // biome-ignore lint/suspicious/noUnnecessaryConditions: updated asynchronously
    if (localSubmitPendingRef.current) {
      return;
    }
    if (status === "streaming" || status === "submitted") {
      approvalPendingRef.current = false;
      return;
    }
    // Biome cannot see the approval callback that flips this ref.
    // biome-ignore lint/suspicious/noUnnecessaryConditions: updated asynchronously
    if (approvalPendingRef.current) {
      approvalPendingRef.current = false;
      return;
    }
    // When transitioning from streaming → ready, persistedMessages is still
    // stale (onFinish query invalidation hasn't resolved yet). Skip this
    // cycle so useChat's internal state (which has the full conversation)
    // isn't overwritten with stale data. The next run after queries settle
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
    setSelectedSessionId(session.id);
  }, [createSession, selectedModel]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await deleteSession.mutateAsync({ sessionId });
      if (activeSessionId === sessionId) {
        setSelectedSessionId(null);
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
        files: input.files,
        text,
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
  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
  }, []);
  const handleSelectModel = useCallback(
    (modelId: ChatModelId) => {
      setModelOverride({ model: modelId, sessionId: activeSessionId });
      setModelSelectorOpen(false);
    },
    [activeSessionId]
  );

  return {
    activeSessionId,
    error,
    estimatedUsedTokens,
    handleApprovalResponse,
    handleCreateSession,
    handleDeleteSession,
    handleSelectModel,
    handleSelectSession,
    handleSubmit,
    hasMessages,
    isComposerDisabled,
    isLoadingMessages: messagesQuery.isLoading,
    modelLabel,
    modelSelectorOpen,
    selectedModel,
    sessions,
    setModelSelectorOpen,
    status,
    stop,
    visibleMessages,
  };
}

export function SidebarRightChat() {
  const {
    activeSessionId,
    error,
    estimatedUsedTokens,
    handleApprovalResponse,
    handleCreateSession,
    handleDeleteSession,
    handleSelectModel,
    handleSelectSession,
    handleSubmit,
    hasMessages,
    isComposerDisabled,
    isLoadingMessages,
    modelLabel,
    modelSelectorOpen,
    selectedModel,
    sessions,
    setModelSelectorOpen,
    status,
    stop,
    visibleMessages,
  } = useSidebarChatController();

  return (
    <>
      <SidebarHeader className="h-auto shrink-0 border-sidebar-border border-b p-2">
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
            <ChatSessionTab
              active={activeSessionId === session.id}
              key={session.id}
              onDelete={handleDeleteSession}
              onSelect={handleSelectSession}
              session={session}
            />
          ))}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="min-h-0 gap-0 p-0">
        <Conversation
          className="min-h-0"
          initial="instant"
          key={activeSessionId ?? "pending-chat"}
          resize="instant"
        >
          <ConversationContent className="gap-4 p-3">
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

            {isLoadingMessages ? (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Loader2Icon className="size-3.5 animate-spin" />
                Loading session messages…
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t p-2">
        <PromptInputProvider>
          <PromptInput
            className="w-full"
            maxFiles={6}
            multiple
            onSubmit={handleSubmit}
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
                    ? "Preparing chat session…"
                    : "Ask anything…"
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
                    <ModelSelectorInput placeholder="Filter models…" />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No model found.</ModelSelectorEmpty>
                      <ModelSelectorGroup heading="OpenAI">
                        {CHAT_MODELS.map((model) => (
                          <ChatModelOption
                            key={model.id}
                            model={model}
                            onSelect={handleSelectModel}
                          />
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
