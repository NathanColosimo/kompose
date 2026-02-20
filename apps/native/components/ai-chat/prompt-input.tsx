import type { ChatStatus, FileUIPart } from "ai";
import {
  FileText,
  ImageIcon,
  Plus,
  SendHorizontal,
  Square,
} from "lucide-react-native";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Pressable, TextInput } from "react-native";
import { uuidv7 } from "uuidv7";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { cn } from "@/lib/utils";

type PromptInputFile = FileUIPart & { id: string };

interface PromptInputTextContextValue {
  clearText: () => void;
  setText: (next: string) => void;
  text: string;
}

interface PromptInputAttachmentsContextValue {
  clearFiles: () => void;
  files: PromptInputFile[];
  openDocumentPicker: () => Promise<void>;
  openImagePicker: () => Promise<void>;
  removeFile: (id: string) => void;
  setFiles: (
    updater: (current: PromptInputFile[]) => PromptInputFile[]
  ) => void;
}

interface PromptInputSubmitContextValue {
  disabled?: boolean;
  onSubmit?: (input: {
    text: string;
    files: FileUIPart[];
  }) => void | Promise<void>;
}

interface PromptInputActionMenuContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const PromptInputTextContext =
  createContext<PromptInputTextContextValue | null>(null);
const PromptInputAttachmentsContext =
  createContext<PromptInputAttachmentsContextValue | null>(null);
const PromptInputSubmitContext =
  createContext<PromptInputSubmitContextValue | null>(null);
const PromptInputActionMenuContext =
  createContext<PromptInputActionMenuContextValue | null>(null);
const NEWLINE_PATTERN = /\r\n|\r|\n/;

function useTextContext() {
  const context = useContext(PromptInputTextContext);
  if (!context) {
    throw new Error(
      "Prompt input text context is missing. Wrap with <PromptInputProvider>."
    );
  }
  return context;
}

function useAttachmentsContext() {
  const context = useContext(PromptInputAttachmentsContext);
  if (!context) {
    throw new Error(
      "Prompt input attachments context is missing. Wrap with <PromptInputProvider>."
    );
  }
  return context;
}

function useSubmitContext() {
  const context = useContext(PromptInputSubmitContext);
  if (!context) {
    throw new Error(
      "Prompt input submit context is missing. Wrap with <PromptInput>."
    );
  }
  return context;
}

function useActionMenuContext() {
  const context = useContext(PromptInputActionMenuContext);
  if (!context) {
    throw new Error(
      "Prompt input action menu context is missing. Wrap with <PromptInputActionMenu>."
    );
  }
  return context;
}

/**
 * Converts a local RN URI to a data URL so the server can consume it.
 * Falls back to the original URI when conversion fails.
 */
async function toDataUrl(uri: string, mimeType: string): Promise<string> {
  try {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    const base64 = await file.base64();
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return uri;
  }
}

/**
 * Shared provider for prompt text and attachment state.
 */
export function PromptInputProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const [files, setFilesRaw] = useState<PromptInputFile[]>([]);

  const setFiles = useCallback(
    (updater: (current: PromptInputFile[]) => PromptInputFile[]) => {
      setFilesRaw((current) => updater(current));
    },
    []
  );

  const clearText = useCallback(() => {
    setText("");
  }, []);

  const clearFiles = useCallback(() => {
    setFilesRaw([]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFilesRaw((current) => current.filter((file) => file.id !== id));
  }, []);

  const appendFileParts = useCallback((newParts: PromptInputFile[]) => {
    if (newParts.length === 0) {
      return;
    }
    setFilesRaw((current) => [...current, ...newParts]);
  }, []);

  const openImagePicker = useCallback(async () => {
    let imagePickerModule: typeof import("expo-image-picker");
    try {
      imagePickerModule = await import("expo-image-picker");
    } catch {
      // The module might not be available in the current runtime/client.
      return;
    }

    const result = await imagePickerModule.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: true,
      quality: 0.9,
    });

    if (result.canceled) {
      return;
    }

    const fileParts = await Promise.all(
      result.assets.map(async (asset) => {
        const mediaType = asset.mimeType ?? "image/jpeg";
        const url = await toDataUrl(asset.uri, mediaType);
        return {
          id: uuidv7(),
          type: "file" as const,
          mediaType,
          filename: asset.fileName ?? "image.jpg",
          url,
        };
      })
    );

    appendFileParts(fileParts);
  }, [appendFileParts]);

  const openDocumentPicker = useCallback(async () => {
    let documentPickerModule: typeof import("expo-document-picker");
    try {
      documentPickerModule = await import("expo-document-picker");
    } catch {
      // The module might not be available in the current runtime/client.
      return;
    }

    const result = await documentPickerModule.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      return;
    }

    const fileParts = await Promise.all(
      result.assets.map(async (asset) => {
        const mediaType = asset.mimeType ?? "application/octet-stream";
        const url = await toDataUrl(asset.uri, mediaType);
        return {
          id: uuidv7(),
          type: "file" as const,
          mediaType,
          filename: asset.name,
          url,
        };
      })
    );

    appendFileParts(fileParts);
  }, [appendFileParts]);

  const textValue = useMemo(
    () => ({ text, setText, clearText }),
    [clearText, text]
  );

  const attachmentsValue = useMemo(
    () => ({
      files,
      setFiles,
      clearFiles,
      removeFile,
      openImagePicker,
      openDocumentPicker,
    }),
    [
      clearFiles,
      files,
      openDocumentPicker,
      openImagePicker,
      removeFile,
      setFiles,
    ]
  );

  return (
    <PromptInputTextContext.Provider value={textValue}>
      <PromptInputAttachmentsContext.Provider value={attachmentsValue}>
        {children}
      </PromptInputAttachmentsContext.Provider>
    </PromptInputTextContext.Provider>
  );
}

