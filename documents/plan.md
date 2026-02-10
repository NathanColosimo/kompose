# Kompose – Technical Overview & Architecture Outline

## 1. What is Kompose?

Kompose is a **calendar + task orchestration app** with:

- Calendar + tasks in one unified timeline.
- Ability to **drag tasks onto the calendar** (turn backlog items into scheduled time blocks).
- **AI assistant** that can create/update/delete events and tasks from natural language ("Block 2 hours tomorrow afternoon to work on Kompose sync engine", "Move my Linear bugfix task to Friday morning", etc.).
- Integrations with tools like **Notion**, **Linear**, etc. for auto-syncing tasks/issues.
- **Global fuzzy search** (command palette style) over:
  - Events
  - Tasks
  - Integration data (Notion pages, Linear issues, etc.)
Name: **Kompose**  
Tagline (draft): *"Compose your time, tasks, and tools into one schedule."*

---

## 2. Product Goals & Philosophy

1. **Time- and task-centric, not app-centric**
   - Users should manage their day from Kompose instead of bouncing between calendar, todo apps, Linear, Notion, etc.

2. **Natural language control via AI**
   - "Make time for X", "Reschedule that", "Show me my deep work tasks this week".
   - AI acts as a *personal ops assistant* over your schedule & tasks.

3. **Composable integrations**
   - Integrations are first-class, not one-off hacks.
   - Same internal model for "task" whether it comes from Kompose, Notion, Linear, etc.

4. **Command palette everything**
   - Fuzzy search + actions: open things, run actions, trigger AI, navigate views.

---

## 3. High-Level Architecture

### Clients

- **Web app**: Next.js (App Router, static pages + client-side data)
- **Mobile app**: Expo (React Native)

### Backend

- **HTTP API + RPC**: Next.js API routes (App Router route handlers) exposing oRPC endpoints.
- **App DB**: Postgres with Drizzle ORM.
- **Auth**: Better Auth + Drizzle (Postgres only).
- **Redis**: Caching (Google Calendar data), rate limiting, pub/sub (SSE realtime events).
- **Observability**: OpenTelemetry (server-side only) → Axiom / Jaeger. See [`otel.md`](./otel.md).
- **Background jobs**: worker(s) for sync, integrations, and AI tasks (planned).
- **Search index**: server-side search engine (e.g., Meilisearch/Typesense or Postgres FTS) (planned).

---

## 4. Tech Stack Overview

### 4.1 Frontend – Web (Next.js)

- **Framework**: Next.js (App Router)
- **Rendering**:
  - **All main pages statically generated** (SSG) at build time:
    - `/` landing (hero with feature grid)
    - `/login` (tab-based auth with Google sign-in/sign-up)
    - `/dashboard/*` (dashboard, settings, integrations)
  - Data is **fetched client-side** via TanStack Query + RPC (no SSR data dependency, good for Tauri).
- **Routing**:
  - Next.js App Router for routes.
  - Inside `/app`, use client components with TanStack Query for state/data.
- **State/Data Fetching**:
  - TanStack Query (React Query) on the client
  - oRPC client for typed RPC calls to Next API endpoints.
- **UI Layer**:
  - React + TailwindCSS (Tailwind v4 with oklch color system)
  - Typography: Libre Baskerville (serif), Lora (serif display), IBM Plex Mono (monospace)
  - Component library: shadcn/ui (Radix-based primitives).
  - Drag-and-drop: React DnD or `@dnd-kit/core` for dragging tasks onto calendar slots.
- **Layout**:
  - **Sidebar Layout**:
    - Implemented `AppSidebar` (left) and `SidebarRight` components using `shadcn/ui` sidebar primitives.
    - Dashboard layout persists across `/dashboard/*` routes using `dashboard/layout.tsx`.
    - Right sidebar contains calendar date picker and calendar lists.
    - Left sidebar contains navigation (Inbox) and task lists.
- **Auth integration**:
  - Better Auth with Google OAuth only (v1).
  - Tab-based sign-in / sign-up UI on `/login`.
  - Redirect to `/dashboard` post-auth via Better Auth callback URLs.

