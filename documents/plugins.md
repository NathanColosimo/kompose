# Plugins

A **plugin** is an outside service a user links an account to. Today that is Google Calendar and WHOOP; later Outlook, Linear, Notion, Zoom.

Every plugin is built into the app. Nothing is loaded at runtime.

The plugin system is only the part every such service needs:

| Shared part | What it does |
| --- | --- |
| The list | Names each plugin and the sign-in provider that links it |
| Connections | One row per linked account, with its status |
| Tokens | Encrypts each account's tokens and refreshes them safely |
| Webhooks | One route that receives calls from outside services |
| Unlinking | One hook that runs a plugin's cleanup at its provider |

Everything else about a service is ordinary code that belongs to it: the router that fetches its data, its state, and the components that draw it.

## The rule for shared code

Shared code needs two users. A feature with one implementation stays plain code, and the shared shape is designed from the two real cases when the second one arrives.

So these are not plugins, and have no plugin interface:

| Feature | Why | Where it lives |
| --- | --- | --- |
| Link previews (Spotify, YouTube, Substack) | Nothing to link: they use Kompose's own keys, and a user never sees them as a choice | The link parser's own list of providers. See [`link-parsing.md`](./link-parsing.md) |
| Place search | One provider, with Kompose's key | The `maps` router. See [`maps.md`](./maps.md) |
| Meeting links | One table of hosts | `packages/state/src/meeting.ts`. See [`meeting-links.md`](./meeting-links.md) |
| Creating a Meet link | Part of writing a Google Calendar event | `buildGoogleMeetConferenceData` in `packages/state/src/meeting.ts` |

A service can be a plugin and also be in one of these lists. When a preview needs the user's own account, such as a private GitHub pull request or a private Notion page, that service is a plugin for the linked account, and its entry in the link parser's list fetches with that account's token. Spotify, YouTube, and Substack stay in the list only. No preview needs an account yet, so the link parser takes only the URL today.

## The list

`packages/plugins/src/index.ts` (`@kompose/plugins`) holds one object per plugin: `id`, `name`, `description`, `provider` (the Better Auth provider whose accounts link it), and `multipleAccounts`. It depends only on zod, so web, native, and the server all import it.

The `id` is stored in `connection.plugin_id` and is the last part of the plugin's webhook URL. Every ID is declared once, in `pluginIds` at the top of that file, and every provider once, in `pluginProviders`. Nothing else spells them out as plain strings:

| Where | How it is held to the lists |
| --- | --- |
| TypeScript, on the server and in both apps | The `PluginId` and `PluginProvider` types. A misspelt ID does not compile |
| Writes to the database | `connection.plugin_id` and `webhook_subscription.provider` are text columns that Drizzle types from the lists (`text("plugin_id", { enum: pluginIds })`), so a query that writes or filters on any other value does not compile |
| Strings from outside, such as the webhook URL | `pluginIdSchema` and `pluginProviderSchema` |
| The API | The connection contract is derived from the table, so `pluginId` is a `PluginId` in the apps too |

The columns stay text on purpose: a new plugin needs no migration. Postgres itself accepts any string, so SQL written by hand is not checked.

Better Auth types an account's `providerId` as a plain string. To ask whether an account belongs to a plugin, use `getPluginForProvider(account.providerId)?.id === "google-calendar"`, which the compiler checks.

