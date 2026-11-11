# Tag system

Tags are user-defined labels (name, icon, and optional color) that can be attached to tasks. The
data model uses a `tag` table plus a `task_tag` join table. Task queries return
full tag objects through SQL joins.

## Back-end and data flow

- Schema: `packages/db/src/schema/tag.ts` with relations in
  `packages/db/src/schema/relations.ts`.
- API: tag CRUD and task tag linking live under
  `packages/api/src/routers/tag/*` and `packages/api/src/routers/task/*`.
- Task queries join and group tags in
  `packages/api/src/routers/task/client.ts`.

## Colors

A tag's color is a name from a fixed palette (`tagColorNames` in
`packages/api/src/routers/tag/contract.ts`), stored in `tag.color`; null
means no color. The swatches live in `packages/state/src/tag-colors.ts`:
ten pastels at one OKLCH lightness and chroma, so no tag outshouts another
and they sit at the same strength as the pastelized Google colors. Storing
the name, not the hex, lets the swatches be retuned without a migration.

- Calendar: a task takes the color of its first tag that has one
  (`taskTagSwatch`) and draws like an event, through the web's
  `event-surface` utility or native's `useEventSurface`. Tasks with no
  colored tag stay plain cards.
- Icons: `TagGlyph` (web and native `components/tags/`) draws a tag's icon
  in its color, darkened toward the ink on light paper for contrast
  (`--tag-ink-mix` in `index.css`). The sidebar rail, task rows, pickers,
  and the command bar use it.

## State and hooks

- Tags query + cache: `packages/state/src/atoms/tags.ts`,
  `packages/state/src/hooks/use-tags.ts`.
- Tag-scoped task sections (overdue/todo/done ordering):
  `packages/state/src/hooks/use-tag-task-sections.ts`.

## Web UI

- Tag icon map, color and icon picker, and `TagGlyph`: `apps/web/src/components/tags/`.
- Header tag popover (list/create/delete): `apps/web/src/components/app-header.tsx`.
- Sidebar tag nav + tag view sections: `apps/web/src/components/sidebar/sidebar-left.tsx`.
- Task forms tag selection: `apps/web/src/components/task-form/create-task-form.tsx`
  and `apps/web/src/components/task-form/task-edit-popover.tsx`.

## Command bar

See [command-bar.md](./command-bar.md#create-task) for model-based tag parsing and `#` suggestions.

## Native UI

- Tag picker and icon map: `apps/native/components/tags/`.
- Task editor: `apps/native/components/tasks/task-editor-sheet.tsx`, shared by
  `apps/native/app/(tabs)/(tasks)/index.tsx` and
  `apps/native/app/(tabs)/(calendar)/index.tsx`.