### 4.2 Frontend – Mobile (Expo)

- **Framework**: Expo (React Native, TypeScript)
- **Navigation**: Expo Router (file-based)
- **Data Layer**:
  - TanStack Query (React Query) for query/mutation APIs.
  - oRPC client with `RPCLink` for typed RPC calls.
  - Shared state via `packages/state/` (same Jotai atoms and hooks as web).
- **Auth**:
  - Better Auth flows through HTTP API.
  - Tokens stored securely via `expo-secure-store`.
- **AI & Commands** (planned):
  - Command palette UI with fuzzy search and action execution.
  - "Ask Kompose AI" text input that calls backend AI endpoint.

---

### 4.3 Backend – API & RPC

- **Runtime**: Bun + Next.js (App Router) route handlers.
- **RPC**:
  - **oRPC** as a TS-first RPC layer (contract-first with `oc` builder).
  - `AppRouter` (aggregated in `packages/api/src/routers/index.ts`):
    - `googleCal.calendars.{list,get,create,update,delete}`
    - `googleCal.events.{list,get,create,update,move,delete}`
    - `googleCal.colors.list`
    - `maps.search`
    - `tasks.{list,create,update,delete}`
    - `tags.{list,create,update,delete}`
    - `sync.events` (SSE stream)
- **API Routes**:
  - `/api/rpc/[[...rest]]` — oRPC catch-all handler (`RPCHandler` + `OpenAPIHandler`).
  - `/api/auth/*` — Better Auth auth flows.
  - `/api/webhooks/google-calendar` — Google Calendar push notification receiver.
- **Middleware**:
  - `requireAuth` — session validation via Better Auth.
  - `globalRateLimit` — 200 req/60s per user (Redis-backed).
  - `mapsRateLimit` — 20 req/60s per user (stacked on global for maps search).
- **Effect-TS Services**:
  - Business logic uses `Effect.Service` with `accessors: true`, `Effect.fn` for tracing, `Schema.TaggedError` for typed errors.
  - Services: `TaskService`, `TagService`, `GoogleCalendarCacheService`, `WebhookService`, `GoogleCalendarWebhookService`, `WebhookRepositoryService`.
  - See [`services.md`](./services.md) for details.

### 4.4 Backend – Database & ORM

- **Primary DB**: Postgres
- **ORM**: Drizzle ORM
- **Drizzle Single Source of Truth**:
  - Define tables in Drizzle (e.g., `packages/db/src/schema/task.ts`).
  - Use `drizzle-zod` to generate Zod schemas (`taskInsertSchema`, `taskSelectSchema`, `taskUpdateSchema`) directly from table definitions.
  - These Zod schemas are used for runtime validation in the API and type inference throughout the app.
- **Schemas**:
  - `auth` schema (Better Auth generated; Postgres-only).
  - `app` schema:
    - `eventsPG`
    - `tasksPG`
    - `calendarsPG`
    - `task_sourcesPG` (e.g., "kompose", "notion", "linear")
    - `integration_accountsPG` (per-user OAuth tokens & metadata)
    - `ai_sessionsPG` / `ai_logsPG` (optional)
### 4.5 Auth & Security

- **Auth provider**: Better Auth
  - Handles sign-in, OAuth providers, sessions, tokens.
  - Generates Drizzle schema for auth tables in Postgres.
- **Server-side**:
  - All RPC endpoints require a valid session or token.
  - `userId` extracted from auth context and injected into repository layer.
- **Client-side**:
  - Web: Next.js + Better Auth client helpers.
  - Mobile: tokens stored via `expo-secure-store`.

---

### 4.6 AI Integration (planned)

- **AI Provider**: (e.g., OpenAI API or similar, via backend only)
- **Pattern**:
  - Client calls `ai.command` with:
    - `inputText`
    - context (current time, view, maybe partial user data)
  - Backend:
    - Runs LLM with a tool-calling / structured output prompt that maps text → structured operations:
      - create/update/delete events
      - create/update/delete tasks
      - move/reschedule time blocks
    - Executes those operations by calling into the same repositories used by normal UI.
    - Returns:
      - success/failure
      - a list of changes (for UI)
