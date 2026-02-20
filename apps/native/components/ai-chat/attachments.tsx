import type { FileUIPart, SourceDocumentUIPart } from "ai";
import {
  FileText,
  Globe,
  ImageIcon,
  Music2,
  Paperclip,
  Video,
  X,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { Image, Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { cn } from "@/lib/utils";

export type AttachmentData =
  | (FileUIPart & { id: string })
  | (SourceDocumentUIPart & { id: string });

type AttachmentMediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "source"
  | "unknown";

type AttachmentVariant = "grid" | "inline" | "list";

const AttachmentContext = createContext<{
  data: AttachmentData;
  mediaCategory: AttachmentMediaCategory;
  onRemove?: () => void;
  variant: AttachmentVariant;
} | null>(null);

const AttachmentsContext = createContext<{ variant: AttachmentVariant } | null>(
  null
);

function useAttachmentContext() {
  const context = useContext(AttachmentContext);
  if (!context) {
    throw new Error("Attachment components must be used inside <Attachment>.");
  }
  return context;
}

function useAttachmentsContext() {
  return useContext(AttachmentsContext) ?? { variant: "grid" as const };
}

function getMediaCategory(data: AttachmentData): AttachmentMediaCategory {
  if (data.type === "source-document") {
    return "source";
  }

  const mediaType = data.mediaType ?? "";
  if (mediaType.startsWith("image/")) {
    return "image";
  }
  if (mediaType.startsWith("video/")) {
    return "video";
  }
  if (mediaType.startsWith("audio/")) {
    return "audio";
  }
  if (mediaType.startsWith("application/") || mediaType.startsWith("text/")) {
    return "document";
  }
  return "unknown";
}

function getAttachmentLabel(data: AttachmentData) {
  if (data.type === "source-document") {
    return data.title || data.filename || "Source";
  }
  return data.filename || "Attachment";
}

function getMediaIcon(category: AttachmentMediaCategory) {
  switch (category) {
    case "image":
      return ImageIcon;
    case "video":
      return Video;
    case "audio":
      return Music2;
    case "document":
      return FileText;
    case "source":
      return Globe;
    default:
      return Paperclip;
  }
}

interface AttachmentsProps {
  children: ReactNode;
  className?: string;
  variant?: AttachmentVariant;
}

/**
 * Container for attachment chips/previews.
 */
export function Attachments({
  children,
  variant = "grid",
  className,
}: AttachmentsProps) {
  const contextValue = useMemo(() => ({ variant }), [variant]);
  return (
    <AttachmentsContext.Provider value={contextValue}>
      <View
        className={cn(
          "flex-row flex-wrap items-start gap-2",
          variant === "list" ? "w-full flex-col" : "",
          className
        )}
      >
        {children}
      </View>
    </AttachmentsContext.Provider>
  );
}

interface AttachmentProps {
  children: ReactNode;
  className?: string;
  data: AttachmentData;
  onRemove?: () => void;
}

/**
 * Single attachment entry with shared context for sub-components.
 */
export function Attachment({
  data,
  children,
  onRemove,
  className,
}: AttachmentProps) {
  const { variant } = useAttachmentsContext();
  const mediaCategory = getMediaCategory(data);
  const contextValue = useMemo(
    () => ({ data, mediaCategory, onRemove, variant }),
    [data, mediaCategory, onRemove, variant]
  );

  return (
    <AttachmentContext.Provider value={contextValue}>
      <View
        className={cn(
          "relative overflow-hidden rounded-xl border border-border bg-card",
          variant === "grid" ? "h-20 w-20" : "",
          variant === "inline" ? "h-8 flex-row items-center px-2" : "",
          variant === "list" ? "w-full flex-row items-center gap-3 p-3" : "",
          className
        )}
      >
        {children}
      </View>
    </AttachmentContext.Provider>
  );
}

/**
 * Preview block for attachment media or fallback icon.
 */
export function AttachmentPreview() {
  const { data, mediaCategory, variant } = useAttachmentContext();
  const Icon = getMediaIcon(mediaCategory);

  if (mediaCategory === "image" && data.type === "file" && data.url) {
    return (
      <Image
        source={{ uri: data.url }}
        style={
          variant === "grid"
            ? { height: "100%", width: "100%" }
            : { height: 20, width: 20, borderRadius: 6 }
        }
      />
    );
  }

  return (
    <View
      className={cn(
        "items-center justify-center",
        variant === "grid" ? "h-full w-full" : "h-5 w-5"
      )}
    >
      <Icon size={14} />
    </View>
  );
}

/**
 * Text metadata for an attachment.
 */
export function AttachmentInfo() {
  const { data, variant } = useAttachmentContext();
  if (variant === "grid") {
    return null;
  }

  return (
    <Text className="max-w-[180px] flex-1" numberOfLines={1} variant="caption">
      {getAttachmentLabel(data)}
    </Text>
  );
}

/**
 * Remove affordance for composer attachments.
 */
export function AttachmentRemove() {
  const { onRemove } = useAttachmentContext();
  if (!onRemove) {
    return null;
  }

  return (
    <Pressable
      accessibilityLabel="Remove attachment"
      className="h-5 w-5 items-center justify-center rounded-full bg-background/80"
      onPress={onRemove}
    >
      <X size={12} />
    </Pressable>
  );
}
