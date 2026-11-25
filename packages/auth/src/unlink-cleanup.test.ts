import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { Account } from "better-auth";
import { Layer, ManagedRuntime } from "effect";

// The cleanups under test use no database, so they run on a runtime without
// one. The real one needs DATABASE_URL to build.
process.env.SKIP_ENV_VALIDATION ??= "1";
mock.module("./runtime", () => ({
  authRuntime: ManagedRuntime.make(Layer.empty),
}));
const { cleanUpBeforeUnlink } = await import("./unlink-cleanup");

const fetchSpy = spyOn(globalThis, "fetch");
const getAccessToken = mock(() => Promise.resolve("whoop-access-token"));
afterEach(() => {
  fetchSpy.mockReset();
  getAccessToken.mockClear();
});

const account = (providerId: string) =>
  ({ id: "account-row", providerId }) as Account;

test("unlinking a WHOOP account revokes its access at WHOOP", async () => {
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));

  await cleanUpBeforeUnlink(account("whoop"), getAccessToken);

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0] ?? [];
  expect(String(url)).toBe(
    "https://api.prod.whoop.com/developer/v2/user/access"
  );
  expect(init).toEqual({
    headers: { Authorization: "Bearer whoop-access-token" },
    method: "DELETE",
  });
});

test("a cleanup the provider refuses doesn't stop the unlink", async () => {
  fetchSpy.mockResolvedValue(new Response("nope", { status: 401 }));

  await cleanUpBeforeUnlink(account("whoop"), getAccessToken);

  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("an account whose provider has no cleanup asks for no token", async () => {
  await cleanUpBeforeUnlink(account("apple"), getAccessToken);

  expect(getAccessToken).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});
