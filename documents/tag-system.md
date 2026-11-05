# Tag system

Tags are user-defined labels (name + icon) that can be attached to tasks. The
data model uses a `tag` table plus a `task_tag` join table. Task queries return
full tag objects through SQL joins.

## Back-end and data flow

- Schema: `packages/db/src/schema/tag.ts` with relations in
  `packages/db/src/schema/relations.ts`.
- API: tag CRUD and task tag linking live under
  `packages/api/src/routers/tag/*` and `packages/api/src/routers/task/*`.
- Task queries join and group tags in
  `packages/api/src/routers/task/client.ts`.

## State and hooks

- Tags query + cache: `packages/state/src/atoms/tags.ts`,
  `packages/state/src/hooks/use-tags.ts`.
- Tag-scoped task sections (overdue/todo/done ordering):
  `packages/state/src/hooks/use-tag-task-sections.ts`.

## Web UI

- Tag icon map + picker: `apps/web/src/components/tags/`.
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
