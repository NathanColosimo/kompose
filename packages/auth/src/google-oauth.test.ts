import { expect, spyOn, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { testUtils } from "better-auth/plugins";
import { googleLinkConsent } from "./google-oauth";

const BASE_URL = "http://localhost:3000";

// The memory adapter replaces a table's array on a write, so read through this.
const database = {
  account: [] as unknown[],
  session: [],
  user: [],
  verification: [],
};

/** Better Auth with Kompose's Google options, on an in-memory database. */
const auth = betterAuth({
  baseURL: BASE_URL,
  database: memoryAdapter(database),
  plugins: [googleLinkConsent(), testUtils()],
  secret: "test-secret-that-is-at-least-32-characters",
  socialProviders: {
    google: {
      accessType: "offline",
      clientId: "test-client",
      clientSecret: "test-secret",
    },
  },
});

/** Starts a Google authorization the way the apps do. */
async function startGoogle(
  path: "/sign-in/social" | "/link-social",
  headers = new Headers()
) {
  headers.set("content-type", "application/json");
  headers.set("origin", BASE_URL);
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify({ provider: "google" }),
      headers,
      method: "POST",
    })
  );
  const { url } = (await response.json()) as { url: string };
  return { googleUrl: new URL(url), response };
}

test("linking asks Google for the account chooser and consent", async () => {
  const { test: helpers } = await auth.$context;
  const user = await helpers.saveUser(helpers.createUser());

  const { googleUrl } = await startGoogle(
    "/link-social",
    await helpers.getAuthHeaders({ userId: user.id })
  );

  expect(googleUrl.searchParams.get("prompt")).toBe("select_account consent");
});

test("a sign-in that returns no refresh token keeps the stored one", async () => {
  const googleTokenEndpoint = spyOn(globalThis, "fetch");
  const claims = { email: "ada@example.com", email_verified: true, sub: "ada" };
  const idToken = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

  /** A whole sign-in, where Google answers the code exchange with `tokens`. */
  const signIn = async (tokens: Record<string, string>) => {
    googleTokenEndpoint.mockResolvedValueOnce(
      Response.json({ ...tokens, expires_in: 3600, id_token: idToken })
    );
    const { googleUrl, response } = await startGoogle("/sign-in/social");
    const state = googleUrl.searchParams.get("state");
    const cookie = response.headers
      .getSetCookie()
      .map((setCookie) => setCookie.split(";")[0])
      .join("; ");
    await auth.handler(
      new Request(
        `${BASE_URL}/api/auth/callback/google?code=test-code&state=${state}`,
        { headers: { cookie } }
      )
    );
  };

  // Google sends a refresh token with the first consent, and none after it.
  await signIn({ access_token: "access-1", refresh_token: "refresh-1" });
  await signIn({ access_token: "access-2" });
  googleTokenEndpoint.mockRestore();

  expect(database.account).toMatchObject([
    { accessToken: "access-2", refreshToken: "refresh-1" },
  ]);
});
