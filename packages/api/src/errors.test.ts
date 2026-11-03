import { describe, expect, test } from "bun:test";
import "@orpc/effect/extensions/effect";
import { GoogleApiError } from "@kompose/google-cal/client";
import { WhoopApiError } from "@kompose/whoop/errors";
import { createORPCClient, ORPCError, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { oc } from "@orpc/contract";
import { implement, type RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Effect, Schema } from "effect";
import z from "zod";
import { publicErrorOf, sendPublicErrors } from "./errors";
import { TagConflictError, TagNotFoundError } from "./routers/tag/errors";

class SecretError extends Schema.TaggedError<SecretError>()("SecretError", {
  cause: Schema.Unknown,
  message: Schema.String,
}) {}

const contract = {
  tags: oc.router({
    create: oc.input(z.object({ name: z.string() })).output(z.null()),
    get: oc.output(z.null()),
    leak: oc.output(z.null()),
    signIn: oc.output(z.null()),
  }),
};

// Mirrors routers/index.ts: the middleware runs once at the root, and each
// sub-router is implemented on its own and loaded lazily.
const os = implement(contract.tags);
const tags = os.router({
  create: os.create.effect(function* ({ input }) {
    return yield* new TagConflictError({ name: input.name });
  }),
  get: os.get.handler(() => {
    throw new TagNotFoundError({ tagId: "t1" });
  }),
  leak: os.leak.effect(function* () {
    return yield* Effect.fail(
      new SecretError({
        cause: new Error("db password is hunter2"),
        message: "Lookup failed for hunter2",
      })
    );
  }),
  signIn: os.signIn.handler(() => {
    throw new ORPCError("UNAUTHORIZED", { message: "User not found" });
  }),
});

const app = implement(contract).use(sendPublicErrors);
const router = app.router({
  tags: app.tags.lazy(async () => ({ default: tags })),
});

const handler = new RPCHandler(router);
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

describe("sendPublicErrors", () => {
  test("an Effect failure is sent with its public code and message", async () => {
    const { error } = await safe(client.tags.create({ name: "Work" }));

    expect(error).toMatchObject({
      code: "CONFLICT",
      message: 'A tag named "Work" already exists.',
    });
    expect(lastStatus).toBe(409);
  });

  test("a thrown error is sent with its public code and message", async () => {
    const { error } = await safe(client.tags.get());

    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "Tag not found.",
    });
    expect(lastStatus).toBe(404);
  });

  test("an error without publicError is a generic 500", async () => {
    const { error } = await safe(client.tags.leak());

    expect(error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal Server Error",
    });
    expect(JSON.stringify(error)).not.toContain("hunter2");
    expect(lastStatus).toBe(500);
  });

  test("an ORPCError is sent unchanged", async () => {
    const { error } = await safe(client.tags.signIn());

    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "User not found",
    });
    expect(lastStatus).toBe(401);
  });
});

describe("publicErrorOf", () => {
  // These packages can't import `PublicError`, so their codes aren't type-checked.
  test.each([
    ["GoogleApiError", new GoogleApiError({ cause: null })],
    [
      "WhoopApiError",
      new WhoopApiError({
        cause: null,
        message: "",
        operation: "",
        status: null,
      }),
    ],
  ])("%s has a valid public code", (_, error) => {
    expect(publicErrorOf(error)?.code).toBe("BAD_GATEWAY");
  });

  test("ignores an invalid code", () => {
    const error = Object.assign(new Error("x"), {
      publicError: { code: "NOT_A_CODE", message: "x" },
    });
    expect(publicErrorOf(error)).toBeUndefined();
  });
});
