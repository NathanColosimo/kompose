# AI Chat Implementation Log

This document captures the AI chat work completed so far across schema, backend services, API routes, shared state, and web UI.

## 1) Scope and intent

Phase 1 scope implemented:

- AI chat foundation across web + shared app layer
- Session persistence + message persistence
- Streaming responses with resumable stream support
- Attachment support via `UIMessage.parts` (no separate attachment table)
- Clear seam for future tool-calling and richer AI workflows

Out of scope for this pass:

- Native AI tab UI
- Tool execution logic (Phase 2+)
- Memory/automation features (`mem0`, plugin subscriptions, generative UI)

---

## 2) Database and schema decisions

Implemented in `packages/db/src/schema/ai.ts` and related schema files:

- Added AI chat tables:
  - `ai_session`
  - `ai_message`
- Removed separate `ai_attachment` table (attachments live in message parts).
- Removed `userId` from `ai_message` (ownership comes from `sessionId -> ai_session`).
- IDs use `uuidv7()` in repository/service layer for session + message creation.
- Kept normalized message columns with flexible JSON:
  - `role`, `content` (queryable core)
  - `parts` as `jsonb` for rich UI payloads
- Collocated DB-derived chat types directly in schema file:
  - `AiSessionSelect`, `AiMessageSelect`, `AiChatRole`
  - `CreateAiSessionInput`, `CreateAiMessageInput`
  - insert/select/update row aliases

Related updates:

- `packages/db/src/schema/relations.ts` updated to remove attachment relations and keep AI relations consistent.

---

## 3) Type system cleanup

Type strategy was simplified to avoid duplication and drift:

- Removed manual `packages/ai/src/types.ts`.
- Re-exported DB-derived chat types from `packages/ai/src/index.ts`.
- Removed inline `import("...").Type` style usage in shared state types.
- Removed redundant manual stream input/result aliases that were unnecessary.

Result: chat types are now sourced from DB schema and AI SDK types where appropriate.

---

## 4) `packages/ai` refactor (Effect + OTel)

Refactored both repository and service into `Effect.Service` pattern.

### Repository (`packages/ai/src/repository.ts`)

- Converted to `AiChatRepository extends Effect.Service`.
- Methods wrapped with `Effect.fn(...)` and `Effect.tryPromise(...)`.
- Added span annotations (user/session context) for traceability.
- Removed mapper indirection where unnecessary.
- Handles:
  - list/create/get/delete sessions
  - list/create messages
  - update session activity (`activeStreamId`, `title`, `lastMessageAt`)

### Service (`packages/ai/src/service.ts`)

- Converted to `AiChatService extends Effect.Service` with repository dependency.
- Added chat orchestration methods:
  - `listSessions`, `createSession`, `deleteSession`, `listMessages`
  - `startStream`
  - `markActiveStream`, `getActiveStreamId`
  - `persistAssistantFromUiMessages`
  - `generateSessionTitleFromFirstMessage`
- Runtime message validation uses AI SDK `validateUIMessages`.
- AI provider call stays in traced service flow.
- Persists assistant text fallback for non-text outputs while storing full `parts`.
- Session title generation now runs asynchronously with `gpt-5-nano` and is
  derived from the first user message only. It does not block stream startup.

---

## 5) API migration to oRPC

Chat APIs are now implemented in `packages/api/src/routers/ai`:

- `contract.ts`
- `router.ts`
- `resumable-stream.ts`
- `stream-protocol.ts`

Key changes:

- Router implementation now follows the same Effect/orpc format as other routers:
  - `const program = ...`
  - `Effect.runPromise(program.pipe(...))`
  - centralized `handleError(...)` mapping `AiChatError -> ORPCError`
- Provides `AiChatService.Default` + `TelemetryLive` via merged layer.
- Uses oRPC `requireAuth` middleware + typed ORPC errors
- Stream procedures:
  - `ai.stream.send` for primary stream
  - `ai.stream.reconnect` for resumable reconnect
  - still uses Redis-backed `resumable-stream` under the hood
  - tracks/clears `activeStreamId` on the session

---

## 6) Shared state + app clients

