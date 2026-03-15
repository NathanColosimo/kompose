import type { LinkMeta } from "@kompose/db/schema/link";
import { Schema } from "effect";

/** Identifies which provider a URL belongs to */
export type LinkProvider = LinkMeta["provider"];

export class LinkParseError extends Schema.TaggedError<LinkParseError>()(
  "LinkParseError",
  {
    url: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

const FIFTEEN_MINUTES_SECS = 900;

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  ndash: "-",
  mdash: "--",
  quot: '"',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  hellip: "...",
};

function decodeEntity(entity: string): string {
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isNaN(codePoint)
      ? `&${entity};`
      : String.fromCodePoint(codePoint);
  }

  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isNaN(codePoint)
      ? `&${entity};`
      : String.fromCodePoint(codePoint);
  }

  return HTML_ENTITY_MAP[entity] ?? `&${entity};`;
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) =>
    decodeEntity(entity)
  );
}

function decodeOptionalString(value: string | undefined): string | undefined {
  return value ? decodeHtmlEntities(value) : value;
}

export function normalizeLinkMetaText<T extends LinkMeta>(meta: T): T {
  const normalized = {
    ...meta,
    title: decodeOptionalString(meta.title),
    description: decodeOptionalString(meta.description),
  };

  if ("artistName" in normalized) {
    normalized.artistName = decodeOptionalString(normalized.artistName);
  }
  if ("channelName" in normalized) {
    normalized.channelName = decodeOptionalString(normalized.channelName);
  }
  if ("authorName" in normalized) {
    normalized.authorName = decodeOptionalString(normalized.authorName);
  }

  return normalized;
}

/** Round seconds to the nearest 15-minute increment */
export function roundToNearest15Min(seconds: number): number {
  return Math.round(seconds / FIFTEEN_MINUTES_SECS) * FIFTEEN_MINUTES_SECS;
}
