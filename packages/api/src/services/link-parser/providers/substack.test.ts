import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { substackResolver } from "./substack";

const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

const post = {
  canonical_url: "https://example.substack.com/p/hello",
  comment_count: 0,
  description: "A post",
  id: 42,
  post_date: "2026-01-01T00:00:00.000Z",
  publication_id: 7,
  reaction_count: 0,
  slug: "hello",
  title: "Hello",
  type: "newsletter",
  wordcount: 2380,
};
const publication = {
  author_id: 1,
  id: 7,
  name: "Example",
  subdomain: "example",
};

/** Answers each URL in `routes` with its JSON, and anything else with 404. */
const serve = (routes: Record<string, unknown>) =>
  fetchSpy.mockImplementation(
    Object.assign(
      (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        return Promise.resolve(
          url in routes
            ? Response.json(routes[url])
            : new Response("missing", { status: 404 })
        );
      },
      { preconnect: fetch.preconnect }
    )
  );

test("a /p/<slug> link asks the publication for the post's ID, then reads the post by ID", async () => {
  serve({
    "https://example.substack.com/api/v1/posts/hello": { id: 42 },
    "https://substack.com/api/v1/posts/by-id/42": { post, publication },
  });
  const meta = await Effect.runPromise(
    substackResolver.resolve("https://example.substack.com/p/hello")
  );
  expect(meta).toMatchObject({
    authorName: "Example",
    durationSeconds: 900,
    title: "Hello",
    wordCount: 2380,
  });
});

test("a link with a post ID reads the post in one request", async () => {
  serve({
    "https://substack.com/api/v1/posts/by-id/42": { post, publication },
  });
  const meta = await Effect.runPromise(
    substackResolver.resolve("https://substack.com/home/post/p-42")
  );
  expect(meta.title).toBe("Hello");
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
