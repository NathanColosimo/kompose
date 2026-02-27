import type {
  DynamicToolUIPart,
  FileUIPart,
  SourceDocumentUIPart,
  ToolUIPart,
  UIMessage,
} from "ai";
import { isToolUIPart } from "ai";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type AttachmentData =
  | (FileUIPart & { id: string })
  | (SourceDocumentUIPart & { id: string });

export type MessageSegment =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; part: ToolPart };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function formatToolName(type: string): string {
  return type
    .replace(/^tool-/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// AI SDK message helpers
// ---------------------------------------------------------------------------

export function normalizeMessageRole(
  role: string
): Extract<UIMessage["role"], "assistant" | "system" | "user"> {
  if (role === "assistant" || role === "system" || role === "user") {
    return role;
  }
  return "assistant";
}

/**
 * Convert persisted DB rows into AI SDK UI messages for hydration.
 */
export function toUiMessage(row: {
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
 * Pull text from message parts for token estimation and title fallbacks.
 */
export function extractText(parts: UIMessage["parts"]): string {
  return parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

/**
 * Walk parts in order and group consecutive text/reasoning into segments,
 * breaking at tool boundaries so COT + tool + COT renders correctly.
 */
export function buildMessageSegments(
  parts: UIMessage["parts"]
): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let pendingReasoning: string | null = null;
  let pendingText = "";

  const flushReasoning = () => {
    if (pendingReasoning !== null) {
      segments.push({ kind: "reasoning", text: pendingReasoning });
      pendingReasoning = null;
    }
  };
  const flushText = () => {
    if (pendingText.length > 0) {
      segments.push({ kind: "text", text: pendingText });
      pendingText = "";
    }
  };

  for (const part of parts) {
    if (part.type === "reasoning") {
      flushText();
      if (pendingReasoning === null) {
        pendingReasoning = "";
      }
      const text = isRecord(part) ? (asString(part.text) ?? "") : "";
      if (text.length > 0) {
        pendingReasoning += (pendingReasoning.length > 0 ? "\n" : "") + text;
      }
    } else if (part.type === "text") {
      const t = part.text?.trim() ?? "";
      if (t.length > 0) {
        pendingText += (pendingText.length > 0 ? "\n" : "") + part.text;
      }
    } else if (isToolUIPart(part)) {
      flushReasoning();
      flushText();
      segments.push({ kind: "tool", part: part as ToolPart });
    }
  }

  flushReasoning();
  flushText();
  return segments;
}

/**
 * Extract file and source-document attachments from message parts.
 */
export function extractAttachments(
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
