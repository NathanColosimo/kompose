import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { uuidv7 } from "uuidv7";

export interface MeetingLink {
  /** e.g. "Zoom", or "Meeting link" when no rule matches the host */
  label: string;
  url: string;
}

/** A URL on one of these hosts is a meeting link. */
interface MeetingRule {
  /** A host starting with "." matches its subdomains instead. */
  hosts: readonly string[];
  /** Shown on the join button. */
  label: string;
}

/** Earlier rules win when an event has several links. */
const MEETING_RULES: readonly MeetingRule[] = [
  { hosts: ["meet.google.com"], label: "Google Meet" },
  { hosts: ["zoom.us", "zoom.com", ".zoom.us"], label: "Zoom" },
  { hosts: ["teams.microsoft.com"], label: "Microsoft Teams" },
  { hosts: ["webex.com", ".webex.com"], label: "Webex" },
];
const OTHER_MEETING = MEETING_RULES.length;

/** The index of the rule matching this host, or `OTHER_MEETING`. */
function ruleIndex(hostname: string): number {
  const host = hostname.toLowerCase();
  const index = MEETING_RULES.findIndex((rule) =>
    rule.hosts.some((ruleHost) =>
      ruleHost.startsWith(".") ? host.endsWith(ruleHost) : host === ruleHost
    )
  );
  return index === -1 ? OTHER_MEETING : index;
}

const URL_REGEX = /https?:\/\/[^\s<>]+/gi;

function collectUrls(text?: string): string[] {
  if (!text) {
    return [];
  }
  const matches = text.match(URL_REGEX);
  if (!matches) {
    return [];
  }
  return matches.filter((match) => match.startsWith("http"));
}

export function buildGoogleMeetConferenceData(): NonNullable<
  GoogleEvent["conferenceData"]
> {
  return {
    createRequest: {
      conferenceSolutionKey: {
        type: "hangoutsMeet",
      },
      requestId: uuidv7(),
    },
  };
}

export function extractMeetingLink(
  event?: Partial<GoogleEvent> | null
): MeetingLink | null {
  if (!event) {
    return null;
  }

  const candidates: string[] = [];
  const entryPoints = event.conferenceData?.entryPoints ?? [];

  for (const entry of entryPoints) {
    if (entry?.uri?.startsWith("http")) {
      candidates.push(entry.uri);
    }
  }

  candidates.push(...collectUrls(event.location));
  candidates.push(...collectUrls(event.description));

  const seen = new Set<string>();
  const uniqueCandidates = candidates
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  const parsed = uniqueCandidates.flatMap((value) => {
    try {
      return [{ rule: ruleIndex(new URL(value).hostname), url: value }];
    } catch {
      return [];
    }
  });

  // Prefer recognized providers in rule order; stable for ties.
  const [chosen] = parsed.sort((a, b) => a.rule - b.rule);
  if (!chosen) {
    return null;
  }

  return {
    label: MEETING_RULES[chosen.rule]?.label ?? "Meeting link",
    url: chosen.url,
  };
}
