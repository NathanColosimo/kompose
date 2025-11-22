# Kompose – Technical Overview & Architecture Outline

## 1. What is Kompose?

Kompose is a **calendar + task orchestration app** with:

- Calendar + tasks in one unified timeline.
- Ability to **drag tasks onto the calendar** (turn backlog items into scheduled time blocks).
- **AI assistant** that can create/update/delete events and tasks from natural language (“Block 2 hours tomorrow afternoon to work on Kompose sync engine”, “Move my Linear bugfix task to Friday morning”, etc.).
- Integrations with tools like **Notion**, **Linear**, etc. for auto-syncing tasks/issues.
- **Global fuzzy search** (command palette style) over:
  - Events
  - Tasks
  - Integration data (Notion pages, Linear issues, etc.)
- **Offline-first** on:
  - **Mobile (Expo)**
  - **Desktop (Tauri)**  
  with **online-only** (for now) on the web.

Name: **Kompose**  
Tagline (draft): *“Compose your time, tasks, and tools into one schedule.”*

---

## 2. Product Goals & Philosophy

1. **Time- and task-centric, not app-centric**
   - Users should manage their day from Kompose instead of bouncing between calendar, todo apps, Linear, Notion, etc.

2. **Natural language control via AI**
   - “Make time for X”, “Reschedule that”, “Show me my deep work tasks this week”.
   - AI acts as a *personal ops assistant* over your schedule & tasks.

3. **Local-first experience where it matters**
   - Mobile & desktop should feel instant and usable on a plane.
   - Sync is automatic and resilient, not something the user worries about.

4. **Composable integrations**
   - Integrations are first-class, not one-off hacks.
   - Same internal model for “task” whether it comes from Kompose, Notion, Linear, etc.

5. **Command palette everything**
   - Fuzzy search + actions: open things, run actions, trigger AI, navigate views.

---

## 3. High-Level Architecture

### Clients

- **Web app**: Next.js (static pages + client-side data)
- **Desktop app**: Tauri bundling the built Next.js app
- **Mobile app**: Expo (React Native)

### Backend

- **HTTP API + RPC**: Next.js API routes (or App Router route handlers) exposing oRPC endpoints.
- **App DB**: Postgres with Drizzle ORM.
- **Auth**: Better Auth + Drizzle (Postgres only).
- **Background jobs**: worker(s) for sync, integrations, and AI tasks.
- **Search index**: server-side search engine (e.g., Meilisearch/Typesense or Postgres FTS).

### Local Persistence (offline)

- **Mobile (Expo)**: SQLite (via `expo-sqlite`)
- **Desktop (Tauri)**: SQLite in Rust via `sqlx`/`rusqlite`, exposed through Tauri commands
- **Web**: initially online-only, optional IndexedDB later.

### Sync

- “Local-first, cloud-synced” model for events & tasks:
  - Local DB as source of truth on mobile/desktop.
  - Periodic and event-based sync with server via oRPC.
  - Simple **LWW (last-write-wins)** for v1, with change sets and cursors.

---

## 4. Tech Stack Overview

### 4.1 Frontend – Web (Next.js)

- **Framework**: Next.js (App Router)
- **Rendering**:
  - **All main pages statically generated** (SSG) at build time:
    - `/` landing
    - `/app` shell (calendar/task UI shell)
    - `/settings`, `/integrations`, etc.
  - Data is **fetched client-side** via TanStack Query + RPC (no SSR data dependency, good for Tauri).
- **Routing**:
  - Next.js App Router for routes.
  - Inside `/app`, use client components with TanStack Query for state/data.
- **State/Data Fetching**:
  - TanStack Query (React Query) on the client
  - oRPC client for typed RPC calls to Next API endpoints.
- **UI Layer**:
  - React + TailwindCSS
  - Component library: e.g. shadcn/ui for primitives.
  - Drag-and-drop: React DnD or `@dnd-kit/core` for dragging tasks onto calendar slots.
- **Auth integration**:
  - Better Auth Next.js integration with API route handlers:
    - `POST /api/auth/*` etc.
  - Client acquires session, user ID, and tokens, then passes user ID to app repos.

### 4.2 Frontend – Desktop (Tauri + Next.js bundle)

- **Tauri**:
  - Rust backend + WebView.
  - Loads built Next.js static output (e.g., from `next export` or custom static build).
- **Assets**:
  - HTML/JS/CSS for `/app` and other pages are bundled locally for instant load.
- **Navigation**:
  - Pure client-side SPA experience once the shell is loaded.
- **Data**:
  1. Local SQLite via Tauri commands for offline events/tasks.
  2. RPC to cloud backend when online for sync and integrations.
- **Tauri Commands**:
  - `getEvents`, `saveEvents`, `getTasks`, `saveTasks`, `getPendingChanges`, `applyRemoteChanges`, etc.
  - Return typed data matching the shared domain models.

### 4.3 Frontend – Mobile (Expo)

- **Framework**: Expo (React Native, TypeScript)
- **Navigation**: React Navigation
- **Data Layer**:
  - TanStack Query (React Query) for query/mutation APIs.
  - Local SQLite via `expo-sqlite` as primary store for events/tasks.
  - Sync engine runs on:
    - app focus
    - manual pull-to-refresh
    - periodic background (where feasible)
- **Auth**:
  - Better Auth flows through HTTP API:
    - In-app browser or deep linking for OAuth.
  - Store tokens securely (SecureStore/Keychain).
  - Save `currentUserId` and tokens; local tables use `userId` field, no auth tables.
- **AI & Commands**:
  - Command palette UI (e.g., modal) with fuzzy search and action execution.
  - “Ask Kompose AI” text input that calls backend AI endpoint.

---

### 4.4 Backend – API & RPC

