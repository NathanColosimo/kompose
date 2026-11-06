# Link Parsing

Server-side metadata extraction for URLs attached to tasks. Detects the content provider, fetches structured metadata via APIs, and auto-fills task fields (title, duration, description).

## How it works

1. User pastes one or more URLs into the command bar input, web task edit popover (including the calendar creation Task tab), or mobile task editor sheet.
2. `useLinkMetadata` observes one TanStack Query per URL (`["link-meta", url]`) and calls `tasks.parseLink` with the query abort signal. Successful metadata is shared in the in-memory query cache; saved metadata seeds the cache. Placeholder links are fetched.
3. `LinkParserService` detects the provider from URL patterns and dispatches to the matching provider parser.
4. Provider parser fetches metadata (via API or scraping), validates the response with Zod, and returns a `LinkMeta` object.
5. When metadata arrives, the client checks the **current** draft. Only a URL still present as its first link may auto-fill fields; closed editors and inactive creation tabs do not apply results.
   - **Title** — from `meta.title` (only if the task title is empty and the user has not edited it)
   - **Duration** — from `meta.durationSeconds` (only if no explicit duration was set). Existing task durations and calendar-selected or transferred durations are explicit. Editing a field, even back to its default, prevents later metadata from overwriting it.
6. Queries do not automatically retry a failed request. Errors end the pending state; removing and re-adding a failed URL starts a new attempt. Removing the last observer aborts an outstanding request.
7. All parsed links are stored in the task's `links` JSONB array and displayed in the UI.

## Provider detection

`detectProvider(url)` in `detect.ts` checks URL patterns in this order:

| Check | Result |
|-------|--------|
| `open.spotify.com/(track\|episode\|show\|album)/` | `spotify` |
| `youtube.com/watch`, `youtu.be/`, `youtube.com/shorts/` | `youtube` |
| `*.substack.com/` | `substack` |
| `substack.com/inbox/post/` | `substack` |
| `substack.com/home/post/p-{id}` | `substack` |
| Hostname in `SUBSTACK_CUSTOM_DOMAINS` list | `substack` |
| URL has `post_id` query param | `substack` |
| Everything else | `unknown` |

### Substack custom domains

Substack publications can use custom domains (e.g. `blog.ai-futures.org`). Two strategies handle this:

1. **Query param auto-detection** — Substack email/share links always include `post_id` in the query string. Any URL with a `post_id` param is treated as Substack with zero config.
2. **Known domains list** — `SUBSTACK_CUSTOM_DOMAINS` in `detect.ts` for direct visits without query params. Add new hostnames as needed.

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

The `LinkParserService` validates target URLs before fetching:

- Only `http://` and `https://` schemes are allowed.
- Hostnames are resolved via DNS; any address in private/reserved ranges (RFC 1918, loopback, link-local, IPv6 private) is rejected.

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
- New URLs are parsed after a 500ms debounce. Metadata and pending/error state come from the per-URL queries; editing unrelated input does not restart the debounce. Removed URLs stop being observed immediately.
- Auto-fill (title, duration) uses the **first** link's metadata only
- On creation, all parsed metadata is assembled into a `links: LinkMeta[]` array via `dedupeLinks`; unparsed URLs fall back to `unknown` provider
- Each link is displayed as a separate badge showing its provider name

### Web task edit popover

- Multi-link UI: `LinkListEditor` component receives clean callbacks (`onAddLink`, `onRemoveLink`) instead of form internals
- Existing links are shown as `LinkMetaPreview` cards (with `next/image` for thumbnails) with remove buttons
- An "Add link" input at the bottom accepts new URLs via paste, blur, or Enter; duplicate URLs are rejected
- The parent `TaskEditForm` observes link metadata queries, enriches current placeholders, guards auto-fill using field provenance, and deduplicates via `dedupeLinks`. The calendar creation popover observes metadata only while its Task tab is active.
- Each link card is clickable to open the URL in a new tab

### Mobile task editor sheet

- Multi-link UI via `NativeLinkListEditor` component (extracted to reduce `TaskEditorSheet` complexity)
- Receives clean callbacks (`onAddLink`, `onRemoveLink`, `onLinkInputChange`)
- "Add link" input at the bottom; adding a URL on blur observes its metadata query; duplicate URLs are rejected
- The parent observes metadata only while the sheet is visible and applies results to the current draft. Field provenance lives in that draft, so closing task A and opening task B cannot carry A's auto-fill into B. Links are deduplicated via `dedupeLinks`.
- `canSave` allows saving with just links (no title required)

## Files

| File | Purpose |
|------|---------|
| `packages/db/src/schema/link.ts` | `linkMetaSchema` Zod discriminated union, `LinkMeta` type |
| `packages/db/src/schema/task.ts` | `links` JSONB array column definition, task Zod schemas |
| `packages/api/src/services/link-parser/service.ts` | `LinkParserService` Effect service |
| `packages/api/src/services/link-parser/types.ts` | `LinkProvider` type alias, `LinkParseError` |
| `packages/api/src/services/link-parser/providers/detect.ts` | URL pattern matching, `SUBSTACK_CUSTOM_DOMAINS` |
| `packages/api/src/services/link-parser/providers/spotify.ts` | Spotify client credentials + metadata fetch |
| `packages/api/src/services/link-parser/providers/youtube.ts` | YouTube Data API v3 metadata fetch |
| `packages/api/src/services/link-parser/providers/substack.ts` | Substack archive/by-id API + reading time estimate |
| `packages/api/src/services/link-parser/providers/unknown.ts` | OG meta tag fallback |
| `packages/api/src/routers/task/contract.ts` | `parseLink` oRPC procedure contract |
| `packages/api/src/routers/task/router.ts` | `parseLink` handler |
| `packages/state/src/link-meta-utils.ts` | Shared formatting, deduplication, and validation helpers |
| `packages/state/src/hooks/use-link-metadata.ts` | Shared per-URL metadata query hook |
| `packages/state/src/link-metadata.ts` | Query options and current-draft auto-fill guards |
| `packages/state/src/link-metadata.test.ts` | Query concurrency, retry, cancellation, and auto-fill regression tests |
| `packages/env/src/index.ts` | Optional `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY` |
| `apps/web/src/lib/task-input-parser.ts` | URL extraction from command bar input |
| `apps/web/src/components/command-bar/command-bar-create-task.tsx` | Link-aware task creation flow |
| `apps/web/src/components/task-form/task-edit-popover.tsx` | Link input + `LinkMetaPreview` |
| `apps/native/components/tasks/task-editor-sheet.tsx` | Mobile link input + preview |
