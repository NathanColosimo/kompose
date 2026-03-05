import type { LinkMeta } from "@kompose/db/schema/link";
import { implement, ORPCError } from "@orpc/server";
import { Effect, Either, Layer } from "effect";
import { requireAuth } from "../..";
import { globalRateLimit } from "../../ratelimit";
import { publishToUserBestEffort } from "../../realtime/sync";
import { LinkParserService } from "../../services/link-parser/service";
import { TelemetryLive } from "../../telemetry";
import { tagSelectSchemaWithIcon } from "../tag/contract";
import { TaskService } from "./client";
import { taskContract } from "./contract";
import type { TaskError } from "./errors";

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

const TaskLive = Layer.merge(TaskService.Default, TelemetryLive);
const LinkParserLive = Layer.merge(LinkParserService.Default, TelemetryLive);

function handleError(error: TaskError): never {
  switch (error._tag) {
    case "TaskRepositoryError":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error.message ?? "Task operation failed",
        data: { cause: error.cause },
      });
    case "TaskNotFoundError":
      throw new ORPCError("NOT_FOUND", {
        message: `Task not found: ${error.taskId}`,
      });
    case "InvalidTaskError":
      throw new ORPCError("BAD_REQUEST", {
        message: error.message,
      });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "An unexpected error occurred",
      });
  }
}

const os = implement(taskContract).use(requireAuth).use(globalRateLimit);

const normalizeTaskTags = <T extends { tags: Array<{ icon: string }> }>(
  task: T
) => ({
  ...task,
  tags: task.tags.map((tag) => tagSelectSchemaWithIcon.parse(tag)),
});

function publishTasksEvent(userId: string) {
  publishToUserBestEffort(userId, {
    type: "tasks",
    payload: {},
  });
}

export const taskRouter = os.router({
  list: os.list.handler(({ context }) => {
    return Effect.runPromise(
      TaskService.listTasks(context.user.id).pipe(
        Effect.map((tasks) => tasks.map(normalizeTaskTags)),
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: (value) => value,
          onFailure: handleError,
        })
      )
    );
  }),

  create: os.create.handler(({ input, context }) => {
    return Effect.runPromise(
      TaskService.createTask(context.user.id, {
        ...input,
        links: dedupeLinks(input.links),
        userId: context.user.id,
      }).pipe(
        Effect.map((tasks) => tasks.map(normalizeTaskTags)),
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: (value) => {
            publishTasksEvent(context.user.id);
            return value;
          },
          onFailure: handleError,
        })
      )
    );
  }),

  update: os.update.handler(({ input, context }) => {
    const task = input.task.links
      ? { ...input.task, links: dedupeLinks(input.task.links) }
      : input.task;
    return Effect.runPromise(
      TaskService.updateTask(context.user.id, input.id, task, input.scope).pipe(
        Effect.map((tasks) => tasks.map(normalizeTaskTags)),
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: (value) => {
            publishTasksEvent(context.user.id);
            return value;
          },
          onFailure: handleError,
        })
      )
    );
  }),

  delete: os.delete.handler(({ input, context }) => {
    return Effect.runPromise(
      TaskService.deleteTask(context.user.id, input.id, input.scope).pipe(
        Effect.provide(TaskLive),
        Effect.match({
          onSuccess: () => {
            publishTasksEvent(context.user.id);
            return null;
          },
          onFailure: handleError,
        })
      )
    );
  }),

  parseLink: os.parseLink.handler(async ({ input }) => {
    const result = await Effect.runPromise(
      LinkParserService.parseLink(input.url).pipe(
        Effect.provide(LinkParserLive),
        Effect.either
      )
    );

    if (Either.isLeft(result)) {
      throw new ORPCError("BAD_REQUEST", {
        message: result.left.message,
        data: { url: result.left.url },
      });
    }

    return result.right;
  }),
});