- **LLM Tools / Functions**:
  - `createEvent`, `updateEvent`, `deleteEvent`
  - `createTask`, `updateTask`, `deleteTask`
  - `scheduleTask`, `rescheduleBlock`
- **Safety**:
  - Validate all AI-suggested changes before applying.
  - Optionally present a "preview" diff to the user for confirmation (especially for bulk changes).

---

### 4.7 Integrations (Notion, Linear, etc.) (planned)

- **Integration Accounts**:
  - `integration_accountsPG` with:
    - `userId`
    - `provider` ("notion", "linear", …)
    - access/refresh tokens
    - scopes, metadata
- **Sync Model**:
  - Periodic background jobs (cron or queue-based) that:
    - fetch tasks/issues from each provider
    - normalise into Kompose's internal `Task` model with `source="linear"` or `source="notion"`
  - Webhooks where possible (e.g. Linear) to reduce polling.
- **Direction**:
  - v1: **one-way import** (external → Kompose).
  - v2: Two-way sync with conflict handling.
- **User Experience**:
  - In UI, tasks show their origin (icon + label).
  - Some operations (like "close Linear issue") call provider APIs as part of the mutation.

---

### 4.8 Fuzzy Search & Command Palette (planned)

- **Search Index**:
  - Server:
    - Use Meilisearch / Typesense *or* Postgres FTS.
    - Index:
      - Events (title, description, location)
      - Tasks (title, description, source metadata)
      - Integration items (Notion pages, Linear issues)
      - Possibly AI summaries of projects.
  - Clients:
    - Input → call search RPC → results with typed objects + types.
- **Command Palette**:
  - Unified UI in all clients:
    - quick open item
    - run actions (e.g., "create task", "schedule task", "jump to date").
  - AI search:
    - free-form text goes to AI endpoint that can combine search + actions.

---

## 5. Project Structure Overview

Monorepo structure (`bun` workspaces, Turborepo):

```txt
apps/
  web/          # Next.js app (App Router, static pages + client-side data)
  native/       # Expo app (React Native)

packages/
  api/          # oRPC routers, Effect services, webhooks, realtime, telemetry, caching
  auth/         # Better Auth configuration and schema
  config/       # Shared Tailwind/TS config
  db/           # Drizzle schema and migrations (Postgres)
  env/          # t3-env schema for validated environment variables
  google-cal/   # Google Calendar API client (Effect-based, Zod schemas)
  state/        # Shared Jotai atoms, TanStack Query hooks, storage adapters (web + native)
```

Note: Desktop (Tauri) app is planned but not yet implemented.

---

## 6. Recent Implementation Updates

### 6.1 Google Calendar Integration
- **Client**: Implemented a **Google Calendar Client** using the **Effect** library (`packages/google-cal`).
  - Uses `Effect.gen` for async control flow.
  - Uses `@effect/schema` for strict runtime validation and typing of Google API responses.
  - Supports: `listCalendars`, `getCalendar`, `createCalendar`, `updateCalendar`, `deleteCalendar`, `listEvents`, `getEvent`, `createEvent`, `updateEvent`, `deleteEvent`.
  - **Schemas**: Defined strict `Calendar` and `Event` schemas matching Google's API but with cleaner types (e.g., `DateTimeUtc` for dates).
  - **Output Format**: Handlers return **Encoded** data (strings for dates) to ensure compatibility with JSON-based RPC transport, while internal logic uses strict typing.

### 6.2 oRPC Integration
- **Contract-First**: Defined strict API contracts in `packages/api/src/routers/google-cal/contract.ts`.
  - Uses `oc` (oRPC Contract) builder.
  - Inputs and outputs are validated using `Schema.standardSchemaV1` wrapped around Effect schemas.
- **Router Implementation**:
  - `packages/api/src/routers/google-cal/router.ts` implements the contract.
  - **Middleware**: Implemented `checkGoogleAccountIsLinked` helper (inside handlers) to securely fetch the user's Google Access Token from the database using the session's `userId`.
  - **Handler Logic**:
    1.  Verifies Google account linking via DB.
    2.  Constructs an Effect program using the `GoogleCalendar` service.
    3.  Provides the live service layer (`GoogleCalendarLive`) injected with the user's access token.
    4.  Runs the effect and returns the result.
  - **Error Handling**: Maps internal errors (AccountNotLinked, GoogleApiError) to standard `ORPCError` types for the client.