interface PromptInputProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onSubmit?: (input: {
    text: string;
    files: FileUIPart[];
  }) => void | Promise<void>;
}

/**
 * Prompt input shell that binds submit behavior for all sub-components.
 */
export function PromptInput({
  children,
  onSubmit,
  disabled,
  className,
}: PromptInputProps) {
  return (
    <PromptInputSubmitContext.Provider value={{ onSubmit, disabled }}>
      <View
        className={cn("w-full rounded-2xl border border-border p-2", className)}
      >
        {children}
      </View>
    </PromptInputSubmitContext.Provider>
  );
}

/**
 * Accessor used by attachment preview components.
 */
export function usePromptInputAttachments() {
  const context = useAttachmentsContext();
  return {
    files: context.files,
    remove: context.removeFile,
    clear: context.clearFiles,
    openImagePicker: context.openImagePicker,
    openDocumentPicker: context.openDocumentPicker,
    setFiles: context.setFiles,
  };
}

/**
 * Optional header slot for attachment previews and metadata.
 */
export function PromptInputHeader({ children }: { children: ReactNode }) {
  return <View className="mb-2">{children}</View>;
}

/**
 * Main textarea body slot.
 */
export function PromptInputBody({ children }: { children: ReactNode }) {
  return <View>{children}</View>;
}

/**
 * Footer slot for tools and submit actions.
 */
export function PromptInputFooter({ children }: { children: ReactNode }) {
  return (
    <View className="mt-2 flex-row items-center justify-between">
      {children}
    </View>
  );
}

/**
 * Tool group slot in prompt footer.
 */
export function PromptInputTools({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn("flex-row items-center gap-2", className)}>
      {children}
    </View>
  );
}

/**
 * Textarea bound to prompt input text state.
 */
export function PromptInputTextarea({
  disabled,
  placeholder,
  rows = 3,
  className,
}: {
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const { text, setText } = useTextContext();
  const borderColor = useColor("border");
  const cardColor = useColor("card");
  const textColor = useColor("text");
  const mutedTextColor = useColor("textMuted");
  const baseLineHeight = 20;
  const fontSize = 16;
  const horizontalPadding = 24;
  const averageCharacterWidth = fontSize * 0.55;
  const minInputHeight = Math.max(baseLineHeight, rows * baseLineHeight);
  const maxInputHeight = 140;
  const [inputHeight, setInputHeight] = useState(minInputHeight);
  const [inputContainerWidth, setInputContainerWidth] = useState(0);
  const clampHeight = (nextHeight: number) =>
    Math.min(maxInputHeight, Math.max(minInputHeight, Math.ceil(nextHeight)));

  const estimateLineCount = (value: string) => {
    if (value.length === 0) {
      return rows;
    }

    const usableWidth = Math.max(1, inputContainerWidth - horizontalPadding);
    const charsPerLine = Math.max(
      1,
      Math.floor(usableWidth / averageCharacterWidth)
    );

    return value
      .split(NEWLINE_PATTERN)
      .reduce(
        (count, segment) =>
          count + Math.max(1, Math.ceil(segment.length / charsPerLine)),
        0
      );
  };

  useEffect(() => {
    if (text.length === 0) {
      setInputHeight(minInputHeight);
    }
  }, [text, minInputHeight]);

  return (
    <View
      className={cn("rounded-xl border px-3 py-2", className)}
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        setInputContainerWidth((currentWidth) =>
          nextWidth > 0 && nextWidth !== currentWidth ? nextWidth : currentWidth
        );
      }}
      style={{ backgroundColor: cardColor, borderColor }}
    >
      <TextInput
        editable={!disabled}
        multiline
        numberOfLines={rows}
        onChangeText={(nextText) => {
          setText(nextText);
          // Fallback autosize path for wrapped typing when contentSize events lag.
          const estimatedHeight = clampHeight(
            estimateLineCount(nextText) * baseLineHeight
          );
          setInputHeight(estimatedHeight);
        }}
        onContentSizeChange={(event) => {
          // Primary autosize path: follow measured content height precisely.
          const nextHeight = clampHeight(event.nativeEvent.contentSize.height);
          setInputHeight((current) =>
            Math.abs(current - nextHeight) > 1 ? nextHeight : current
          );
        }}
        placeholder={placeholder}
        placeholderTextColor={mutedTextColor}
        scrollEnabled={inputHeight >= maxInputHeight}
        style={{
          color: textColor,
          fontSize,
          lineHeight: baseLineHeight,
          height: inputHeight,
          textAlignVertical: "top",
          paddingVertical: 0,
        }}
        value={text}
      />
    </View>
  );
}

