import { useChat } from "@ai-sdk/react";
import {
  AI_CHAT_SESSIONS_QUERY_KEY,
  getAiChatMessagesQueryKey,
  useAiChat,
} from "@kompose/state/hooks/use-ai-chat";
import { eventIteratorToUnproxiedDataStream, ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatTransport, FileUIPart, UIMessage } from "ai";
import { Stack } from "expo-router/stack";
import {
  Check,
  ChevronDown,
  Loader2,
  MessageCircle,
  Plus,
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
  type AttachmentData,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { useColorScheme } from "@/hooks/useColorScheme";
import { cn } from "@/lib/utils";

type ChatModelId = "gpt-5" | "gpt-5-mini";

const CHAT_MODELS: { id: ChatModelId; label: string; provider: string }[] = [
  { id: "gpt-5", label: "GPT-5", provider: "openai" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeMessageRole(
  role: string
): Extract<UIMessage["role"], "assistant" | "system" | "user"> {
  if (role === "assistant" || role === "system" || role === "user") {
    return role;
  }
  return "assistant";
}

/**
 * Converts persisted DB rows into AI SDK UI messages.
 */
function toUiMessage(row: {
  id: string;
  role: string;
  content: string;
  parts: unknown;
}): UIMessage {
  const parts =
    Array.isArray(row.parts) && row.parts.length > 0
      ? (row.parts as UIMessage["parts"])
      : [{ type: "text" as const, text: row.content }];

  return {
    id: row.id,
    role: normalizeMessageRole(row.role),
    parts,
  };
}

/**
 * Aggregates text parts to support display + rough token estimation.
 */
function extractText(parts: UIMessage["parts"]): string {
  return parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

function extractReasoning(parts: UIMessage["parts"]): string {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.type !== "reasoning" || !isRecord(part)) {
      continue;
    }
    const text = asString(part.text) ?? "";
    if (text.length > 0) {
      lines.push(text);
    }
  }
  return lines.join("\n").trim();
}

function hasReasoningPart(parts: UIMessage["parts"]): boolean {
  return parts.some((part) => part.type === "reasoning");
}

function extractAttachments(
  messageId: string,
  parts: UIMessage["parts"]
): AttachmentData[] {
  const attachments: AttachmentData[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.type === "file") {
      attachments.push({ ...part, id: `${messageId}-file-${index}` });
    }
    if (part.type === "source-document") {
      attachments.push({ ...part, id: `${messageId}-source-${index}` });
    }
  }
  return attachments;
}

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
  sessions: { id: string; title: string | null }[];
  activeSessionId: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
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
  selectedModel: ChatModelId;
  isOpen: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectModel: (modelId: ChatModelId) => void;
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

interface ChatMessageCardProps {
  message: UIMessage;
  isStreamingAssistant: boolean;
}

/**
 * Message renderer for text/reasoning/attachment parts.
 */
function ChatMessageCard({
  message,
  isStreamingAssistant,
}: ChatMessageCardProps) {
  const colorScheme = useColorScheme();
  const attachments = useMemo(
    () => extractAttachments(message.id, message.parts),
    [message.id, message.parts]
  );
  const reasoning = useMemo(
    () => extractReasoning(message.parts),
    [message.parts]
  );
  const hasReasoning = useMemo(
    () => hasReasoningPart(message.parts),
    [message.parts]
  );
  const text = useMemo(() => extractText(message.parts), [message.parts]);

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

        {message.role === "assistant" ? (
          <ChainOfThought defaultOpen={isStreamingAssistant}>
            {hasReasoning ? (
              <ChainOfThoughtHeader>Reasoning</ChainOfThoughtHeader>
            ) : null}
            {hasReasoning && (reasoning.length > 0 || isStreamingAssistant) ? (
              <ChainOfThoughtContent>
                <ChainOfThoughtStep
                  label={
                    isStreamingAssistant ? "Reasoning (streaming)" : "Reasoning"
                  }
                  status={isStreamingAssistant ? "active" : "complete"}
                >
                  <MessageResponse className="w-full">
                    <StreamdownRN
                      // Reasoning can stream independently while the assistant response streams.
                      isComplete={!isStreamingAssistant}
                      style={{ flex: 0 }}
                      theme={colorScheme}
                    >
                      {reasoning || "Thinking..."}
                    </StreamdownRN>
                  </MessageResponse>
                </ChainOfThoughtStep>
              </ChainOfThoughtContent>
            ) : null}
          </ChainOfThought>
        ) : null}

        {text.length > 0 ? (
          <MessageResponse
            className={cn(message.role === "user" ? "bg-secondary" : "")}
          >
            <StreamdownRN
              // Mark streaming completion so the renderer can finalize active blocks.
              isComplete={!isStreamingAssistant}
              style={{ flex: 0 }}
              theme={colorScheme}
            >
              {text}
            </StreamdownRN>
          </MessageResponse>
        ) : null}
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

        const message = messages.at(-1);
        if (!message) {
          throw new Error("A message payload is required.");
        }

        const iterator = await streamSessionMessage({
          sessionId: activeSessionId,
          message,
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

  const { error, messages, sendMessage, setMessages, status, stop } = useChat({
    id: activeSessionId ?? "pending-chat",
    messages: persistedMessages,
    resume: shouldResumeStream,
    transport,
    onFinish: async () => {
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

  // Rehydrate local chat state when switching sessions.
  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      return;
    }
    setMessages(persistedMessages);
  }, [persistedMessages, setMessages, status]);

  const messageCount = messages.length;

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
      sendMessage({
        text,
        files: input.files,
      }).catch(() => undefined);
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
                data={messages}
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
                  const isLatest = index === messages.length - 1;
                  const isStreamingAssistant =
                    item.role === "assistant" &&
                    isLatest &&
                    (status === "submitted" || status === "streaming");

                  return (
                    <ChatMessageCard
                      isStreamingAssistant={isStreamingAssistant}
                      message={item}
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