### 6.3 UI & Layout Implementation
- **shadcn/ui Sidebar**: Integrated the new `shadcn/ui` sidebar components (`Sidebar`, `SidebarContent`, etc.).
- **Dashboard Layout**:
  - Created `apps/web/src/app/dashboard/layout.tsx` to manage persistent layout.
  - **Left Sidebar (`AppSidebar`)**:
    - Contains "Inbox" and task lists.
    - Cleaned up navigation: removed command palette, team switcher, and unreads toggle.
    - Connected to `better-auth` client to display real logged-in user data.
    - Implemented logout functionality.
  - **Right Sidebar (`SidebarRight`)**:
    - Contains the calendar date picker and simplified calendar list.
    - Made collapsible (`offcanvas` mode) with a resize rail.
    - Fixed calendar date picker styling and functionality.
- **Settings Page**: Added a placeholder settings page at `/dashboard/settings` linked from the user profile dropdown.

### 6.4 Migration to Zod & drizzle-zod
- **Strategy Shift**: Migrated core data models (Tasks, etc.) from Effect Schema to **Zod**.
- **Schema Inference**:
  - Using `drizzle-zod` to automatically generate Zod schemas (`Insert`, `Select`, `Update`) directly from Drizzle table definitions.
  - This ensures the validation logic is always in sync with the database schema.
- **Frontend Validation**:
  - Refactored forms (e.g., Create Task) to use **React Hook Form** with `zodResolver`.
  - Validation uses the same inferred Zod schemas from the backend package, ensuring end-to-end type safety.

### 6.5 Calendar Week View & Drag-and-Drop
- **Library**: Implemented drag-and-drop using `@dnd-kit/core` and `@dnd-kit/utilities`.
- **Week View Components** (`apps/web/src/components/calendar/`):
  - **`week-view.tsx`**: Main calendar grid displaying 7 days with all 24 hours.
    - Fixed 7-day view (no horizontal scroll); vertical scroll only.
    - Scrollable time grid with fixed day headers.
    - Auto-scrolls to 8am on mount.
    - Groups and renders scheduled tasks by day.
  - **`time-grid.tsx`**: Core grid components:
    - `TimeSlot`: Droppable 15-minute slots (20px height each).
    - `DayColumn`: Vertical column for a single day containing all time slots.
    - `TimeGutter`: Left column showing hour labels (80px per hour).
    - `DayHeader`: Header cell showing day name and date number.
    - `parseSlotId`: Parses slot IDs to extract date/time in local timezone.
  - **`calendar-event.tsx`**: Draggable scheduled task blocks positioned absolutely within day columns.
  - **`dnd-context.tsx`**: DnD context provider wrapping sidebar and calendar.
    - Handles drag start/end events.
    - Optimistic updates via TanStack Query mutations.
    - Default task duration: 30 minutes.
- **Sidebar Task Item** (`apps/web/src/components/sidebar/task-item.tsx`):
  - Tasks in the left sidebar are draggable onto the calendar.
  - Shows "Scheduled" indicator for tasks with start times.
  - Original item hidden during drag (DragOverlay shows preview).
- **Dashboard Page** (`apps/web/src/app/dashboard/page.tsx`):
  - Fixed header with week navigation (prev/next/today buttons) and date picker.
  - Uses absolute positioning to ensure headers stay locked while time grid scrolls.
- **State Management**:
  - `currentDateAtom`: Currently selected date (Jotai atom).
  - `weekStartAtom`, `weekEndAtom`, `weekDaysAtom`: Derived atoms for week boundaries.
- **UUIDv7 Migration**:
  - Task IDs now use UUIDv7 for time-ordered indexing benefits.
  - Generated in backend (`packages/api/src/routers/task/client.ts`) using `uuidv7` package.
  - Drizzle schema updated to not auto-generate UUIDs.
  - API contracts validate with `z.uuidv7()`.