Shared chat access is now centralized again in state and backed by oRPC:

- Added `packages/state/src/hooks/use-ai-chat.ts` with:
  - `sessionsQuery`
  - `messagesQuery`
  - `createSession` / `deleteSession`
  - `streamSessionMessage` / `resumeSessionStream`
  - shared query-key helpers for session/message caches
- Removed legacy REST chat clients:
  - `apps/web/src/utils/chat-client.ts`
  - `apps/native/utils/chat-client.ts`
- Removed `chatClient` from shared state config/types
- `apps/web/src/components/sidebar/sidebar-right-chat.tsx` now consumes the shared `useAiChat` hook and uses `useChat` transport backed by:
  - `orpc.ai.stream.send` (through `streamSessionMessage`)
  - `orpc.ai.stream.reconnect` (through `resumeSessionStream`)

---

## 7) Web sidebar chat UI (AI Elements)

Added chat UI to right sidebar:

- `apps/web/src/components/sidebar/sidebar-right-chat.tsx`
- `apps/web/src/components/sidebar/sidebar-right.tsx` now mounts this chat surface

Features implemented:

- Session list + create/delete
- Message list rendering using AI Elements conversation/message primitives
- Prompt composer with file attachments
- Model picker (currently `gpt-5`, `gpt-5-mini`)
- Reasoning and chain-of-thought display blocks
- Context usage indicator block
- Streaming + resume wired through AI SDK `useChat`

---

## 8) AI Elements cleanup

Removed non-chat AI Elements components from `apps/web/src/components/ai-elements` to keep surface area focused.

Kept chat-relevant components:

- `attachments.tsx`
- `chain-of-thought.tsx`
- `context.tsx`
- `conversation.tsx`
- `message.tsx`
- `model-selector.tsx`
- `prompt-input.tsx`
- `reasoning.tsx`
- `shimmer.tsx` (used by reasoning)

---

## 9) Resumable streams with Bun Redis

Implemented custom Redis-backed resumable stream context:

- Added `packages/api/src/routers/ai/resumable-stream.ts`
- Uses `resumable-stream/generic` with Bun `RedisClient` adapters:
  - `Publisher`: `connect/get/set/incr/publish`
  - `Subscriber`: `connect/subscribe/unsubscribe`
- Uses `env.REDIS_URL`
- Added key prefix: `kompose:chat:stream`
- Added `packages/api/src/routers/ai/stream-protocol.ts` to bridge:
  - `UIMessageChunk` streams <-> SSE string streams
- AI router procedures use shared singleton context for:
  - `createNewResumableStream`
  - `resumeExistingStream`

---

## 10) UI fixes after integration

Follow-up UX fixes:

- Prompt input height issue:
  - Re-structured `PromptInputHeader`, `PromptInputBody`, `PromptInputFooter` as direct children of `PromptInput` per AI Elements composition expectations.
  - Added `rows={3}` for better default textarea height.
- Footer overlap issue (model picker and attachment plus icon):
  - Enabled wrapping in tools row
  - Gave model button explicit text-button sizing/spacing
  - Prevented context trigger shrinking

---

## 11) Validation summary

During this work:

- `@kompose/ai` type-check passed after backend refactors
- `@kompose/api` type-check passed after router + stream protocol changes
- `@kompose/state` and `web` type-check passed after restoring shared chat hook
- Lints for changed chat files were kept clean

---

## 12) Current status and remaining steps

Completed:

- Backend AI chat foundations
- DB schema + type derivation model
- Effect-based repository/service with tracing
- oRPC AI router with resumable streaming
- Redis-backed resumable streams (Bun Redis adapter)
- Shared `useAiChat` hook in `packages/state` backed by oRPC
- Web right-sidebar chat UI with AI Elements
- Key UX fixes on composer layout

Still pending:

- Generate DB migration artifacts (`db:generate`) on user command
- Phase 4 tool/confirmation UI rendering in web + native chat surfaces
- `documents/ai-tools.md` architecture and approval-flow guide

---

## 13) Native AI chat tab (full parity pass)

Implemented mobile AI chat in `apps/native` with the same transport/session model
as web:

