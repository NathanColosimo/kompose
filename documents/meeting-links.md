# Meeting Links

## Overview
Meeting links are centralized in the shared state package so web and native popovers use the same parsing and creation logic.

Primary entry points:
- `packages/state/src/meeting.ts`

## Extracting a meeting link
`extractMeetingLink(event)` inspects:
- `event.conferenceData.entryPoints` (preferred)
- URLs found in `event.location`
- URLs found in `event.description`

Hosts come from the `MEETING_RULES` table in `meeting.ts`. A host starting with `.` matches its subdomains:
- Google Meet: `meet.google.com`
- Zoom: `zoom.us`, `zoom.com`, `.zoom.us`
- Microsoft Teams: `teams.microsoft.com`
- Webex: `webex.com`, `.webex.com`
- Any other URL: "Meeting link"

Selection priority: rule order (the list above), then unrecognized links. A new provider is one more rule; the rules move into plugin manifests when a second source of rules (say, a Zoom plugin) shows up.

Return shape:
- `url`
- `label` (the rule's label, e.g. "Zoom")

## Creating Google Meet links
`buildGoogleMeetConferenceData()` returns a `conferenceData.createRequest` payload for Google Meet, using a `uuidv7` request id.

UI behavior:
- Web popover closes immediately after “Add Google Meet” in edit mode so the save triggers and the meeting is created.
- Native popover applies the same payload and saves on tap.

## Google Calendar API details
When `conferenceData` is present, the Google Calendar client automatically sets `conferenceDataVersion=1` on create/update so the server attaches a meeting to the event.

## Where it’s used
- Web event popover: `apps/web/src/components/calendar/events/event-edit-popover.tsx`
- Native calendar modal: `apps/native/app/(tabs)/calendar.tsx`

## Desktop (Electron) behavior
- In desktop runtime, external meeting URLs are handled by the window's
  navigation handlers in `apps/electron/src/main.ts`.
- External `http/https` links are opened via Electron’s `shell.openExternal`
  so they launch in the system browser instead of being handled inside the
  app window.
- Internal same-origin links remain in-app and are not intercepted.

