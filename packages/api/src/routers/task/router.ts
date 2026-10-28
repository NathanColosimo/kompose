import type { LinkMeta } from "@kompose/db/schema/link";
import { implement, ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { mapErrors, requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { publishToUser } from "../../realtime/sync";
import { LinkParserService } from "../../services/link-parser/service";
import { LinkParseError } from "../../services/link-parser/types";
import { tagSelectSchemaWithIcon } from "../tag/contract";
import { TaskService } from "./client";
import { taskContract } from "./contract";
import { InvalidTaskError, TaskNotFoundError } from "./errors";

/** Deduplicate links by URL — later entries win when URLs collide */
function dedupeLinks(links: LinkMeta[] | undefined): LinkMeta[] | undefined {
  if (!links || links.length <= 1) {
    return links;
  }
  const map = new Map<string, LinkMeta>();
  for (const link of links) {
    map.set(link.url, link);
  }
  return [...map.values()];
}

function toORPCError(error: unknown) {
  if (error instanceof InvalidTaskError) {
    return new ORPCError("BAD_REQUEST", {
      cause: error,
      message: error.message,
    });
  }
  if (error instanceof LinkParseError) {
    return new ORPCError("BAD_REQUEST", {
      cause: error,
      data: { url: error.url },
      message: error.message,
    });
  }
  if (error instanceof TaskNotFoundError) {
    return new ORPCError("NOT_FOUND", {
      cause: error,
      message: `Task not found: ${error.taskId}`,
    });
  }
  return error;
}

const os = implement(taskContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit)
  .use(mapErrors(toORPCError));

const normalizeTaskTags = <T extends { tags: Array<{ icon: string }> }>(
  task: T
) => ({
  ...task,
  tags: task.tags.map((tag) => tagSelectSchemaWithIcon.parse(tag)),
});

function publishTasksEvent(userId: string) {
  return publishToUser(userId, {
    payload: {},
    type: "tasks",
  }).pipe(Effect.catch(() => Effect.void));
}

export const taskRouter = os.router({
  create: os.create.effect(function* ({ input, context }) {
    const tasks = yield* TaskService.use((service) =>
      service.createTask(context.user.id, {
        ...input,
        links: dedupeLinks(input.links),
        userId: context.user.id,
      })
    );
    yield* publishTasksEvent(context.user.id);
    return tasks.map(normalizeTaskTags);
  }),

  delete: os.delete.effect(function* ({ input, context }) {
    yield* TaskService.use((service) =>
      service.deleteTask(context.user.id, input.id, input.scope)
    );
    yield* publishTasksEvent(context.user.id);
    return null;
  }),

  list: os.list.effect(function* ({ context }) {
    const tasks = yield* TaskService.use((service) =>
      service.listTasks(context.user.id)
    );
    return tasks.map(normalizeTaskTags);
  }),

  parseLink: os.parseLink.effect(function* ({ input }) {
    return yield* LinkParserService.use((service) =>
      service.parseLink(input.url)
    );
  }),

  update: os.update.effect(function* ({ input, context }) {
    const task = input.task.links
      ? { ...input.task, links: dedupeLinks(input.task.links) }
      : input.task;
    const tasks = yield* TaskService.use((service) =>
      service.updateTask(context.user.id, input.id, task, input.scope)
    );
    yield* publishTasksEvent(context.user.id);
    return tasks.map(normalizeTaskTags);
  }),
});