- Added native chat tab routing:
  - `apps/native/app/(tabs)/(chat)/_layout.tsx`
  - `apps/native/app/(tabs)/(chat)/index.tsx`
  - registered in `apps/native/app/(tabs)/_layout.tsx`
- Added RN chat UI primitives in `apps/native/components/ai-chat/`:
  - `conversation.tsx`
  - `message.tsx`
  - `attachments.tsx`
  - `chain-of-thought.tsx`
  - `context.tsx`
  - `model-selector.tsx`
  - `prompt-input.tsx`
- Wired mobile chat screen to shared state + streaming:
  - uses `useAiChat(activeSessionId)` from `@kompose/state`
  - uses AI SDK `useChat` with custom `ChatTransport`
  - `sendMessages` -> `orpc.ai.stream.send` (via `streamSessionMessage`)
  - `reconnectToStream` -> `orpc.ai.stream.reconnect` (via `resumeSessionStream`)
  - stream adapter remains `eventIteratorToUnproxiedDataStream`
- Added native parity features:
  - session list + create/delete
  - model picker (`gpt-5`, `gpt-5-mini`)
  - reasoning rendering (`reasoning` parts)
  - attachment rendering (`file`, `source-document` parts)
  - context usage panel
  - attachment picking from device (image + document)
- Added AI query cache hygiene in native auth/session helpers:
  - `apps/native/utils/orpc.ts` now invalidates/removes AI session/message cache
    alongside tasks/calendar caches.

Notes:

- Native attachments are normalized to `FileUIPart` and converted to data URLs
  when possible so server-side model calls can consume the payload.
- This keeps mobile and web aligned on the same backend contracts and stream
  semantics.

---

## 14) Realtime AI invalidation + active-session stream checks

Added AI chat invalidation to the existing `sync.events` endpoint (same channel
used for tasks/calendars):

- New realtime event type: `ai-chat` with payload `{ sessionId }`
- Published from AI router when session/stream lifecycle changes:
  - session create/delete
  - stream start (active stream set)
  - stream finish (assistant persisted, active stream cleared)
  - async first-message title generation success
- Reconnect misses no longer clear `activeStreamId` immediately; client retries
  are allowed and normal `onFinish` cleanup clears the pointer.
- Shared realtime hook (`packages/state/src/hooks/use-realtime-sync.ts`) now:
  - invalidates `AI_CHAT_SESSIONS_QUERY_KEY`
  - only refetches `getAiChatMessagesQueryKey(sessionId)` when that session
    still exists after the sessions refresh
  - removes deleted-session message query keys to avoid post-delete message
    refetches
  - includes AI query invalidation in reconnect fallback
- Web + native chat screens run a deduped `resumeStream()` check when the
  currently open session receives a newly visible `activeStreamId` after
  realtime refetch.
- Resume checks now retry in a short capped loop (`4` attempts, `750ms`
  interval) to handle transient reconnect races when another device starts the
  stream.
- `useChat` UI updates are throttled (`experimental_throttle: 50`) to reduce
  render backlog during high-frequency chunk streams (especially on native).
- AI router error mapping now preserves HTTP semantics for configured domain
  errors, including `MODEL_NOT_CONFIGURED -> SERVICE_UNAVAILABLE`, instead of
  collapsing known AI config failures into generic 500 responses.

---

## 15) Tool-calling rebuild — Phase 1 infrastructure

Implemented foundational API changes needed before wiring AI SDK tool execution:

- Added `@orpc/ai-sdk` to workspace catalog and `@kompose/api` dependencies.
- Simplified API context/auth shape:
  - `packages/api/src/context.ts` now returns only `{ user }`.
  - `requireAuth` in `packages/api/src/index.ts` now validates `context.user?.id`
    only and passes user-only context forward.
- Added a new authenticated `account` router:
  - `packages/api/src/routers/account/contract.ts`
  - `packages/api/src/routers/account/router.ts`
  - `list` returns linked account rows with `{ id, providerId, email, name }`.
  - Profile enrichment is server-safe without request headers:
    - decode `idToken` claims when available
    - for Google accounts, use `getAccessToken({ userId, accountId })` and fetch
      userinfo directly
    - fallback to empty profile fields when provider enrichment is unavailable.
