# Plugins (design draft)

Status: agreed design, not built yet. This records the decisions so the plugin stack can be built against them. Update it as each layer lands.

Integrations (Google Calendar, WHOOP, link parsing, place search, meeting links, later Outlook, Apple Calendar, Apple Health) become plugins. Every plugin is built into the app; nothing is loaded at runtime.

## Concepts

- **Capability**: a job Kompose's own code knows how to ask for, with a fixed input and output. The calendar view asks the `calendar` capability for events; it never calls Google directly.
- **Plugin**: a package that does one or more capabilities. The Google Calendar plugin does `calendar` and `conferencing`; a future Outlook plugin does `calendar` too and shows up with no UI changes.

v1 capabilities:

| Capability | Plugins | Job |
| --- | --- | --- |
| `calendar` | Google Calendar (later Outlook, Apple) | Calendars and events, read and write |
| `day-metrics` | WHOOP (later Apple Health) | Daily numbers, header stats, past activities |
| `link-resolver` | Spotify, YouTube, Substack, ... | URL to link metadata |
| `places` | Google Places | Location search |
| `meeting-links` | Built-in rules | Recognize meeting URLs in events |
| `conferencing` | Google Calendar (calendar-native); later Zoom (standalone) | Create a meeting for an event |

## Packages

```
packages/plugins/<id>/
  manifest.ts   shared everywhere
  server.ts     Effect services, sync, webhook handler
  web.tsx       escape-hatch components only
  native.tsx    escape-hatch components only
packages/plugins/index.ts   the list of plugins (@kompose/plugins)
```

The list imports manifests eagerly and server code lazily (`server: () => import(...)`), so the webhook route doesn't load every plugin on a cold start.

## Manifest

One typed object per plugin:

- `id`, `name`, `icon` (lucide name or an SVG string for brand logos)
- `capabilities`
- `connection`: `{ kind: "oauth", provider }`, `{ kind: "credentials" }` (e.g. iCloud app-specific password), `{ kind: "server-key" }`, `{ kind: "none" }`, or `{ kind: "device" }` (pushed from the phone)
- `retention` per table it writes
- `settings`: a zod schema plus defaults; core renders the settings form
- `realtime`: `"webhook"`, `"poll-on-read"`, or `"device-push"`
- display hints (which metrics the day header shows, icons per activity kind)

## Server side

- Each capability is a typed Effect service, e.g. `CalendarProvider` with `listEvents`, `createEvent`, ...
- Each capability has a fixed set of tagged errors: `ProviderAuthExpired`, `ProviderRateLimited`, `ProviderUnavailable`, `NotFound`. Core maps that fixed set to oRPC errors.
- Apps call shared capability APIs (`calendar.events.list({ start, end })` fans out to every connected calendar). Screens only display what is in the standard tables.
- A plugin may also expose `plugins.<id>.*` procedures, but only its own escape-hatch components may call them.
- Edits go to the provider first; the mirror row is updated from the provider's response. Local-first two-way sync can come later with offline SQLite.

## Connections

One `connection` table for every plugin: `id`, `userId`, `pluginId`, `kind`, `accountId?` (Better Auth `account` row for OAuth), encrypted credentials, `status` (`active` / `needs-reauth`), `lastSyncedAt`. A user can connect several accounts per plugin. A migration creates rows for existing Google and WHOOP accounts.

`plugin_settings(userId, pluginId, settings jsonb)` holds each user's settings, validated by the manifest schema. Plugins with no connection get an on/off switch.

Tokens:

- Turn on `account.encryptOAuthTokens` with `BETTER_AUTH_SECRETS`, and migrate existing plaintext tokens.
- Encrypt app-specific passwords with `symmetricEncrypt` from `better-auth/crypto`, using the same keys.
- Callers keep using `auth.api.getAccessToken`. The WHOOP hook in `packages/auth/src/whoop.ts` becomes one hook for every OAuth plugin: each manifest supplies its refresh call, the hook refreshes under a row lock (Microsoft and WHOOP rotate refresh tokens), and `invalid_grant` sets `connection.status = "needs-reauth"` so Settings shows Reconnect. Better Auth's own refresh has no lock and hides the provider's error.

## Standard tables

Drizzle tables with zod validators from `drizzle-zod`. Every mirrored row has a Kompose `uuidv7` ID, a unique `(connectionId, externalId)`, and `providerData` jsonb that only the owning plugin reads (for writing back without losing fields, e.g. the raw iCalendar text and ETag for CalDAV).

### `calendar`

`id`, `userId`, `connectionId`, `pluginId`, `externalId`, `name`, `color`, `isPrimary`, `canEdit`, `visible` (moves out of local storage), `syncCursor`, `providerData`.

### `calendar_event`

