# Link Parsing

Server-side metadata extraction for URLs attached to tasks. Detects the content provider, fetches structured metadata via APIs, and auto-fills task fields (title, duration, description).

## How it works

1. User pastes one or more URLs into the command bar input, web task edit popover, or mobile task editor sheet.
2. Client calls `tasks.parseLink` for each URL.
3. `LinkParserService` asks each `link-resolver` plugin in turn (`linkResolvers` in `@kompose/plugins/link-resolvers`) and uses the first whose `matches(url)` is true, or the Open Graph fallback when none does.
4. Provider parser fetches metadata (via API or scraping), validates the response with Zod, and returns a `LinkMeta` object. Resolvers fetch through `fetchJson(request, schema)` and `fetchText(request)` in `link-resolver.ts`, which turn a failed request, a non-2xx status, unreadable JSON, or a schema mismatch into a `LinkParseError`.
5. Client auto-fills task fields from the **first** link's metadata:
   - **Title** — from `meta.title` (only if the task title is empty)
   - **Duration** — from `meta.durationSeconds` (only if no explicit duration was set)
6. All parsed links are stored in the task's `links` JSONB array and displayed in the UI.

## Provider detection

Spotify, YouTube, and Substack are plugins (`packages/plugins/src/<id>/`): a manifest, and a `server.ts` exporting a `LinkResolver` (`matches`, `resolve`). They're tried in this order:

| Plugin | `matches(url)` |
|-------|--------|
| `spotify` | `open.spotify.com/(track\|episode\|show\|album)/<id>` |
| `youtube` | `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/shorts/<id>` (11-character ID) |
| `substack` | `*.substack.com`; `substack.com/inbox/post/` or `/home/post/p-`; a hostname in `SUBSTACK_CUSTOM_DOMAINS`; any URL with a `post_id` param |
| (none) | Open Graph fallback, `provider: "unknown"` |

A YouTube URL without a valid video ID falls through to Open Graph rather than failing.

### Substack custom domains

Substack publications can use custom domains (e.g. `blog.ai-futures.org`). Two strategies handle this:

1. **Query param auto-detection** — Substack email/share links always include `post_id` in the query string. Any URL with a `post_id` param is treated as Substack with zero config.
2. **Known domains list** — `SUBSTACK_CUSTOM_DOMAINS` in `packages/plugins/src/substack/server.ts` for direct visits without query params. Add new hostnames as needed.

## Providers

### Spotify

- **API**: Spotify Web API with client credentials flow (no user auth needed)
- **Env vars**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (optional — gracefully fails if not set)
- **Resources**: tracks, episodes, shows, albums (album duration = sum of track durations)
- **Metadata**: title, description, duration (from `duration_ms`), thumbnail, artist/show/publisher name
- **Response validation**: `spotifyTokenResponse` and `spotifyResourceResponse` Zod schemas

### YouTube

- **API**: YouTube Data API v3
- **Env vars**: `YOUTUBE_API_KEY` (optional — gracefully fails if not set)
- **Resources**: videos (watch, short URL, shorts)
- **Metadata**: title, description, duration (ISO 8601 → seconds), thumbnail, channel name
- **Response validation**: `youtubeVideosResponse` Zod schema

### Substack

- **API**: Substack's internal REST API (no auth needed)
- **Fetch strategies** (in priority order):
  1. `post_id` query param → `GET /api/v1/posts/by-id/{id}` (direct, most reliable)
  2. `/inbox/post/{id}` path → `GET /api/v1/posts/by-id/{id}`
  3. `/p/{slug}` path → `GET {baseUrl}/api/v1/archive?search={slug}` (archive search)
- **Metadata**: title, description, word count, cover image, estimated reading duration
- **Duration logic**: if the post has an `audio_items` entry with `type === "voiceover"`, its duration (rounded to nearest 15 minutes) overrides the word-count-based reading time estimate (238 WPM)
- **Response validation**: `postSchema` and `archiveResponseSchema` / `postByIdResponseSchema` Zod schemas

### Unknown (fallback)

- **Method**: fetches the page HTML and extracts Open Graph meta tags (`og:title`, `og:description`, `og:image`)
- **No duration** — only title, description, and thumbnail

## Schema

`LinkMeta` is a Zod discriminated union on the `provider` field, defined in `packages/db/src/schema/link.ts`. Each variant has provider-specific fields:

| Provider | Extra fields |
|----------|-------------|
| `spotify` | `resourceType`, `durationSeconds`, `artistName` |
| `youtube` | `durationSeconds`, `channelName` |
| `substack` | `durationSeconds`, `wordCount`, `authorName` |
| `unknown` | (none beyond base) |

All variants share: `provider`, `title`, `url`, `fetchedAt`, and optional `description`, `thumbnailUrl`.

Stored as a JSONB array in the `links` column on the `task` table. Each task can have zero or more links. The `url` field on each `LinkMeta` object stores the original URL.

## Deduplication

Links are deduplicated by URL at multiple layers:

- **Frontend prevention**: the add-link input in web popover, native editor, and command bar all reject a URL that already exists in the current links array.
- **Frontend build**: `dedupeLinks()` from `@kompose/state/link-meta-utils` is applied when assembling the `links` array before save/create. Later entries win when URLs collide.
- **Backend enforcement**: the task router applies `dedupeLinks` on both create and update before persisting.