Every plugin links by OAuth today. [Other ways to connect](#later-connecting-without-oauth) are planned, not built.

## Connections

One `connection` table for every plugin: `id`, `userId`, `pluginId`, `accountId` (the Better Auth `account` row; unique, cascades on unlink), `status` (`active` or `needs-reauth`), and the account's profile (`email`, `name`, `image`, `profile_updated_at`).

- **Linking:** `connectLinkedAccount` in `packages/auth/src/connections.ts` is a Better Auth `account.create.after` hook. It adds a row whenever an account from a plugin's provider is linked.
- **One account:** a plugin with `multipleAccounts: false` (WHOOP) keeps the user's first account. `refuseExtraAccount` (`packages/auth/src/account-rules.ts`) is the `account.create.before` hook: a link that would add a second account fails with `unable_to_link_account`. Reconnect updates the account the user already has. It doesn't order two links that finish at the same moment, and a user with several accounts from before this rule keeps them until they unlink the extras.
- **Unlinking:** deletes the account row, and the connection with it. The plugin's [unlink cleanup](#unlinking) runs first.
- **Existing accounts:** the migration that creates the table adds rows for the Google and WHOOP accounts linked before it.

Columns are added by the first plugin that needs them.

### Unlinking

Some services should be told when a user unlinks: to stop sending webhooks, or to end the access the user granted. A plugin does that in an **unlink cleanup**, one function listed in `unlinkCleanups` in `packages/auth/src/unlink-cleanup.ts`, keyed by `PluginId`:

```ts
type UnlinkCleanup = (
  account: Account,
  accessToken: Effect.Effect<string, unknown>
) => Effect.Effect<void, unknown, Database>;
```

- **It runs before the account row is deleted,** from Better Auth's `account.delete.before` hook, so the account's token still exists. `accessToken` fetches it only when the cleanup uses it.
- **A cleanup that fails, or takes over 10 seconds, doesn't stop the unlink.** It is logged as `PLUGIN_UNLINK_CLEANUP_FAILED` with the plugin's ID.
- **It runs on `authRuntime`** (`packages/auth/src/runtime.ts`), which has the `Database` service and shares the API's Postgres pool. Better Auth serves the unlink route itself, so the API's `appRuntime` and its services aren't there, and `@kompose/api` imports `@kompose/auth`, not the other way round.
- **A plugin with nothing to tell its provider has no entry.**

Cleanups today:

| Plugin | What it does |
| --- | --- |
| `google-calendar` | Stops the account's watch channels, so Google stops calling for its calendars |
| `whoop` | Revokes the user's access at WHOOP, which also stops WHOOP's calls for that user |

## Sign-in providers

A user signs in to Kompose with Google or Apple only (`signInProviders` in `packages/auth/src/account-rules.ts`). An account from any other provider only connects a plugin, and so does a new plugin's provider unless it is added to that list.

- **It can't sign in.** Better Auth asks `validateSignInProvider` (its `user.validateUserInfo` option) on the OAuth callback, before an account signs in, signs up, or is linked. A plugin-only account passes only when a signed-in user started the link. So a WHOOP account never opens a session, and one with a Kompose user's email isn't linked to that user.
- **It doesn't count as a way back in.** Better Auth refuses to unlink a user's last account. `keepSignInAccount` also refuses to unlink the last account they can sign in with (`FAILED_TO_UNLINK_LAST_SIGN_IN_ACCOUNT`).

## Profiles

Better Auth doesn't store a linked account's name, email, or picture. `accountInfo` works them out on every call: for Google from the ID token the last token refresh returned, and for WHOOP with a request to WHOOP. So the profile is copied onto the connection, and `plugins.connections` (`packages/api/src/routers/plugins/router.ts`) keeps it fresh:

- **First read:** a connection with no `profile_updated_at` has never been fetched. The request asks the provider once, through `accountInfo`, and stores the answer.
- **Every later read** answers from the row and asks no provider.
- **After a day:** the request still answers from the row. It then fetches the profile again after the reply is sent (`waitUntil`), in its own `Plugins.refreshProfiles` trace, so the next read has it.
- **`profile_updated_at` is when the profile was last written.** A failed lookup keeps what is stored and leaves the time alone, so the next read tries again.
- **A `needs-reauth` connection isn't asked,** because its token no longer works. It is fetched again once the user reconnects it.
- **The calendar account menus read the same request** (`usePluginConnectionsQuery` in `@kompose/state`), so every account's name costs one request shared with Settings. Clients keep the answer for five minutes, and refetch at once after linking or unlinking. The apps no longer call Better Auth's `/account-info`; the route stays on for app versions that still do.

## Settings

Web (`plugin-connections-settings.tsx`) and native (`plugin-connections-section.tsx`) draw one section per plugin from the list, with the accounts linked to it. Both use `usePluginConnections` in `@kompose/state`.

- `plugins.connections` returns each connection with the account's name, email, and picture, read from the `connection` row in one query. See [Profiles](#profiles).
- **Link account** calls `linkSocial` with the plugin's provider. A plugin that allows one account hides it once it has one.
- **Unlink** unlinks the Better Auth account.
- **Reconnect** shows on a connection that is `needs-reauth`, and links the same account again.

## Tokens

Better Auth stores each account's tokens and refreshes them when a caller asks for one with `auth.api.getAccessToken`. Kompose adds three things:

- **Encryption:** `account.encryptOAuthTokens` is on. Better Auth encrypts with `BETTER_AUTH_SECRET` and still reads plaintext rows. A row stored before encryption is encrypted at its next refresh, so there is no backfill to run. An account nobody uses again stays plaintext. Better Auth treats any even-length hex string as encrypted, so a provider whose tokens are pure hex can't have plaintext rows.
- **A lock on refresh:** Better Auth's refresh takes no lock ([better-auth#11561](https://github.com/better-auth/better-auth/issues/11561)). Two requests that find an expired token both refresh with the same refresh token. WHOOP's refresh tokens work once, so it refuses the second request.
- **`needs-reauth`:** Better Auth's refresh drops the provider's error ([better-auth#12453](https://github.com/better-auth/better-auth/issues/12453)), so a revoked grant looks like any other failure.

`pluginOAuthTokens` (`packages/auth/src/oauth-tokens.ts`) is a Better Auth plugin that adds the last two for every plugin provider. It runs before Better Auth's `/get-access-token` and `/account-info`:

1. An access token more than 30 seconds from expiry is left alone, without a lock.
2. Otherwise it locks the account row, checks again, and refreshes with the provider's own `refreshAccessToken` from Better Auth. The token URL, client credentials, and extra parameters all come from the provider's Better Auth config, so a new plugin adds nothing here.
3. When the provider answers `invalid_grant`, the connection becomes `needs-reauth` and Settings shows Reconnect.

Better Auth then answers the request. It refreshes only within 5 seconds of expiry, so it finds a valid token and returns it.

- **`/refresh-token` is in `disabledPaths`.** It always refreshes, without the lock. Don't call `auth.api.refreshToken` on the server either.
- **A failed refresh is a `BAD_REQUEST` `APIError`.** `getLinkedAccessToken` turns any of them into the same "reconnect it in Settings" error.
- **Reconnecting** updates the account, and the `account.update.after` hook sets the connection back to `active`.
- **When both Better Auth issues are fixed,** delete `oauth-tokens.ts` and mark `needs-reauth` from the error Better Auth then reports.

## Webhooks

One route receives every plugin's calls: `/api/webhooks/<source>` (`apps/web/src/app/api/webhooks/[source]/route.ts`), where `<source>` is the plugin's ID.

A handler is one function, listed in `webhookHandlers` in `packages/api/src/webhooks/receive.ts`. The list is keyed by `PluginId`, so a handler can only be added for a plugin in the list:

```ts
type WebhookHandler = (request: Request) => WebhookResult | Promise<WebhookResult>;

interface WebhookResult {
  /** Sent to the service right away. */
  response: Response;
  /** Runs after the response is sent. */
  work?: Effect.Effect<void, unknown, AppServices>;
}
```

- **The handler gets the raw `Request`.** Services sign the exact bytes of the body, so the route never parses it first.
- **It checks the call and returns the reply.** Some services need a particular reply, such as a challenge echoed back.
- **Slow work goes in `work`.** The route runs it after the reply is sent, because services stop waiting after a few seconds (Microsoft after about three) and send the call again.
- **`GET` and `POST` both reach the handler.** Some services verify a new URL with a `GET`.

The route does the rest, the same way for every source: a source that isn't a plugin ID, or a plugin with no handler, gets a 404, and `work` runs in its own trace (a `Webhook.work` span) with its failures logged as `WEBHOOK_WORK_FAILED`.

Handlers today:

| Source | Checks | Work |
| --- | --- | --- |
| `google-calendar` | The channel token header | Finds the watched calendar, clears its cache, and tells the user's clients to refetch |
| `whoop` | WHOOP's signature over the raw body | Reads the changed record from WHOOP, clears the cached days it can be on for the account linked to that WHOOP user, and tells the user's clients to refetch. See [`whoop.md`](./whoop.md#webhooks) |

Work usually ends with `publishToUser`, which sends a realtime event to the user's open clients. Each kind of data has its own event type in `packages/api/src/realtime/events.ts`.

Not built, because nothing needs them yet: a shared signature check (WHOOP's is the only one, so it lives in its handler; share it when a second service signs the same way), and a per-connection URL (Google, Microsoft and WHOOP name the subscription or user in the call itself).

## Adding a plugin

1. Add its ID to `pluginIds`, its provider to `pluginProviders`, and its entry to `plugins`, all in `packages/plugins/src/index.ts`.
2. Add its OAuth provider to Better Auth in `packages/auth/src/index.ts`.
3. If the service sends webhooks, write a handler and add it to `webhookHandlers`.
4. If the service should be told when a user unlinks, add its cleanup to `unlinkCleanups`.
5. Write its router, state, and components like any other feature.

Settings, connections, encryption, token refresh, the webhook route, and the unlink hook need no changes.

## Later: one table per kind of data

When two plugins bring the same kind of data, both write it into one Kompose table, and screens read the table. The table is the whole contract: a screen never calls a plugin, and adding a second calendar provider changes no screen.

Tasks already work this way: a task is a row in `task` wherever it came from. A Linear or Notion plugin writes tasks; it doesn't get its own task list.

Calendar events and health numbers don't yet. Google Calendar and WHOOP each serve their own data through their own router, cached in Redis. They move to shared tables when the second provider of that kind is built, in this order:

1. Build the table and move the existing plugin onto it.
2. Add the second plugin, which only has to write rows.

The sketch below records what was already decided. Check it against the real second provider before building.

- **Every row:** a Kompose `uuidv7` ID, its `connectionId`, a unique `(connectionId, externalId)`, and `providerData` that only the owning plugin reads, for writing back without losing fields.
- **`calendar`:** `name`, `color`, `isPrimary`, `canEdit`, `visible`, `syncCursor`.
- **`calendar_event`:** `title`, `description` (sanitized HTML), `location`, start and end (UTC with a time zone, or dates for all-day), `status`, `showAs`, `color`, `conference`, `attendees`, `recurrence` as RFC 5545 strings, `canEdit`, `externalUrl`.
- **`day_metric`:** `date`, `metric`, `value`, `unit`, with metric names Kompose owns (`recovery_score`, `sleep_duration_min`, `steps`).
- **`activity`:** things that happened and can't be edited (sleep, workout): `kind`, `title`, `startAt`, `endAt`.
- **Edits** go to the provider first, and the row is updated from the provider's answer.
- **Syncs** run on webhooks, when the app connects, and when a screen reads a range that is missing or stale. There is no cron.

How a stat is drawn (label, color, icon) is client code, not a table.

## Later: connecting without OAuth

Not built. The ways a service can connect that are known so far, and what each one changes:

| Way to connect | Example | What changes |
| --- | --- | --- |
| OAuth | Google Calendar, WHOOP | Nothing. This is what exists |
| Data sent from the user's phone | Apple Health | No account, tokens, or webhooks. The connection is made on the phone, and the data has to be stored |
| A password or key the user pastes | iCloud calendar (an app password) | An encrypted credential on the connection, and a form in Settings in place of a sign-in redirect |

The plugin list entry becomes a union on how it links: `{ kind: "oauth", provider }` today, with one more member per new way. Settings, connections, and tokens branch on that one field.

### Apple Health

Planned next. Apple has no server API for health data: it lives on the iPhone, the iOS app asks for HealthKit permission, reads the data, and sends it to Kompose.

- **The list:** its entry links with `{ kind: "device", platform: "ios" }`. On web and Android, Settings shows "Connect on your iPhone" where the link button would be.
- **Connections:** `account_id` becomes nullable, because there is no Better Auth account. The phone creates the row through the API once the user grants permission. Unlinking deletes the row and the stored data.
- **Tokens and webhooks:** none. The phone sends data through the signed-in API, and HealthKit wakes the app in the background when there is new data.
- **Status:** HealthKit doesn't tell an app that read access was refused, so there is no `needs-reauth`. Settings shows when data last arrived.
- **Storage:** WHOOP's data can be fetched again, so it is only cached. Apple Health's can't, so it must be stored. It is also the second health provider, so this is when `day_metric` and `activity` above are built and WHOOP moves onto them.
- **The app:** HealthKit needs a native module and an entitlement, so it ships in a new native build.
