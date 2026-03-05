import type {
  DynamicToolUIPart,
  FileUIPart,
  SourceDocumentUIPart,
  ToolUIPart,
  UIMessage,
} from "ai";
import { isToolUIPart } from "ai";

const TOOL_PREFIX_RE = /^tool-/;
const UNDERSCORE_RE = /_/g;
const WORD_BOUNDARY_RE = /\b\w/g;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type AttachmentData =
  | (FileUIPart & { id: string })
  | (SourceDocumentUIPart & { id: string });

export type MessageSegment =
  | { id: string; kind: "reasoning"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "tool"; part: ToolPart };

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
    .replace(TOOL_PREFIX_RE, "")
    .replace(UNDERSCORE_RE, " ")
    .replace(WORD_BOUNDARY_RE, (c) => c.toUpperCase());
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

// ---------------------------------------------------------------------------
// buildMessageSegments helpers
// ---------------------------------------------------------------------------

interface SegmentAccumulator {
  counter: number;
  pendingReasoning: string | null;
  pendingText: string;
  segments: MessageSegment[];
}

function flushReasoning(acc: SegmentAccumulator): void {
  if (acc.pendingReasoning !== null) {
    acc.segments.push({
      id: `reasoning-${acc.counter++}`,
      kind: "reasoning",
      text: acc.pendingReasoning,
    });
    acc.pendingReasoning = null;
  }
}

function flushText(acc: SegmentAccumulator): void {
  if (acc.pendingText.length > 0) {
    acc.segments.push({
      id: `text-${acc.counter++}`,
      kind: "text",
      text: acc.pendingText,
    });
    acc.pendingText = "";
  }
}

function handleReasoningPart(
  part: UIMessage["parts"][number],
  acc: SegmentAccumulator
): void {
  flushText(acc);
  if (acc.pendingReasoning === null) {
    acc.pendingReasoning = "";
  }
  const record = isRecord(part) ? (part as Record<string, unknown>) : null;
  const text = record ? (asString(record.text) ?? "") : "";
  if (text.length > 0) {
    acc.pendingReasoning +=
      (acc.pendingReasoning.length > 0 ? "\n" : "") + text;
  }
}

function handleTextPart(
  part: Extract<UIMessage["parts"][number], { type: "text" }>,
  acc: SegmentAccumulator
): void {
  const t = part.text?.trim() ?? "";
  if (t.length > 0) {
    acc.pendingText += (acc.pendingText.length > 0 ? "\n" : "") + part.text;
  }
}

function handleToolPart(
  part: UIMessage["parts"][number],
  acc: SegmentAccumulator
): void {
  flushReasoning(acc);
  flushText(acc);
  const toolId =
    "toolCallId" in part ? part.toolCallId : `tool-${acc.counter++}`;
  acc.segments.push({ id: toolId, kind: "tool", part: part as ToolPart });
}

/**
 * Walk parts in order and group consecutive text/reasoning into segments,
 * breaking at tool boundaries so COT + tool + COT renders correctly.
 */
export function buildMessageSegments(
  parts: UIMessage["parts"]
): MessageSegment[] {
  const acc: SegmentAccumulator = {
    segments: [],
    pendingReasoning: null,
    pendingText: "",
    counter: 0,
  };

  for (const part of parts) {
    if (part.type === "reasoning") {
      handleReasoningPart(part, acc);
    } else if (part.type === "text") {
      handleTextPart(part, acc);
    } else if (isToolUIPart(part)) {
      handleToolPart(part, acc);
    }
  }

  flushReasoning(acc);
  flushText(acc);
  return acc.segments;
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
