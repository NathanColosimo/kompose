import { beforeEach, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth, testUtils } from "better-auth/plugins";
import { validateSignInProvider } from "./sign-in-providers";

const BASE_URL = "http://localhost:3000";
const SETTINGS_URL = `${BASE_URL}/dashboard/settings`;

interface Row {
  id: string;
  [column: string]: unknown;
}

// The memory adapter replaces a table's array on a write, so read through this.
const database: Record<"account" | "session" | "user" | "verification", Row[]> =
  { account: [], session: [], user: [], verification: [] };

const ada = {
  createdAt: new Date(),
  email: "ada@example.com",
  emailVerified: true,
  id: "user-ada",
  name: "Ada",
  updatedAt: new Date(),
};

function linkedAccount(providerId: string, accountId: string): Row {
  return {
    accountId,
    createdAt: new Date(),
    id: `${providerId}-${accountId}`,
    providerId,
    updatedAt: new Date(),
    userId: ada.id,
  };
}

/** Ada, who signs in with Google. */
beforeEach(() => {
  database.account = [linkedAccount("google", "google-ada")];
  database.session = [];
  database.user = [ada];
  database.verification = [];
});

/** Who WHOOP says came back from its consent screen. */
let whoopProfile = { email: "ada@example.com", id: "whoop-ada" };

/** Better Auth with Kompose's sign-in rule and WHOOP, on an in-memory database. */
const auth = betterAuth({
  account: {
    accountLinking: {
      allowDifferentEmails: true,
      enabled: true,
      trustedProviders: ["google", "apple"],
    },
  },
  baseURL: BASE_URL,
  database: memoryAdapter(database),
  plugins: [
    genericOAuth({
      config: [
        {
          authorizationUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
          clientId: "test-client",
          clientSecret: "test-secret",
          disableSignUp: true,
          // Stands in for WHOOP's token and profile endpoints.
          getToken: () => Promise.resolve({ accessToken: "whoop-access" }),
          getUserInfo: () =>
            Promise.resolve({ ...whoopProfile, emailVerified: true }),
          providerId: "whoop",
        },
      ],
    }),
    testUtils(),
  ],
  secret: "test-secret-that-is-at-least-32-characters",
  user: { validateUserInfo: validateSignInProvider },
});

async function signedInAsAda(): Promise<Headers> {
  const { test: helpers } = await auth.$context;
  return helpers.getAuthHeaders({ userId: ada.id });
}

function post(path: string, body: object, headers?: Headers) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  requestHeaders.set("origin", BASE_URL);
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: requestHeaders,
      method: "POST",
    })
  );
}

/** Starts at `path`, approves at WHOOP, and returns Better Auth's answer to the callback. */
async function returnFromWhoop(
  path: "/sign-in/social" | "/link-social",
  headers?: Headers
): Promise<Response> {
  const started = await post(
    path,
    {
      callbackURL: SETTINGS_URL,
      errorCallbackURL: SETTINGS_URL,
      provider: "whoop",
    },
    headers
  );
  const { url } = (await started.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  const stateCookies = started.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  return auth.handler(
    new Request(
      `${BASE_URL}/api/auth/callback/whoop?code=test-code&state=${state}`,
      { headers: { cookie: stateCookies } }
    )
  );
}

test("a linked WHOOP account can't sign in", async () => {
  database.account.push(linkedAccount("whoop", "whoop-ada"));

  const callback = await returnFromWhoop("/sign-in/social");

  expect(callback.headers.get("location")).toContain(
    "error=provider_cannot_sign_in"
  );
  expect(callback.headers.get("set-cookie")).not.toContain("session_token");
  expect(database.session).toEqual([]);
});

test("a WHOOP account with a user's email isn't linked to that user", async () => {
  whoopProfile = { email: ada.email, id: "whoop-someone-else" };

  const callback = await returnFromWhoop("/sign-in/social");

  expect(callback.headers.get("location")).toContain(
    "error=provider_cannot_sign_in"
  );
  expect(database.session).toEqual([]);
  expect(database.account).toMatchObject([{ providerId: "google" }]);
});

test("a signed-in user links WHOOP", async () => {
  whoopProfile = { email: "ada@whoop.example", id: "whoop-ada" };

  const callback = await returnFromWhoop("/link-social", await signedInAsAda());

  expect(callback.headers.get("location")).toBe(SETTINGS_URL);
  expect(database.account).toMatchObject([
    { providerId: "google" },
    { accountId: "whoop-ada", providerId: "whoop", userId: ada.id },
  ]);
});
