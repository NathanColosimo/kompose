# Mobile AI Chat Implementation Log

This document captures the end-to-end native AI chat rollout in `apps/native`, including architecture, implementation details, UI iterations, bug fixes, theming work, and current behavior.

## 1) Scope and goal

The mobile chat implementation targeted full parity with web chat behavior, specifically:

- Session creation and switching
- Streaming responses + stream resume
- Attachments (image/document selection)
- Reasoning display
- Model selection
- Chat persistence via shared state and backend contracts
- Native-first UI patterns (header controls, composer ergonomics, dark mode)

## 2) Routing and navigation

Implemented chat tab and stack routing:

- Added chat tab trigger in `apps/native/app/(tabs)/_layout.tsx`
- Added chat stack layout in `apps/native/app/(tabs)/(chat)/_layout.tsx`
- Added main chat screen in `apps/native/app/(tabs)/(chat)/index.tsx`

Key header behavior updates:

- Chat title remains native stack title (`Chat`)
- Session and model controls moved into `headerLeft` and `headerRight`
- Header menus now open from the actual header toggle anchors using popovers

## 3) Shared state and streaming architecture

Native chat uses the same shared hook and backend stream contracts as web:

- `useAiChat(activeSessionId)` from `@kompose/state`
- AI SDK `useChat` in native screen
- Custom `ChatTransport`:
  - `sendMessages` -> shared `streamSessionMessage`
  - `reconnectToStream` -> shared `resumeSessionStream`
- Stream conversion via `eventIteratorToUnproxiedDataStream`

Cache/session hygiene updates:

- `apps/native/utils/orpc.ts` updated to include AI chat query invalidation/clearing hooks on auth/session events.

## 4) Native chat UI component system

Created native chat primitives under `apps/native/components/ai-chat/`:

- `conversation.tsx`
- `message.tsx`
- `attachments.tsx`
- `chain-of-thought.tsx`
- `context.tsx` (created; later removed from active composer usage)
- `model-selector.tsx` (initial modal-based selector primitives)
- `prompt-input.tsx`

These components mirror web ai-elements composition patterns while using RN-native controls and layout.

## 5) Main screen behavior in `chat/index.tsx`

Implemented:

- Session bootstrap and active-session selection logic
- Auto-create first session when none exists
- Session-aware message hydration from React Query cache
- Message rendering for:
  - text parts
  - reasoning parts
  - file/source-document attachments
- Composer with:
  - plus action for image attachments
  - inline growing input
  - send/stop actions
- Scroll-to-bottom helper button
- Error and loading states

## 6) Attachments support

Implemented device attachment picking in `prompt-input.tsx`:

- Image picker (`expo-image-picker`)
- Document picker (`expo-document-picker`)
- File conversion to data URL when possible (`expo-file-system`)

Important runtime safety change:

- Native module imports are lazy (`import()` inside handlers), preventing route crashes when modules are unavailable at evaluation time.

## 7) Model and session controls: UX evolution

Controls went through multiple iterations:

1. Modal selector approach (custom selector content)
2. Inline panel approach below header
3. Final anchored header popovers from toggles

Current behavior:

- Session picker in header-left
- Model picker in header-right
- Popovers open from toggle position (not detached panel)
- Dark-mode icon colors explicitly themed for chevrons/check/plus icons

## 8) Composer UX evolution

Composer changes made in response to UX feedback:

- Plus button moved inline left of input
- Send button moved inline right of input
- Removed extra nested border/box appearance around input
- Buttons resized and visually aligned
- Send button restyled to match plus button style
- Divider spacing adjusted between conversation and composer

## 9) Auto-growing input work

The input underwent multiple fixes to support real-world typing behavior:

- Initial auto-size via `onContentSizeChange`
- Added contraction support when deleting lines
- Fixed non-expanding behavior by avoiding height resets on every keystroke
- Added width-aware fallback estimation for wrapped typing when content-size events lag

Current implementation in `prompt-input.tsx`:

- Multiline `TextInput`
- Height clamped between minimum and maximum
- Growth updates from both:
  - measured content size (`onContentSizeChange`)
  - width-aware estimated wraps (`onChangeText` fallback)
- Internal scrolling enabled only at max height

## 10) Streaming markdown rendering

Integrated `streamdown-rn` for native message rendering:

- Installed in `apps/native/package.json`
- Replaced plain text rendering with `StreamdownRN` in message body
- Applied theme (`light`/`dark`) via color scheme hook
- Applied same renderer in reasoning display for consistent markdown behavior

## 11) Auto-scroll while streaming

Fixed streaming follow behavior so users do not need to manually scroll:

- Added `FlatList.onContentSizeChange` auto-follow logic during streaming/submitted states
- Respects user intent: only auto-scrolls while user is near bottom

## 12) Chain-of-thought and reasoning fixes

Resolved reasoning regressions:

- Assistant message row width behavior adjusted so reasoning does not collapse into narrow columns
- Reasoning text moved to themed markdown renderer for readability
- Chain-of-thought header/step icons explicitly themed (dark mode correctness)

## 13) Dark mode and theming fixes

Major dark mode fix:

- `apps/native/components/ui/view.tsx` no longer forces `backgroundColor: "transparent"` globally
- This allowed Tailwind/theme background classes to apply correctly

Additional theming updates:

- Chat stack header/content background explicitly set from theme in `chat/_layout.tsx`
- Dropdown/menu icon colors set from `useColor(...)`
- Composer and message surfaces aligned with theme tokens

## 14) Runtime/build issues resolved

- `metro.config.js` ESM/CJS compatibility issue fixed using `createRequire`
- Missing native module route crash fixed via lazy dynamic imports in attachment handlers
- Scroll-to-bottom button tap issue fixed (`pointerEvents` layering and press handling)

## 15) Validation and quality checks

During this implementation, repeated checks were run after major changes:

- Native type-check: `bun run type-check`
- Linter checks on edited files (`ReadLints`)

The implementation was iterated with immediate fixes for regressions discovered during runtime feedback.

## 16) Current state

Mobile chat now includes:

- Shared backend/state integration
- Streaming + reconnect
- Session and model controls in header with anchored dropdowns
- Attachment picking
- Markdown rendering via `streamdown-rn`
- Reasoning display
- Dark mode support across key chat surfaces
- Streaming auto-follow behavior
- Growing composer input with contraction support

## 17) Potential follow-ups

Not yet implemented, but natural next steps:

- Session rename/delete actions in session menu
- Additional markdown theme customization for code/tables/links
- More native-feeling menu row polish (spacing/separators/check placement)
- Composer animation smoothing for growth transitions