/**
 * Generic icon-first prompt action button.
 */
export function PromptInputButton({
  children,
  onPress,
  disabled,
  className,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  className?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      className={cn(
        "h-10 min-w-10 items-center justify-center rounded-full border border-border px-2",
        disabled ? "opacity-50" : "",
        className
      )}
      disabled={disabled}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

/**
 * Submit/stop button that integrates with useChat status.
 */
export function PromptInputSubmit({
  status,
  onStop,
  disabled,
}: {
  status: ChatStatus;
  onStop: () => void;
  disabled?: boolean;
}) {
  const { text, clearText } = useTextContext();
  const { files, clearFiles } = useAttachmentsContext();
  const { onSubmit, disabled: submitDisabled } = useSubmitContext();

  const isStreaming = status === "submitted" || status === "streaming";
  const isDisabled = disabled || submitDisabled;
  const iconColor = useColor(isStreaming ? "destructive" : "text");

  const handleSubmit = () => {
    if (!onSubmit) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0 && files.length === 0) {
      return;
    }
    Promise.resolve(onSubmit({ text: trimmed, files })).catch(() => undefined);
    clearText();
    clearFiles();
  };

  return (
    <PromptInputButton
      accessibilityLabel={isStreaming ? "Stop response" : "Send message"}
      className={cn(
        isStreaming ? "border-destructive/40 bg-destructive/10" : ""
      )}
      disabled={isDisabled}
      onPress={isStreaming ? onStop : handleSubmit}
    >
      {isStreaming ? (
        <Square color={iconColor} size={16} />
      ) : (
        <SendHorizontal color={iconColor} size={16} />
      )}
    </PromptInputButton>
  );
}

/**
 * Menu wrapper used for compact attachment actions.
 */
export function PromptInputActionMenu({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const contextValue = useMemo(() => ({ isOpen, setIsOpen }), [isOpen]);

  return (
    <PromptInputActionMenuContext.Provider value={contextValue}>
      <View>{children}</View>
    </PromptInputActionMenuContext.Provider>
  );
}

/**
 * Toggle button that opens attachment action items.
 */
export function PromptInputActionMenuTrigger({
  disabled,
}: {
  disabled?: boolean;
}) {
  const { isOpen, setIsOpen } = useActionMenuContext();

  return (
    <PromptInputButton
      accessibilityLabel="Attachment actions"
      disabled={disabled}
      onPress={() => setIsOpen(!isOpen)}
    >
      <Plus size={14} />
    </PromptInputButton>
  );
}

/**
 * Collapsible action area for attachment picker options.
 */
export function PromptInputActionMenuContent({
  children,
}: {
  children: ReactNode;
}) {
  const { isOpen } = useActionMenuContext();
  if (!isOpen) {
    return null;
  }
  return <View className="mt-2 flex-row items-center gap-2">{children}</View>;
}

/**
 * Attachment action buttons for image and document picking.
 */
export function PromptInputActionAddAttachments() {
  const { openDocumentPicker, openImagePicker } = useAttachmentsContext();
  const { setIsOpen } = useActionMenuContext();

  return (
    <>
      <PromptInputButton
        accessibilityLabel="Add image attachments"
        onPress={() => {
          setIsOpen(false);
          openImagePicker().catch(() => undefined);
        }}
      >
        <ImageIcon size={14} />
      </PromptInputButton>
      <PromptInputButton
        accessibilityLabel="Add file attachments"
        onPress={() => {
          setIsOpen(false);
          openDocumentPicker().catch(() => undefined);
        }}
      >
        <FileText size={14} />
      </PromptInputButton>
    </>
  );
}
