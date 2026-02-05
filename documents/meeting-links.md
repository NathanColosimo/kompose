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

Provider detection is based on the hostname:
- Google Meet: `meet.google.com`
- Zoom: `*.zoom.us`, `zoom.us`, `zoom.com`
- Microsoft Teams: `teams.microsoft.com`
- Webex: `*.webex.com`, `webex.com`
- Otherwise: `other`

Selection priority (first available wins):
1. Google Meet
2. Zoom
3. Microsoft Teams
4. Webex
5. Other

Return shape:
- `url`
- `provider`
- `label` (human-readable provider name)

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