### 6.6 Calendar Event Fetch Window & Client-Side Caching
- **Month-anchored fetch window**: Google events fetched in a month-anchored window (start of month ±15 days) to avoid refetching when moving between days in the same month.
- **Stable query keys**: TanStack Query keys include the month anchor so intra-month navigation reuses cache; crossing into a new month triggers a single refresh.
- **Simplified layout**: Horizontal buffering/snap removed; week view uses a stable 7-day slice derived from `currentDate`.
- Note: This is the *client-side* TanStack Query cache. For the *server-side* Redis cache, see section 6.10.

### 6.7 Data & Color Updates (Google Calendar)
- **Jotai data layer**: Accounts, calendars, and events now load via atoms (`googleAccountsAtom`, per-account `googleCalendarsAtomFamily`, per-window `googleCalendarEventsForWindowAtom`, and a flattening selector) instead of inline `useQuery/useQueries`.
- **Minimal shapes**: Calendars carry `accountId` alongside the Google calendar, events carry `{ accountId, calendarId, event }`; no custom wrapper types beyond these tags.
- **Palette normalization**: Added pastel normalization for Google colors via `normalizedGoogleColorsAtomFamily`; dropdown and event components render softened background colors while keeping IDs unchanged.

### 6.8 Task Date/Time Schema Refactor
- **Problem**: `startTime` previously stored both date AND time as a timestamp, making `startDate` redundant when scheduling.
- **Solution**: Split into separate fields:
  - `startDate: date("start_date")` — calendar date for inbox visibility or calendar display
  - `startTime: time("start_time")` — time of day only (HH:mm:ss format, no `mode` option in Drizzle)
- **Display Logic**:
  - No fields: task in default inbox
  - `startDate` only: task visible in inbox on that date, not on calendar
  - Both fields: task scheduled on calendar at that date+time
- **API Codecs**: Added `plainTimeCodec` for `Temporal.PlainTime` ↔ `HH:mm:ss` conversion in all contracts (select, insert, update).
- **Frontend Updates**:
  - TaskEvent, TaskItem: Only render when BOTH `startDate` AND `startTime` exist
  - DaysView: Filter tasks to require both fields; grouping uses `startDate` directly
  - TaskEditPopover: Separate date picker (startDate) and time picker (startTime)
  - DnD handlers: Return `{ startDate: PlainDate, startTime: PlainTime }` on move/resize
  - DnD context: Unschedule clears both fields; preview resize combines both for ZonedDateTime
- **Optimistic Updates**: Updated TanStack Query mutations to use `onSuccess` that directly updates cache with server response instead of `onSettled` → `invalidateQueries`, eliminating flicker on drop.
- **Drizzle Gotcha**: `time()` column type does not accept `mode` option (unlike `timestamp` and `date`); defaults to string representation.

### 6.9 Effect-TS Service Architecture
- **Pattern**: All backend services use `Effect.Service` with `accessors: true` and `Effect.fn("Service.method")` for automatic OTel tracing spans.
- **Errors**: Each domain uses `Schema.TaggedError` for typed, compile-time-checked error channels. Callers handle errors with `Effect.catchTags`.
- **Layer composition**: Services declare `dependencies: [...]` for automatic wiring. At the router level, service layers are merged with `TelemetryLive` (e.g. `Layer.merge(TaskService.Default, TelemetryLive)`).
- **Services implemented**: `TaskService`, `TagService`, `GoogleCalendarCacheService`, `WebhookService`, `GoogleCalendarWebhookService`, `WebhookRepositoryService`.
- See [`services.md`](./services.md) for full method/error tables.

### 6.10 Redis Caching Layer (Google Calendar)
- **Service**: `GoogleCalendarCacheService` — an `Effect.Service` in `packages/api/src/routers/google-cal/cache.ts`.
- **Cached resources**: Calendar list, single calendar, colors (24h TTL), event lists, single events (1h TTL).
- **Invalidation**: Dual strategy — Google webhooks trigger broad invalidation (unknown which resource changed); local mutations use targeted invalidation (specific keys only).
- **Error handling**: Cache errors are always caught, logged as `CACHE_ERROR` (visible in OTel), and swallowed. Cache failures degrade to API fetches, never fail requests.
- **Auth-first**: Cache lookups happen *after* `checkGoogleAccountIsLinked` to prevent serving cached data to unauthorized users.
- See [`caching.md`](./caching.md) for full details.