- `id`, `calendarId`, `externalId`
- `title`, `description` (sanitized HTML; plugins convert to and from their format)
- `location` (`{ text, placeId? }`)
- Timed: `startAt`, `endAt` (UTC), `timeZone`. All-day: `startDate`, `endDate`, `allDay: true`.
- `status`: `confirmed` / `tentative` / `cancelled`
- `showAs`: `free` / `busy` / `tentative` / `out-of-office` / `working-elsewhere`
- `color`: hex, or null for the calendar's color. Each calendar plugin supplies the editor's color palette (Google's 11 colors, Outlook categories, none for Apple).
- `conference` (`{ url, provider }`)
- `attendees` (`[{ email, name, response, isSelf, isOrganizer }]`)
- `seriesId`, `recurrence` (RFC 5545 `RRULE` / `EXDATE` strings; the Outlook plugin converts `patternedRecurrence`), `originalStartAt`
- `canEdit`, `externalUrl`, `updatedAt`, `providerData`

Repeating events are stored as one row per occurrence inside the retention window.

### `day_metric`

`userId`, `connectionId`, `pluginId`, `date`, `metric`, `value`, `unit`, `providerData`. Kompose owns the metric names: `recovery_score`, `hrv_ms`, `resting_hr_bpm`, `sleep_duration_min`, `sleep_performance`, `strain`, `steps`, `active_kcal`, `kcal_in`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`. Plugins may add prefixed names (`whoop.respiratory_rate`). When two sources report the same metric, both are stored; a fixed plugin order picks what is shown, with a per-metric preference later.

### `day_stat`

Ready-to-draw header stats written by the plugin during sync, in the same transaction as `day_metric`: `id`, `userId`, `connectionId`, `pluginId`, `date`, `key`, `order`, `label`, `value` (display text like "82%"), `tone`, `icon`, `tooltip?`. The client draws a shared `StatChip` on web and native and computes nothing.

`tone` is meaning-based: `positive`, `warning`, `negative`, `neutral`, `accent`. Web and native map tones to theme colors. Only calendar and event colors are hex.

### `activity`

Things that happened and can't be edited (sleep, nap, workout; meals later): `id`, `userId`, `connectionId`, `pluginId`, `externalId`, `kind`, `title`, `startAt`, `endAt`, `metrics` jsonb (same metric names), `providerData`. Drawn as timed blocks and background bands.

## Retention

Per plugin, in the manifest. Defaults: calendar events from 1 year back to 2 years ahead (re-fetched on view outside that), WHOOP kept forever. Each sync deletes rows past the window.

## Sync and realtime

No cron for now. Syncs run on:

- webhooks,
- app connect (also renews Google channels and Microsoft subscriptions, then catches up with sync tokens / delta), and
- reads of missing or stale ranges (`poll-on-read`, e.g. CalDAV).

Microsoft subscriptions last about 7 days, so notifications lapse if no device opens the app for a week; the catch-up on connect covers it.

One realtime event, `{ type: "plugin-data", pluginId, capability, accountId, range? }`, replaces the per-provider events; clients refresh the matching queries. Tasks keep their own event.

### Webhooks

One route, `/api/webhooks/[pluginId]/[[...path]]`:

- Accepts `GET` and `POST` (Strava/Fitbit challenge with `GET`).
- Hands the plugin the raw `Request` (signatures are over the exact bytes) and returns the plugin's `Response` (handshakes like Microsoft's `validationToken`).
- Replies right away and syncs in `after()`; Microsoft gives up after about 3 seconds.
- Plugins choose one URL per connection (Google, Microsoft: `/api/webhooks/google-calendar/<subscriptionId>`) or one per app (WHOOP: `/api/webhooks/whoop`, identified by `user_id` in the payload).

`webhook_subscription.provider` becomes a `pluginId` text column linked to `connectionId`.

## Place search and meeting links

- `places`: `search(query)` and optional `details(placeId)`. Google Places is its own plugin using Kompose's server key, so it works without a connected Google account. The location field on web and native uses whichever `places` plugin is enabled.
- `meeting-links`: plugins contribute URL rules (host to provider, label, icon). Today's Meet/Zoom/Teams/Webex rules in `packages/state/src/meeting.ts` move into a built-in plugin.
- `conferencing`: "calendar-native" (the calendar attaches the meeting, e.g. Google Meet via `conferenceData`) or "standalone" (a plugin like Zoom returns a URL that core writes into the event). The editor's "Add meeting" menu lists what the event's calendar supports.

## Settings

A generic connections list on web and native replaces the hardcoded Google and WHOOP cards: connect, disconnect, reconnect when `needs-reauth`, and each plugin's settings form.

## Build order

1. Core: plugin list, manifest types, capability services and errors, standard tables and migrations, `connection` + `plugin_settings` (with the migration for existing accounts), token encryption and the shared refresh hook, `plugin-data` realtime event, webhook route, Settings connections list, and the `StatChip` / activity / event renderers on web and native.
2. `link-resolver` and `meeting-links` (existing parsers and rules moved over).
3. `google-places` and `conferencing`.
4. WHOOP: plugin, webhooks, `day_metric` / `day_stat` / `activity`, native support.
5. Google Calendar: plugin, mirror replacing the Redis cache, provider-first edits, editor as an escape hatch.
6. Cleanup: remove the old routers, Settings cards, the calendar merges in `days-view.tsx` and the native calendar, and the Redis caches; update `documents/`.

Later: GitHub, Microsoft and Apple calendars, Apple Health and Cronometer (device connection), cron, offline SQLite.
