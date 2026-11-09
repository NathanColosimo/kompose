import { mcp } from "@orpc/mcp";
import { type AnyProcedure, DecoratedProcedure } from "@orpc/server";
import { sendPublicErrors } from "../errors";
import { tagRouter } from "../routers/tag/router";
import { taskRouter } from "../routers/task/router";

/**
 * MCP tools for the user's agents: the app's own task and tag procedures with
 * tool metadata, so schemas, validation, recurrence handling, realtime sync
 * events, and rate limits are the same as in the apps. /api/mcp signs the
 * agent's user into the context that `requireAuth` checks. See documents/mcp.md.
 */

const readOnly = { openWorldHint: false, readOnlyHint: true };

/**
 * Exposes an app procedure as an MCP tool, keeping its schemas and middleware.
 * These procedures skip `appRouter`, so each one sends public errors itself.
 */
function tool<T extends AnyProcedure>(
  procedure: T,
  meta: Parameters<typeof mcp.tool>[0]
) {
  return new DecoratedProcedure(procedure["~orpc"])
    .use(sendPublicErrors)
    .meta(mcp.tool(meta));
}

export const mcpRouter = {
  createTask: tool(taskRouter.create, {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Create a task. Dates are YYYY-MM-DD; startTime is HH:mm:ss in the user's local time and needs a startDate (without one the task is all-day). durationMinutes defaults to 30. tagIds come from list_tags. A recurrence rule creates the whole series; every created occurrence is returned.",
    name: "create_task",
    title: "Create task",
  }),
  deleteTask: tool(taskRouter.delete, {
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      'Delete a task permanently. Use scope "this" for a single task or occurrence; for a task with a seriesMasterId, "following" deletes it and every later occurrence.',
    name: "delete_task",
    title: "Delete task",
  }),
  getTask: tool(taskRouter.get, {
    annotations: readOnly,
    description: "Get one task by ID.",
    name: "get_task",
    title: "Get task",
  }),
  listTags: tool(tagRouter.list, {
    annotations: readOnly,
    description:
      "List the user's tags. Use their IDs to filter search_tasks or set tagIds on a task.",
    name: "list_tags",
    title: "List tags",
  }),
  searchTasks: tool(taskRouter.list, {
    annotations: readOnly,
    description:
      "Search the user's tasks, newest created first. All params are optional and combine with AND. Always set params.limit (50 is a good default) so the result stays small, and narrow the filters if you get that many back.",
    name: "search_tasks",
    title: "Search tasks",
  }),
  updateTask: tool(taskRouter.update, {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      'Update a task. Only the fields given in "task" change; pass null to clear one. tagIds replaces all tags. Mark a task complete with status "done". Use scope "this" for a single task or occurrence; for a task with a seriesMasterId, "following" changes it and every later occurrence, except a status, which goes on the given occurrence alone. Changing recurrence (or setting it to null) needs scope "following". An occurrence with no startDate has nothing after it, so it always changes alone. Returns every task that changed.',
    name: "update_task",
    title: "Update task",
  }),
};