- **Runtime**: Next.js (Node) route handlers / API routes.
- **RPC**:
  - Use **oRPC** as a TS-first RPC layer.
  - Define a shared `AppRouter`:
    - `calendar.list`, `calendar.get`, `calendar.create`, `calendar.update`, `calendar.delete`
    - `event.list`, `event.get`, `event.create`, `event.update`, `event.delete`
    - `task.list`, `task.create`, `task.update`, `task.delete`
    - `sync.pushChanges`, `sync.pullChanges`
    - `integration.linear.sync`, `integration.notion.sync`
    - `ai.command` (for AI-driven actions)
- **API Routes**:
  - Next route handlers under `/api/orpc` to host the oRPC router.
  - `/api/auth/*` routes for Better Auth auth flows.
- **Integration Webhooks**:
  - `/api/integrations/linear/webhook`
  - `/api/integrations/notion/webhook`
  - etc.

### 4.5 Backend – Database & ORM

- **Primary DB**: Postgres
- **ORM**: Drizzle ORM
- **Schemas**:
  - `auth` schema (Better Auth generated; Postgres-only).
  - `app` schema:
    - `eventsPG`
    - `tasksPG`
    - `calendarsPG`
    - `task_sourcesPG` (e.g., “kompose”, “notion”, “linear”)
    - `integration_accountsPG` (per-user OAuth tokens & metadata)
    - `ai_sessionsPG` / `ai_logsPG` (optional)
- **SQLite Schemas** (for mobile/desktop):
  - `eventsSQLite`
  - `tasksSQLite`
  - `calendarsSQLite`
  - `local_sync_stateSQLite` (sync cursors, last sync times, etc.)
  - Possibly `local_userSQLite` for cached profile info
- **Type Sharing**:
  - Shared TS types in `@kompose/domain` describing logical objects:
    - `Event`, `Task`, `Calendar`, `TaskSource`, etc.
  - Drizzle schemas per dialect (PG + SQLite) generated from the same conceptual model.

### 4.6 Sync Layer

- **Core model**:
  - Every syncable row has:
    - `id`
    - `userId`
    - `updatedAt` (timestamp / integer)
    - `deletedAt` or `isDeleted`
    - `source` (e.g., “kompose”, “linear”, “notion”)
- **Client → Server**
  - `sync.pushChanges(changeSet)`:
    - changeSet contains created/updated/deleted events & tasks from local DB.
- **Server → Client**
  - `sync.pullChanges({ sinceCursor })`:
    - returns all rows changed after `sinceCursor`.
    - includes both events & tasks (possibly in separate collections).
- **Conflict Strategy (v1)**:
  - LWW by `updatedAt`.
  - In future, add smarter merges & conflict surfaced to the user.

---

### 4.7 Auth & Security

- **Auth provider**: Better Auth
  - Handles sign-in, OAuth providers, sessions, tokens.
  - Generates Drizzle schema for auth tables in Postgres.
- **Server-side**:
  - All RPC endpoints require a valid session or token.
  - `userId` extracted from auth context and injected into repository layer.
- **Client-side**:
  - Web: Next.js + Better Auth client helpers.
  - Mobile: tokens stored via secure storage.
  - Desktop: tokens stored in OS keychain via Tauri-plugin-auth/secure-store.
- **Local DB**:
  - `userId` is stored on each row; no auth FK locally.
  - On logout, local DB for that user can be wiped or archived.

---

### 4.8 AI Integration

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
  - Optionally present a “preview” diff to the user for confirmation (especially for bulk changes).

---

### 4.9 Integrations (Notion, Linear, etc.)

- **Integration Accounts**:
  - `integration_accountsPG` with:
    - `userId`
    - `provider` (“notion”, “linear”, …)
    - access/refresh tokens
    - scopes, metadata
- **Sync Model**:
  - Periodic background jobs (cron or queue-based) that:
    - fetch tasks/issues from each provider
    - normalise into Kompose’s internal `Task` model with `source="linear"` or `source="notion"`
  - Webhooks where possible (e.g. Linear) to reduce polling.
- **Direction**:
  - v1: **one-way import** (external → Kompose).
  - v2: Two-way sync with conflict handling.
- **User Experience**:
  - In UI, tasks show their origin (icon + label).
  - Some operations (like “close Linear issue”) call provider APIs as part of the mutation.

---

### 4.10 Fuzzy Search & Command Palette

- **Search Index**:
  - Server:
    - Use Meilisearch / Typesense *or* Postgres FTS.
    - Index:
      - Events (title, description, location)
      - Tasks (title, description, source metadata)
      - Integration items (Notion pages, Linear issues)
      - Possibly AI summaries of projects.
  - Clients:
    - Web:
      - Input → call search RPC → results with typed objects + types.
    - Mobile/desktop:
      - v1: same server search.
      - v2: local search over SQLite (FTS5) for offline queries.
- **Command Palette**:
  - Unified UI in all clients:
    - quick open item
    - run actions (e.g., “create task”, “schedule task”, “jump to date”).
  - AI search:
    - free-form text goes to AI endpoint that can combine search + actions.

---

## 5. Project Structure Overview

Proposed monorepo structure (`bun` workspaces, Turborepo):

```txt
apps/
  web/          # Next.js app (static pages + client data)
  mobile/       # Expo app (React Native)
  desktop/      # Tauri app (Rust + bundled Next.js UI)

packages/
  api/       # oRPC API definitions, shared types, Zod schemas, domain logic
  auth/ # Better Auth configuration and schema
  config/         # Configuration for the project
  db/  # Database schema and queries
  google-cal/ # Google Calendar client & schema (Effect-based)
```

---

## 6. Recent Implementation Updates (Google Calendar & oRPC)

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