- Wired `accountRouter` into `appRouter` at
  `packages/api/src/routers/index.ts` as `account.list`.

---

## 16) Tool-calling rebuild — Phase 2 tool definitions

Implemented the tool definition layer and schema descriptions needed for model-facing
tool use:

- Added `packages/api/src/routers/ai/tools.ts` with a declarative tool map and
  `createAiTools(user)` built on `createTool` from `@orpc/ai-sdk`.
- Updated `account.list` contract input from `z.void()` to
  `z.object({}).optional()` so
  AI SDK tool JSON Schema generation succeeds (`void` cannot be represented).
- Defined the initial tool set:
  - `list_linked_accounts`
  - `list_calendars`
  - `list_calendar_events`
  - `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`
  - `list_tasks`, `create_task`, `update_task`, `delete_task`
- Added concise `.describe()` hints on key tool-facing input fields in:
  - `packages/api/src/routers/google-cal/contract.ts`
  - `packages/api/src/routers/task/contract.ts`
  so the model gets clearer parameter guidance without duplicating schemas.

---

## 17) Tool-calling rebuild — Phase 3 agent loop

Implemented the full stream contract + service + transport wiring required for
tool-loop execution:

- Updated AI stream contract input in
  `packages/api/src/routers/ai/contract.ts`:
  - `message` -> `messages: UIMessage[]` (min length 1)
  - added optional `timeZone`
- Added timezone-aware prompt builder in `packages/ai/src/prompt.ts`:
  - `buildChatSystemPrompt({ timeZone })` appends runtime date/time context
  - guidance now explicitly requires tool usage for calendar/task/account ops and
    forbids fabricating tool outcomes
- Updated `AiChatService.startStream` in `packages/ai/src/service.ts`:
  - accepts `messages`, optional `timeZone`, optional `tools`
  - validates client-provided full message arrays (including tool parts)
  - persists a `system` message on first turn and reuses it for later turns
  - prepends the persisted `system` message into the model `messages` array
    (instead of passing `system` separately) to keep prompt caching stable
  - passes `tools` and `stopWhen: stepCountIs(20)` to `streamText`
  - persists latest user message for session history before streaming
- Wired tool creation into AI stream router in
  `packages/api/src/routers/ai/router.ts`: w
  - builds tools via `createAiTools(context.user)`
  - passes `input.messages`, `input.timeZone`, and `tools` into
    `AiChatService.startStream`
- Updated shared/client transports to send full context:
  - `packages/state/src/hooks/use-ai-chat.ts` now sends
    `{ sessionId, messages, timeZone }`
  - both web (`apps/web/src/components/sidebar/sidebar-right-chat.tsx`) and
    native (`apps/native/app/(tabs)/(chat)/index.tsx`) now forward full
    `messages` arrays and local timezone to the stream endpoint
  - `system` messages are allowed through client state for round-trips but are
    filtered out from rendered message lists in UI.

---

## 18) Tool-calling rebuild — Phase 4 web tool UI

Wired tool invocation rendering and approval flow into the web sidebar chat:

- Updated `apps/web/src/components/sidebar/sidebar-right-chat.tsx`:
  - Extracts tool parts from message `parts` using `isToolUIPart` from `ai`
  - Renders each tool invocation with the composable `<Tool>` component
    (`ToolHeader` + `ToolContent` + `ToolInput` + `ToolOutput`)
  - Embeds `<Confirmation>` inside the `<Tool>` content so approval-based tools
    show input and approval UI together in a single collapsible—no duplication
  - Wires approve/reject buttons to `addToolApprovalResponse` from `useChat`
  - Auto-rejects pending approvals after 5 minutes of inactivity
  - `formatToolName` converts `tool-create_calendar_event` → `Create Calendar Event`
    for human-readable tool headers
- Segment-based message rendering via `buildMessageSegments`:
  - Walks parts in natural order, grouping consecutive reasoning and text
  - Breaks groups at tool boundaries so COT → tool → COT renders correctly
    (separate `<ChainOfThought>` blocks instead of one combined block)
  - Replaces the old `extractReasoning`/`hasReasoningPart`/`extractToolParts`
    helpers with a single ordered segment list
