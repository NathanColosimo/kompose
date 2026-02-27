import { useChat } from "@ai-sdk/react";
import {
  buildMessageSegments,
  extractAttachments,
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
import { Stack } from "expo-router/stack";
import {
  Check,
  ChevronDown,
  Loader2,
  MessageCircle,
  Plus,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StreamdownRN } from "streamdown-rn";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-chat/attachments";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-chat/chain-of-thought";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
} from "@/components/ai-chat/confirmation";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-chat/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-chat/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-chat/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-chat/tool";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { useColorScheme } from "@/hooks/useColorScheme";

type ChatModelId = "gpt-5" | "gpt-5-mini";

const CHAT_MODELS: { id: ChatModelId; label: string; provider: string }[] = [
  { id: "gpt-5", label: "GPT-5", provider: "openai" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai" },
];
const MAX_STREAM_RESUME_ATTEMPTS = 4;
const STREAM_RESUME_RETRY_INTERVAL_MS = 750;

/**
 * Composer-level attachment preview list.
 */
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

interface HeaderSessionMenuProps {
  activeSessionId: string | null;
  isOpen: boolean;
  onCreateSession: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  sessions: { id: string; title: string | null }[];
}

/**
 * Native-like session menu anchored to the header-left trigger.
 */
function HeaderSessionMenu({
  sessions,
  activeSessionId,
  isOpen,
  onOpenChange,
  onCreateSession,
  onSelectSession,
}: HeaderSessionMenuProps) {
  const activeSessionLabel =
    sessions.find((session) => session.id === activeSessionId)?.title?.trim() ||
    "Session";
  const mutedIconColor = useColor("textMuted");
  const iconColor = useColor("text");

  return (
    <Popover onOpenChange={onOpenChange} open={isOpen}>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityLabel="Open session picker"
          className="max-w-44 flex-row items-center gap-1.5 rounded-lg py-1.5 pr-3 pl-4 active:opacity-70"
        >
          <Text className="max-w-32 text-foreground text-sm" numberOfLines={1}>
            {activeSessionLabel}
          </Text>
          <ChevronDown color={mutedIconColor} size={14} />
        </Pressable>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        maxHeight={340}
        maxWidth={300}
        side="bottom"
        sideOffset={8}
        style={{ minWidth: 240 }}
      >
        <View className="gap-1">
          <Pressable
            className="flex-row items-center gap-2 rounded-md px-2 py-2.5 active:bg-muted"
            onPress={() => {
              onCreateSession()
                .then(() => onOpenChange(false))
                .catch(() => undefined);
            }}
          >
            <Plus color={iconColor} size={14} />
            <Text className="text-sm">New chat</Text>
          </Pressable>

          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 240 }}
          >
            {sessions.map((session) => (
              <Pressable
                className="flex-row items-center gap-2 rounded-md px-2 py-2.5 active:bg-muted"
                key={session.id}
                onPress={() => {
                  onSelectSession(session.id);
                  onOpenChange(false);
                }}
              >
                <Text className="flex-1 text-sm" numberOfLines={1}>
                  {session.title?.trim().length
                    ? session.title
                    : "Untitled chat"}
                </Text>
                {session.id === activeSessionId ? (
                  <Check color={iconColor} size={14} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </PopoverContent>
    </Popover>
  );
}

interface HeaderModelMenuProps {
  disabled: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectModel: (modelId: ChatModelId) => void;
  selectedModel: ChatModelId;
}

/**
 * Native-like model menu anchored to the header-right trigger.
 */
function HeaderModelMenu({
  selectedModel,
  isOpen,
  disabled,
  onOpenChange,
  onSelectModel,
}: HeaderModelMenuProps) {
  const selectedModelLabel =
    CHAT_MODELS.find((model) => model.id === selectedModel)?.label ??
    "GPT-5 Mini";
  const mutedIconColor = useColor("textMuted");
  const iconColor = useColor("text");

  return (
    <Popover onOpenChange={onOpenChange} open={isOpen}>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityLabel="Open model picker"
          className="h-8 flex-row items-center gap-1 rounded-full px-3 active:opacity-70"
          disabled={disabled}
        >
          <Text className="text-foreground text-sm">{selectedModelLabel}</Text>
          <ChevronDown color={mutedIconColor} size={14} />
        </Pressable>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        maxHeight={260}
        maxWidth={240}
        side="bottom"
        sideOffset={8}
        style={{ minWidth: 190 }}
      >
        <View className="gap-1">
          {CHAT_MODELS.map((model) => (
            <Pressable
              className="flex-row items-center gap-2 rounded-md px-2 py-2.5 active:bg-muted"
              key={model.id}
              onPress={() => {
                onSelectModel(model.id);
                onOpenChange(false);
              }}
            >
              <Text className="flex-1 text-sm">{model.label}</Text>
              {model.id === selectedModel ? (
                <Check color={iconColor} size={14} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </PopoverContent>
    </Popover>
  );
}

interface ComposerInputRowProps {
  isComposerDisabled: boolean;
  status: "submitted" | "streaming" | "ready" | "error";
  stop: () => void;
}

/**
 * Inline composer row: plus on left, input middle, send/stop on right.
 */
function ComposerInputRow({
  isComposerDisabled,
  status,
  stop,
}: ComposerInputRowProps) {
  const { openImagePicker } = usePromptInputAttachments();
  const iconColor = useColor("text");

  return (
    <PromptInputBody>
      <View className="flex-row items-end gap-2">
        <PromptInputButton
          accessibilityLabel="Add photos"
          disabled={isComposerDisabled}
          onPress={() => {
            openImagePicker().catch(() => undefined);
          }}
        >
          <Plus color={iconColor} size={16} />
        </PromptInputButton>
        <View className="flex-1">
          <PromptInputTextarea
            className="min-h-0"
            disabled={isComposerDisabled}
            placeholder={
              isComposerDisabled
                ? "Preparing chat session..."
                : "Ask anything..."
            }
            rows={1}
          />
        </View>
        <PromptInputSubmit
          disabled={isComposerDisabled}
          onStop={stop}
          status={status}
        />
      </View>
    </PromptInputBody>
  );
}

/**
 * Renders a single tool invocation with input, confirmation, and output
 * inside a collapsible Tool component.
 */
function NativeToolInvocationPart({
  part,
  onApprovalResponse,
}: {
  part: ToolPart;
  onApprovalResponse: ChatAddToolApproveResponseFunction;
}) {
  const iconColor = useColor("text");
  const mutedIconColor = useColor("textMuted");

  const defaultOpen =
    part.state === "approval-requested" ||
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "output-denied";

  return (
    <Tool defaultOpen={defaultOpen}>
      <ToolHeader state={part.state} title={formatToolName(part.type)} />
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}

        {part.approval && (
          <Confirmation approval={part.approval} state={part.state}>
            <ConfirmationRequest>
              <Text className="text-xs">Approve this action?</Text>
              <ConfirmationActions>
                <ConfirmationAction
                  onPress={() =>
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
                  onPress={() =>
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
              <View className="flex-row items-center gap-1">
                <Check color={iconColor} size={12} />
                <Text className="text-xs">Approved</Text>
              </View>
            </ConfirmationAccepted>
            <ConfirmationRejected>
              <View className="flex-row items-center gap-1">
                <X color={mutedIconColor} size={12} />
                <Text className="text-xs">Rejected</Text>
              </View>
            </ConfirmationRejected>
          </Confirmation>
        )}

        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

interface ChatMessageCardProps {
  isStreamingAssistant: boolean;
  message: UIMessage;
  onApprovalResponse: ChatAddToolApproveResponseFunction;
}

/**
 * Message renderer using segment-based layout for correct
 * interleaving of reasoning, text, and tool parts.
 */
function ChatMessageCard({
  message,
  isStreamingAssistant,
  onApprovalResponse,
}: ChatMessageCardProps) {
  const colorScheme = useColorScheme();
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
      <MessageContent from={message.role}>
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
                <ChainOfThoughtHeader>Reasoning</ChainOfThoughtHeader>
                {showContent ? (
                  <ChainOfThoughtContent>
                    <ChainOfThoughtStep
                      label={isActive ? "Reasoning (streaming)" : "Reasoning"}
                      status={isActive ? "active" : "complete"}
                    >
                      <MessageResponse className="w-full">
                        <StreamdownRN
                          isComplete={!isActive}
                          style={{ flex: 0 }}
                          theme={colorScheme}
                        >
                          {segment.text || "Thinking..."}
                        </StreamdownRN>
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
                <MessageResponse
                  className="bg-secondary"
                  key={`${message.id}-text-${index}`}
                >
                  <Text>{segment.text}</Text>
                </MessageResponse>
              );
            }
            return (
              <MessageResponse key={`${message.id}-text-${index}`}>
                <StreamdownRN
                  isComplete={!isStreamingAssistant}
                  style={{ flex: 0 }}
                  theme={colorScheme}
                >
                  {segment.text}
                </StreamdownRN>
              </MessageResponse>
            );
          }

          if (segment.kind === "tool") {
            return (
              <NativeToolInvocationPart
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

/**
 * Full native chat screen with session controls and streaming.
 */
export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ChatModelId>("gpt-5-mini");
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const autoCreateAttemptedRef = useRef(false);
  const localSubmitPendingRef = useRef(false);
  const approvalPendingRef = useRef(false);
  const prevStatusRef = useRef<string>("ready");
  const streamResumeStateRef = useRef<{
    attempts: number;
    streamId: string | null;
  }>({ attempts: 0, streamId: null });
  const isNearBottomRef = useRef(true);
  const listRef = useRef<FlatList<UIMessage> | null>(null);
  const queryClient = useQueryClient();

  const {
    sessionsQuery,
    messagesQuery,
    createSession,
    streamSessionMessage,
    resumeSessionStream,
  } = useAiChat(activeSessionId);

  const sessions = sessionsQuery.data ?? [];
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const shouldResumeStream = Boolean(
    activeSessionId && activeSession?.activeStreamId
  );

  const cachedSessionRows = useMemo(() => {
    if (!activeSessionId) {
      return [];
    }
    // Read per-session cache directly so switching sessions feels immediate.
    return (
      queryClient.getQueryData<
        { id: string; role: string; content: string; parts: unknown }[]
      >(getAiChatMessagesQueryKey(activeSessionId)) ?? []
    );
  }, [activeSessionId, queryClient]);

  // Keep selected model in sync with active session model when possible.
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

  // Always select a valid session when sessions load or change.
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

  // Auto-create a default session on first successful fetch.
  useEffect(() => {
    if (
      !sessionsQuery.isSuccess ||
      sessions.length > 0 ||
      createSession.isPending ||
      autoCreateAttemptedRef.current
    ) {
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
        // Reconnect only when the server indicates an active stream.
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

  // Rehydrate local chat state when switching sessions.
  useEffect(() => {
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

  const messageCount = visibleMessages.length;

  // Auto-scroll to latest message unless user intentionally scrolled up.
  useEffect(() => {
    if (messageCount === 0) {
      return;
    }
    if (!isNearBottomRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messageCount]);

  const handleCreateSession = useCallback(async () => {
    const session = await createSession.mutateAsync({ model: selectedModel });
    setActiveSessionId(session.id);
  }, [createSession, selectedModel]);

  // Keep only one header menu open at a time to avoid overlapping popovers.
  const handleSessionMenuOpenChange = useCallback((open: boolean) => {
    setIsSessionMenuOpen(open);
    if (open) {
      setIsModelMenuOpen(false);
    }
  }, []);

  // Keep only one header menu open at a time to avoid overlapping popovers.
  const handleModelMenuOpenChange = useCallback((open: boolean) => {
    setIsModelMenuOpen(open);
    if (open) {
      setIsSessionMenuOpen(false);
    }
  }, []);

  const handleSubmit = useCallback(
    (input: { text: string; files: FileUIPart[] }) => {
      const text = input.text.trim();
      const hasFiles = input.files.length > 0;
      if (!activeSessionId || (!hasFiles && text.length === 0)) {
        return;
      }
      // Fire-and-forget keeps the composer responsive while useChat streams.
      localSubmitPendingRef.current = true;
      sendMessage({
        text,
        files: input.files,
      })
        .catch(() => undefined)
        .finally(() => {
          localSubmitPendingRef.current = false;
        });
    },
    [activeSessionId, sendMessage]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } =
        event.nativeEvent;
      const nearBottom =
        layoutMeasurement.height + contentOffset.y >= contentSize.height - 80;
      isNearBottomRef.current = nearBottom;
      setShowScrollButton(!nearBottom);
    },
    []
  );

  const handleContentSizeChange = useCallback(() => {
    // Keep following streaming output unless the user intentionally scrolled up.
    if (!isNearBottomRef.current) {
      return;
    }
    if (!(status === "submitted" || status === "streaming")) {
      return;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [status]);

  const hasMessages = messageCount > 0;
  const isComposerDisabled = !activeSessionId || createSession.isPending;
  const bottomTabsOffset =
    (Platform.OS === "ios" ? 56 : 48) + Math.max(insets.bottom, 8);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: "Chat",
          headerLeft: () => (
            <HeaderSessionMenu
              activeSessionId={activeSessionId}
              isOpen={isSessionMenuOpen}
              onCreateSession={handleCreateSession}
              onOpenChange={handleSessionMenuOpenChange}
              onSelectSession={setActiveSessionId}
              sessions={sessions.map((session) => ({
                id: session.id,
                title: session.title ?? null,
              }))}
            />
          ),
          headerRight: () => (
            <HeaderModelMenu
              disabled={isComposerDisabled}
              isOpen={isModelMenuOpen}
              onOpenChange={handleModelMenuOpenChange}
              onSelectModel={setSelectedModel}
              selectedModel={selectedModel}
            />
          ),
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        {/* Conversation thread */}
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="min-h-0 flex-1 px-3 py-3">
            {hasMessages ? (
              <FlatList
                contentContainerStyle={{ gap: 12, paddingBottom: 0 }}
                data={visibleMessages}
                keyExtractor={(item) => item.id}
                onContentSizeChange={handleContentSizeChange}
                onScroll={handleScroll}
                onScrollBeginDrag={() => {
                  isNearBottomRef.current = false;
                  setIsSessionMenuOpen(false);
                  setIsModelMenuOpen(false);
                }}
                ref={listRef}
                renderItem={({ item, index }) => {
                  const isLatest = index === visibleMessages.length - 1;
                  const isStreamingAssistant =
                    item.role === "assistant" &&
                    isLatest &&
                    (status === "submitted" || status === "streaming");

                  return (
                    <ChatMessageCard
                      isStreamingAssistant={isStreamingAssistant}
                      message={item}
                      onApprovalResponse={handleApprovalResponse}
                    />
                  );
                }}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
              />
            ) : (
              <ConversationEmptyState
                description="Use the composer below to start chatting."
                icon={<MessageCircle size={20} />}
                title="No chat messages yet"
              />
            )}

            {error ? (
              <View className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2">
                <Text className="text-destructive text-xs">
                  {error.message}
                </Text>
              </View>
            ) : null}

            {messagesQuery.isLoading ? (
              <View className="flex-row items-center gap-2">
                <Loader2 size={14} />
                <Text className="text-muted-foreground text-xs">
                  Loading session messages...
                </Text>
              </View>
            ) : null}
          </ConversationContent>

          <ConversationScrollButton
            onPress={() => {
              listRef.current?.scrollToEnd({ animated: true });
              isNearBottomRef.current = true;
              setShowScrollButton(false);
            }}
            visible={showScrollButton}
          />
        </Conversation>

        {/* Composer */}
        <View
          className="border-border border-t bg-background px-2 pt-2"
          style={{ paddingBottom: bottomTabsOffset }}
        >
          <PromptInputProvider>
            <PromptInput
              className="w-full border-0 bg-transparent p-0"
              disabled={isComposerDisabled}
              onSubmit={handleSubmit}
            >
              <ComposerAttachmentsPreview />
              <ComposerInputRow
                isComposerDisabled={isComposerDisabled}
                status={status}
                stop={stop}
              />
            </PromptInput>
          </PromptInputProvider>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
