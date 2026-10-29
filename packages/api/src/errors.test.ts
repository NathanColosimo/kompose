import { describe, expect, test } from "bun:test";
import { createORPCClient, isDefinedError, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { oc } from "@orpc/contract";
import { implement, type RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Effect, Schema } from "effect";
import z from "zod";
import { encodeErrors } from ".";
import { errorStatusMap } from "./error-status";
import { clientErrorStatuses, clientErrors } from "./errors";
import {
  InvalidTagError,
  TagConflictError,
  TagNotFoundError,
} from "./routers/tag/errors";

class SecretError extends Schema.TaggedError<SecretError>()("SecretError", {
  cause: Schema.Unknown,
  message: Schema.String,
  tagId: Schema.String,
}) {}

const tagsContract = oc
  .errors(clientErrors(TagConflictError, TagNotFoundError, SecretError))
  .router({
    create: oc.input(z.object({ name: z.string() })).output(z.null()),
    get: oc.input(z.object({ id: z.string() })).output(z.null()),
    leak: oc.output(z.null()),
    rename: oc.output(z.null()),
    update: oc.output(z.null()),
  });

const contract = { tags: tagsContract };

// Mirrors routers/index.ts: `encodeErrors` runs once at the root, and each
// sub-router is implemented on its own and loaded lazily.
const os = implement(tagsContract);
const tags = os.router({
  create: os.create.effect(function* ({ input }) {
    return yield* new TagConflictError({ name: input.name });
  }),
  get: os.get.handler(({ input }) => {
    throw new TagNotFoundError({ tagId: input.id });
  }),
  leak: os.leak.effect(function* () {
    return yield* new SecretError({
      cause: new Error("db password is hunter2"),
      message: "Lookup failed",
      tagId: "t1",
    });
  }),
  rename: os.rename.effect(function* () {
    return yield* new InvalidTagError({ message: "not declared here" });
  }),
  update: os.update.effect(function* () {
    return yield* Effect.fail(new Error("connection reset"));
  }),
});

const app = implement(contract).use(encodeErrors);
const router = app.router({
  tags: app.tags.lazy(async () => ({ default: tags })),
});

const handler = new RPCHandler(router, {
  errorStatusMap: {
    ...errorStatusMap,
    ...clientErrorStatuses(tagsContract.create["~orpc"].errorMap),
  },
});
let lastStatus: number | undefined;
const client: RouterClient<typeof router> = createORPCClient(
  new RPCLink({
    fetch: async (url, init) => {
      const { response } = await handler.handle(
        new Request(`http://localhost${url}`, init),
        { context: {} }
      );
      lastStatus = response?.status;
      return response ?? new Response(null, { status: 404 });
    },
    url: "/",
  })
);

describe("client errors", () => {
  test("an Effect failure reaches the client as its typed error", async () => {
    const { error } = await safe(client.tags.create({ name: "Work" }));

    if (!(isDefinedError(error) && error.code === "TagConflictError")) {
      throw new Error("expected TagConflictError");
    }
    const name: string = error.data.name;
    expect(name).toBe("Work");
    expect(error.message).toBe("Tag name already exists: Work");
    expect(lastStatus).toBe(409);
  });

  test("a thrown error reaches the client as its typed error", async () => {
    const { error } = await safe(client.tags.get({ id: "t1" }));

    if (!(isDefinedError(error) && error.code === "TagNotFoundError")) {
      throw new Error("expected TagNotFoundError");
    }
    expect(error.data).toEqual({ tagId: "t1" });
    expect(error.message).toBe("Tag not found: t1");
    expect(lastStatus).toBe(404);
  });

  test("cause stays on the server", async () => {
    const { error } = await safe(client.tags.leak());

    if (!(isDefinedError(error) && error.code === "SecretError")) {
      throw new Error("expected SecretError");
    }
    expect(error.data).toEqual({ tagId: "t1" });
    expect(error.message).toBe("Lookup failed");
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(lastStatus).toBe(500);
  });

  test.each([
    ["an undeclared tagged error", () => client.tags.rename()],
    ["a plain error", () => client.tags.update()],
  ])("%s is a generic 500", async (_, call) => {
    const { error } = await safe(call());

    expect(isDefinedError(error)).toBe(false);
    expect(error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal Server Error",
    });
    expect(lastStatus).toBe(500);
  });
});

describe("errorStatusMap", () => {
  test("includes every client error the app's contracts declare", () => {
    expect(errorStatusMap).toMatchObject({
      GoogleApiError: 500,
      InvalidTagError: 400,
      NOT_FOUND: 404,
      TagConflictError: 409,
      WhoopTokenUnavailableError: 503,
    });
  });
});
