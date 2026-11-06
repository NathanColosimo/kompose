import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Exit } from "effect";
import { fetchText, publicOnlyLookup } from "./link-resolver";

describe("publicOnlyLookup", () => {
  const lookup = (hostname: string) =>
    new Promise<unknown>((resolve, reject) =>
      publicOnlyLookup(hostname, { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses)
      )
    );

  test("passes public addresses through", async () => {
    expect(await lookup("8.8.8.8")).toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);
  });

  // localhost resolves through /etc/hosts, so no network is needed.
  test.each(["localhost", "127.0.0.1", "::ffff:169.254.169.254"])(
    "refuses %s",
    async (hostname) => {
      await expect(lookup(hostname)).rejects.toThrow();
    }
  );
});

describe("fetchText", () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  afterEach(() => fetchSpy.mockReset());
  afterAll(() => fetchSpy.mockRestore());

  /** Public IP literals stand in for hosts, so no DNS is involved. */
  const serve = (routes: Record<string, () => Response>) =>
    fetchSpy.mockImplementation(
      Object.assign(
        (input: Parameters<typeof fetch>[0]) => {
          const route = routes[String(input)];
          return Promise.resolve(
            route ? route() : new Response("missing", { status: 404 })
          );
        },
        { preconnect: fetch.preconnect }
      )
    );
  const redirect = (location: string) => () =>
    new Response(null, { headers: { Location: location }, status: 302 });
  const run = (url: string) =>
    Effect.runPromiseExit(fetchText({ label: "Page", link: url, url }));

  test("follows a redirect to another public address", async () => {
    serve({
      "https://1.1.1.1/page": () => new Response("ok"),
      "https://8.8.8.8/": redirect("https://1.1.1.1/page"),
    });
    expect(await run("https://8.8.8.8/")).toEqual(Exit.succeed("ok"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test.each([
    "http://169.254.169.254/latest/meta-data",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd12::1]/",
    "http://localhost:3000/",
    "http://metadata.google.internal/",
    "file:///etc/passwd",
  ])("doesn't follow a redirect to %s", async (location) => {
    serve({ "https://8.8.8.8/": redirect(location) });
    expect(Exit.isFailure(await run("https://8.8.8.8/"))).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test.each(["http://127.0.0.1:3000/", "http://[::1]/", "ftp://8.8.8.8/"])(
    "doesn't fetch %s",
    async (url) => {
      serve({});
      expect(Exit.isFailure(await run(url))).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  test("gives up after five redirects", async () => {
    serve({ "https://8.8.8.8/": redirect("/") });
    expect(Exit.isFailure(await run("https://8.8.8.8/"))).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});
