import type { LinkMeta } from "@kompose/db/schema/link";
import { implement, ORPCError } from "@orpc/server";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Match } from "effect";
import { mapErrors, requireAuth } from "../..";
import type { Context } from "../../context";
import { globalRateLimit } from "../../ratelimit";
import { publishToUser } from "../../realtime/sync";
import { LinkParserService } from "../../services/link-parser/service";
import type { LinkParseError } from "../../services/link-parser/types";
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

function toORPCError(
  error: TaskError | LinkParseError | EffectDrizzleQueryError
) {
  return Match.valueTags(error, {
    EffectDrizzleQueryError: (e) =>
      new ORPCError("INTERNAL_SERVER_ERROR", { cause: e }),
    InvalidTaskError: (e) =>
      new ORPCError("BAD_REQUEST", {
        cause: e,
        message: e.message,
      }),
    LinkParseError: (e) =>
      new ORPCError("BAD_REQUEST", {
        cause: e,
        data: { url: e.url },
        message: e.message,
      }),
    TaskNotFoundError: (e) =>
      new ORPCError("NOT_FOUND", {
        cause: e,
        message: `Task not found: ${e.taskId}`,
      }),
  });
}

const handler = mapErrors(toORPCError);

const os = implement(taskContract)
  .$context<Context>()
  .use(requireAuth)
  .use(globalRateLimit);

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
  create: os.create.effect(
    handler(function* ({ input, context }) {
      const tasks = yield* TaskService.use((service) =>
        service.createTask(context.user.id, {
          ...input,
          links: dedupeLinks(input.links),
          userId: context.user.id,
        })
      );
      yield* publishTasksEvent(context.user.id);
      return tasks.map(normalizeTaskTags);
    })
  ),

  delete: os.delete.effect(
    handler(function* ({ input, context }) {
      yield* TaskService.use((service) =>
        service.deleteTask(context.user.id, input.id, input.scope)
      );
      yield* publishTasksEvent(context.user.id);
      return null;
    })
  ),

  list: os.list.effect(
    handler(function* ({ context }) {
      const tasks = yield* TaskService.use((service) =>
        service.listTasks(context.user.id)
      );
      return tasks.map(normalizeTaskTags);
    })
  ),

  parseLink: os.parseLink.effect(
    handler(function* ({ input }) {
      return yield* LinkParserService.use((service) =>
        service.parseLink(input.url)
      );
    })
  ),

  update: os.update.effect(
    handler(function* ({ input, context }) {
      const task = input.task.links
        ? { ...input.task, links: dedupeLinks(input.task.links) }
        : input.task;
      const tasks = yield* TaskService.use((service) =>
        service.updateTask(context.user.id, input.id, task, input.scope)
      );
      yield* publishTasksEvent(context.user.id);
      return tasks.map(normalizeTaskTags);
    })
  ),
});