- Pre-existing AI Elements components used without modification:
  - `apps/web/src/components/ai-elements/tool.tsx`
  - `apps/web/src/components/ai-elements/confirmation.tsx`
  - `apps/web/src/components/ai-elements/code-block.tsx`
- Fixed `AiChatService.startStream` in `packages/ai/src/service.ts`:
  - System prompt is now loaded from persisted messages for ALL rounds, not
    just user-message rounds. Previously approval round-trips (where the
    latest message is an assistant message) fell back to the base prompt
    without timezone context, causing a system prompt mismatch mid-conversation.
- Added `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
  to the `useChat` hook so that approval responses are actually sent back to the
  server. Without this, `addToolApprovalResponse` only updated client-side state
  and the tool never executed on the server—approvals were lost on page reload.
- Fixed duplicate assistant message persistence during approval round-trips:
  `onFinish` fires twice (once when the stream pauses for approval, once after
  tool execution). `persistAssistantFromUiMessages` now checks if the last
  persisted message is already an assistant message and updates it in place
  instead of creating a duplicate row. This prevents "Duplicate item found"
  errors from OpenAI (same reasoning `itemId` appearing in two DB rows) and
  the UI showing two tool components (one stuck on approval-requested).
- Removed the 5-minute auto-reject timeout from `ToolInvocationPart`. Each
  approval round-trip is a separate HTTP request, so there is no connection
  timeout concern—users can approve at any time.
- Compact tool/confirmation styling for sidebar: smaller padding, fonts, icons,
  buttons, and code blocks to fit the narrow sidebar layout.

Still pending:
- `documents/ai-tools.md` architecture guide

---

## 19) Tool-calling rebuild — Phase 4 native tool UI

Ported tool invocation rendering and approval flow from the web sidebar to
the native (Expo) chat screen:

- Created `apps/native/components/ai-chat/tool.tsx`:
  - Collapsible `Tool` container (context + state pattern, same as `ChainOfThought`)
  - `ToolHeader` with wrench icon, title, status `Badge`, and chevron toggle
  - `ToolContent` (conditionally rendered children)
  - `ToolInput` — formatted JSON in monospace text inside a muted ScrollView
  - `ToolOutput` — result JSON or destructive error text
  - No Shiki/CodeBlock on mobile; uses plain monospace `Text` for lightweight rendering
- Created `apps/native/components/ai-chat/confirmation.tsx`:
  - Context-based composable matching the web API: `Confirmation`,
    `ConfirmationRequest`, `ConfirmationAccepted`, `ConfirmationRejected`,
    `ConfirmationActions`, `ConfirmationAction`
  - Uses existing `Alert` and `Button` components
- Updated `apps/native/app/(tabs)/(chat)/index.tsx`:
  - Replaced `extractReasoning`/`hasReasoningPart` with `buildMessageSegments`
    for correct interleaving of reasoning, text, and tool parts
  - Added `NativeToolInvocationPart` component rendering `Tool` + embedded
    `Confirmation` + `ToolInput` + `ToolOutput`
  - Wired `addToolApprovalResponse` from `useChat`
  - Added `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
    so approvals trigger server-side tool execution
  - Added `formatToolName` helper

---

## 20) Canonical model context from persisted history

`AiChatService.startStream` was using client-supplied `input.messages` for both
the stream delta computation and the LLM model context. Client messages can be
stale when another tab/device has added turns or the user sends before
hydration finishes.

- Added `dbRowToUiMessage` helper in `packages/ai/src/service.ts` to convert
  persisted DB rows into `UIMessage` objects server-side.
- `startStream` now builds canonical model context from the persisted DB
  history (`repository.listMessages`) instead of the client cache:
  - For new user messages: the just-persisted message is appended to the
    canonical history.
  - For approval round-trips: the last persisted assistant message is replaced
    with the client's version (which carries transient approval-state deltas).
- Client-supplied messages are still validated and used as `originalMessages`
  for `toUIMessageStream` delta computation (must match the client's view).

