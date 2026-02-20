import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { uuidv7 } from "uuidv7";

export type MeetingProvider =
  | "google-meet"
  | "zoom"
  | "teams"
  | "webex"
  | "other";

export interface MeetingLink {
  label: string;
  provider: MeetingProvider;
  url: string;
}

const PROVIDER_LABELS: Record<MeetingProvider, string> = {
  "google-meet": "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  webex: "Webex",
  other: "Meeting link",
};

const PROVIDER_PRIORITY: MeetingProvider[] = [
  "google-meet",
  "zoom",
  "teams",
  "webex",
  "other",
];

const URL_REGEX = /https?:\/\/[^\s<>]+/gi;

function providerFromHost(hostname: string): MeetingProvider {
  const host = hostname.toLowerCase();
  if (host === "meet.google.com") {
    return "google-meet";
  }
  if (host.endsWith(".zoom.us") || host === "zoom.us" || host === "zoom.com") {
    return "zoom";
  }
  if (host === "teams.microsoft.com") {
    return "teams";
  }
  if (host.endsWith(".webex.com") || host === "webex.com") {
    return "webex";
  }
  return "other";
}

function scoreProvider(provider: MeetingProvider): number {
  const idx = PROVIDER_PRIORITY.indexOf(provider);
  return idx === -1 ? PROVIDER_PRIORITY.length : idx;
}

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
      requestId: uuidv7(),
      conferenceSolutionKey: {
        type: "hangoutsMeet",
      },
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

  const parsed = uniqueCandidates
    .map((value) => {
      try {
        const url = new URL(value);
        const provider = providerFromHost(url.hostname);
        return { url: value, provider };
      } catch {
        return null;
      }
    })
    .filter((value): value is { url: string; provider: MeetingProvider } =>
      Boolean(value)
    );

  if (parsed.length === 0) {
    return null;
  }

  parsed.sort((a, b) => scoreProvider(a.provider) - scoreProvider(b.provider));
  const chosen = parsed[0];
  // Guard for TypeScript - length check above ensures this exists
  if (!chosen) {
    return null;
  }

  return {
    url: chosen.url,
    provider: chosen.provider,
    label: PROVIDER_LABELS[chosen.provider],
  };
}