### 6.11 Google Calendar Webhooks
- **Architecture**: Three Effect services handle push notifications:
  - `WebhookService` (orchestrator) → `GoogleCalendarWebhookService` (Google-specific watch logic) → `WebhookRepositoryService` (database layer).
- **Watch types**: Calendar list watch (detects added/removed calendars) and per-calendar event watches (detects event changes).
- **Notification flow**: Google POST → `/api/webhooks/google-calendar` route → `WebhookService.handleGoogleNotification` → validate headers/token → find subscription → invalidate cache → publish SSE event to user.
- **Refresh**: `WebhookService.refreshAll` discovers linked accounts and ensures all watches are active. Called on SSE connect and as a follow-up after calendar-list webhook notifications.
- See [`services.md`](./services.md) § Webhook Services for full details.

### 6.12 SSE Realtime Sync
- **Endpoint**: `sync.events` returns an `AsyncGenerator<SyncEvent>` (Server-Sent Events).
- **Mechanism**: Redis pub/sub — each user has a channel `user:{userId}`. Mutations across routers call `publishToUserBestEffort` to push typed events.
- **Event types**: `google-calendar` (calendar data changed), `tasks` (task data changed), `reconnect` (server requests reconnect).
- **Connection lifecycle**: Auto-closes after 11 minutes with a `reconnect` event to prevent stale connections.
- **On connect**: Fire-and-forgets `WebhookService.refreshAll` to ensure Google push notifications are active.

### 6.13 Rate Limiting
- **Implementation**: Redis-backed via `@orpc/experimental-ratelimit` with Lua script evaluation (`EVAL`).
- **Limiters**:
  - Global: 200 req/60s per user — applied to all authenticated endpoints.
  - Maps: 20 req/60s per user — stacked on top of global for Google Places search (per-request cost).

### 6.14 Tag System
- **Service**: `TagService` — same `Effect.Service` pattern as `TaskService`.
- **Operations**: `list`, `create`, `update`, `delete`.
- **Schema**: Tags have `name` + `icon` (emoji). Unique constraint on `(userId, name)` — `TagConflictError` on duplicates.
- **Integration**: Tasks reference tags via a many-to-many join. Task queries include tags.

### 6.15 Shared State Package
- **Package**: `packages/state/` — shared Jotai atoms, TanStack Query hooks, and storage adapters used by both web and native apps.
- **Contents**: Google account/calendar/event atoms, task/tag query hooks, optimistic mutation hooks, visible calendar selection, collision detection utils, Temporal date helpers.
- **Storage adapters**: `createPersistedAtom` with platform-specific adapters (web `localStorage`, native `SecureStore`).
- **Provider**: `StateProvider` gates on authenticated session and hydrates shared state.
- See [`state.md`](./state.md) for full contents.

### 6.16 OpenTelemetry
- **Server-side only**: No client-side OTel SDK in web or native. Network latency is measured via `x-request-start` header (injected by both clients, read on server).
- **Stack**: `NodeSDK` + `ORPCInstrumentation` + Effect `Tracer.layerGlobal` → all spans flow through a single `TracerProvider` → `BatchSpanProcessor` → `SpanAttributeFilter` → `OTLPTraceExporter` → Axiom (prod) or Jaeger (local).
- **Key config**: `autoDetectResources: false` (strips noisy resource attributes), `NEXT_OTEL_FETCH_DISABLED=1` (disables Next.js fetch auto-instrumentation), `SpanAttributeFilter` strips `next.span_name`/`next.span_type`.
- **Instrumentation hook**: `apps/web/src/instrumentation.ts` ensures `NodeSDK.start()` runs before Next.js creates root request spans.
- See [`otel.md`](./otel.md) for full details.