## SSRF protection

Links come from users, so every fetch made while parsing one, by a resolver or the Open Graph fallback, goes through `fetchOk` in `packages/plugins/src/link-resolver.ts`:

- Only `http://` and `https://` URLs whose host passes Better Auth's `isPublicRoutableHost` (`@better-auth/core/utils/host`): no private, loopback, link-local, shared, reserved or multicast IPv4 or IPv6 literal, including IPv6 forms that embed an IPv4 address (mapped, NAT64, 6to4, Teredo), and no `localhost` or cloud metadata names.
- Redirects are followed by hand (`redirect: "manual"`), up to 5, and each `Location` gets the same check before it's fetched.
- Hostnames are resolved by `publicOnlyLookup`, the `lookup` of the undici `Agent` the fetch uses. It runs when the connection is made, with `dns.lookup(host, { all: true })` (A, AAAA and `/etc/hosts`), and fails unless every address is public. The check is on the addresses the socket connects to, so DNS rebinding between a check and the connect isn't possible. Node only; Bun's fetch ignores the dispatcher, but the app runs on Node.

`link-resolver.test.ts` covers the lookup and the redirect checks (with a stubbed `fetch`).

## Shared utilities

`packages/state/src/link-meta-utils.ts` provides shared helpers used by both web and native:

- `getProviderLabel(provider)` — human-readable provider name (e.g. "YouTube")
- `getLinkDurationMinutes(meta)` — extracts duration from any `LinkMeta` variant
- `getLinkWordCount(meta)` — extracts word count (Substack only)
- `dedupeLinks(links)` — deduplicate by URL, last wins
- `URL_REGEX` — validation pattern for URL inputs

## Client integration

### Command bar

- `parseTaskInput()` in `task-input-parser.ts` extracts all URLs from the input text into a `links: string[]` array
- Links alone (no title text) are valid for task creation — the title comes from the first link's metadata
- All URLs are parsed after a 500ms debounce; results are tracked in a `linkMetaMap` keyed by URL
- Auto-fill (title, duration) uses the **first** link's metadata only
- On creation, all parsed metadata is assembled into a `links: LinkMeta[]` array via `dedupeLinks`; unparsed URLs fall back to `unknown` provider
- Each link is displayed as a separate badge showing its provider name

### Web task edit popover

- Multi-link UI: `LinkListEditor` component receives clean callbacks (`onAddLink`, `onRemoveLink`) instead of form internals
- Existing links are shown as `LinkMetaPreview` cards (with `next/image` for thumbnails) with remove buttons
- An "Add link" input at the bottom accepts new URLs via paste, blur, or Enter; duplicate URLs are rejected
- The parent `TaskEditForm` handles `parseLink` mutation, auto-fill, and deduplication via `dedupeLinks`
- Each link card is clickable to open the URL in a new tab

### Mobile task editor sheet

- Multi-link UI via `NativeLinkListEditor` component (extracted to reduce `TaskEditorSheet` complexity)
- Receives clean callbacks (`onAddLink`, `onRemoveLink`, `onLinkInputChange`)
- "Add link" input at the bottom; `parseLink` fires on blur; duplicate URLs are rejected
- The parent handles mutation, auto-fill (from first link), and deduplication via `dedupeLinks`
- `canSave` allows saving with just links (no title required)

## Files

| File | Purpose |
|------|---------|
| `packages/db/src/schema/link.ts` | `linkMetaSchema` Zod discriminated union, `LinkMeta` type |
| `packages/db/src/schema/task.ts` | `links` JSONB array column definition, task Zod schemas |
| `packages/api/src/services/link-parser/service.ts` | `LinkParserService` Effect service: the first matching resolver, else Open Graph |
| `packages/api/src/services/link-parser/open-graph.ts` | OG meta tag fallback |
| `packages/plugins/src/link-resolver.ts` | `LinkResolver` capability type, `LinkParseError`, SSRF-checked `fetchJson` / `fetchText`, text helpers |
| `packages/plugins/src/link-resolvers.ts` | Server-only list of resolvers, in match order |
| `packages/plugins/src/spotify/server.ts` | URL matching, Spotify client credentials + metadata fetch |
| `packages/plugins/src/youtube/server.ts` | Video ID matching, YouTube Data API v3 metadata fetch |
| `packages/plugins/src/substack/server.ts` | URL matching (`SUBSTACK_CUSTOM_DOMAINS`), Substack archive/by-id API + reading time estimate |
| `packages/api/src/routers/task/contract.ts` | `parseLink` oRPC procedure contract |
| `packages/api/src/routers/task/router.ts` | `parseLink` handler |
| `packages/state/src/link-meta-utils.ts` | Shared formatting, deduplication, and validation helpers |
| `packages/state/src/hooks/use-tasks.ts` | `parseLink` mutation hook |
| `packages/env/src/index.ts` | Optional `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY` |
| `apps/web/src/lib/task-input-parser.ts` | URL extraction from command bar input |
| `apps/web/src/components/command-bar/command-bar-create-task.tsx` | Link-aware task creation flow |
| `apps/web/src/components/task-form/task-edit-popover.tsx` | Link input + `LinkMetaPreview` |
| `apps/native/components/tasks/task-editor-sheet.tsx` | Mobile link input + preview |
