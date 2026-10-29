import { taskRecurrenceSchema } from "@kompose/db/schema/task";
import { mcp } from "@orpc/mcp";
import { createRouterClient, os } from "@orpc/server";
import z from "zod";
import { requireAuth } from "..";
import type { Context } from "../context";
import { tagRouter } from "../routers/tag/router";
import {
  deleteScopeSchema,
  listTasksParamsSchema,
  type TaskSelectEncoded,
  taskStatusSchema,
  updateScopeSchema,
} from "../routers/task/contract";
import { taskRouter } from "../routers/task/router";

/**
 * MCP tools for the user's agents. Each tool is a thin adapter over the app's
 * own task and tag procedures, so validation, recurrence handling, realtime
 * sync events, and rate limits are shared with the apps. See documents/mcp.md.
 */

const SEARCH_LIMIT = 50;

const base = os.$context<Context>().use(requireAuth);

/** Calls the app's task procedures as the agent's user. */
function tasksClient(context: Context) {
  return createRouterClient(taskRouter, { context });
}

// ============================================================================
// Schemas
// ============================================================================

/** What agents see of a task: the app shape minus internal fields. */
const agentTaskSchema = z.object({
  description: z.string().nullable(),
  dueDate: z.string().nullable().describe("YYYY-MM-DD"),
  durationMinutes: z.number(),
  id: z.string(),
  isRecurring: z
    .boolean()
    .describe("Part of a recurring series; see update_task scope."),
  links: z.array(z.object({ title: z.string().optional(), url: z.string() })),
  startDate: z.string().nullable().describe("YYYY-MM-DD"),
  startTime: z.string().nullable().describe("HH:mm:ss, local time"),
  status: taskStatusSchema,
  tags: z.array(z.object({ id: z.string(), name: z.string() })),
  title: z.string(),
});

function toAgentTask(task: TaskSelectEncoded): z.infer<typeof agentTaskSchema> {
  return {
    description: task.description,
    dueDate: task.dueDate,
    durationMinutes: task.durationMinutes,
    id: task.id,
    isRecurring: task.seriesMasterId !== null,
    links: task.links.map((link) => ({ title: link.title, url: link.url })),
    startDate: task.startDate,
    startTime: task.startTime,
    status: task.status,
    tags: task.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    title: task.title,
  };
}

const taskFieldsSchema = z.object({
  description: z.string().nullable().optional(),
  dueDate: z.iso.date().nullable().optional().describe("Deadline, YYYY-MM-DD."),
  durationMinutes: z
    .int()
    .min(1)
    .optional()
    .describe("Planned length in minutes. Defaults to 30."),
  recurrence: taskRecurrenceSchema
    .nullable()
    .optional()
    .describe("Repeat rule. Setting it turns the task into a series."),
  startDate: z.iso
    .date()
    .nullable()
    .optional()
    .describe("Day the task is scheduled for, YYYY-MM-DD."),
  startTime: z.iso
    .time()
    .nullable()
    .optional()
    .describe(
      "Time of day, HH:mm:ss, in the user's local time. Requires startDate; without it the task is all-day."
    ),
  status: taskStatusSchema.optional(),
  tagIds: z
    .array(z.uuidv7())
    .optional()
    .describe("Tag IDs from list_tags. On update, replaces all tags."),
  title: z.string().min(1).optional(),
});

// ============================================================================
// Tools
// ============================================================================

const searchTasks = base
  .meta(
    mcp.tool({
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: `Search the user's tasks, newest created first. All filters are optional and combine with AND. Returns at most ${SEARCH_LIMIT} tasks; "truncated" is true when more matched, so narrow the filters.`,
      name: "search_tasks",
      title: "Search tasks",
    })
  )
  .input(
    listTasksParamsSchema.omit({ limit: true }).extend({
      limit: z
        .int()
        .min(1)
        .max(SEARCH_LIMIT)
        .optional()
        .describe(`Maximum tasks to return, up to ${SEARCH_LIMIT}.`),
    })
  )
  .output(z.object({ tasks: z.array(agentTaskSchema), truncated: z.boolean() }))
  .handler(async ({ input, context }) => {
    const limit = input.limit ?? SEARCH_LIMIT;
    // Ask for one extra to learn whether more tasks matched.
    const tasks = await tasksClient(context).list({
      params: { ...input, limit: limit + 1 },
    });
    return {
      tasks: tasks.slice(0, limit).map(toAgentTask),
      truncated: tasks.length > limit,
    };
  });

const getTask = base
  .meta(
    mcp.tool({
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "Get one task by ID.",
      name: "get_task",
      title: "Get task",
    })
  )
  .input(z.object({ id: z.uuidv7() }))
  .output(agentTaskSchema)
  .handler(async ({ input, context }) =>
    toAgentTask(await tasksClient(context).get(input))
  );

const createTask = base
  .meta(
    mcp.tool({
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Create a task. A task with a recurrence rule creates the whole series; the first occurrence is returned.",
      name: "create_task",
      title: "Create task",
    })
  )
  .input(taskFieldsSchema.required({ title: true }))
  .output(z.object({ createdCount: z.number(), task: agentTaskSchema }))
  .handler(async ({ input, context }) => {
    const tasks = await tasksClient(context).create(input);
    const [first] = tasks;
    if (!first) {
      throw new Error("Task creation returned no tasks");
    }
    return { createdCount: tasks.length, task: toAgentTask(first) };
  });

const updateTask = base
  .meta(
    mcp.tool({
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'Update a task. Only the fields given change; pass null to clear a field. For recurring tasks, scope "this" changes one occurrence and "following" changes it and every later one. Mark a task complete with status "done".',
      name: "update_task",
      title: "Update task",
    })
  )
  .input(
    z.object({
      id: z.uuidv7(),
      scope: updateScopeSchema.default("this"),
      task: taskFieldsSchema,
    })
  )
  .output(z.object({ task: agentTaskSchema, updatedCount: z.number() }))
  .handler(async ({ input, context }) => {
    const tasks = await tasksClient(context).update(input);
    const task = tasks.find(({ id }) => id === input.id) ?? tasks[0];
    if (!task) {
      throw new Error("Task update returned no tasks");
    }
    return { task: toAgentTask(task), updatedCount: tasks.length };
  });

const deleteTask = base
  .meta(
    mcp.tool({
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        'Delete a task permanently. For recurring tasks, scope "this" deletes one occurrence and "following" deletes it and every later one.',
      name: "delete_task",
      title: "Delete task",
    })
  )
  .input(
    z.object({
      id: z.uuidv7(),
      scope: deleteScopeSchema.default("this"),
    })
  )
  .output(z.object({ deleted: z.literal(true) }))
  .handler(async ({ input, context }) => {
    await tasksClient(context).delete(input);
    return { deleted: true as const };
  });

const listTags = base
  .meta(
    mcp.tool({
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List the user's tags. Use their IDs to filter search_tasks or set tagIds on a task.",
      name: "list_tags",
      title: "List tags",
    })
  )
  .output(
    z.object({ tags: z.array(z.object({ id: z.string(), name: z.string() })) })
  )
  .handler(async ({ context }) => {
    const tags = await createRouterClient(tagRouter, { context }).list();
    return { tags: tags.map(({ id, name }) => ({ id, name })) };
  });

export const mcpRouter = {
  createTask,
  deleteTask,
  getTask,
  listTags,
  searchTasks,
  updateTask,
};
