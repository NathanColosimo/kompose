# CI/CD

Two GitHub Actions workflows run everything; nothing ships from a laptop.

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
- `.github/workflows/release.yml` runs on pushes to `main` and ships what
  changed. `main` is the only (stable) channel.

## PR checks (`ci.yml`)

| Job | What it checks |
| --- | --- |
| Lint and format | `biome ci .` |
| Type-check and build | `turbo run type-check --affected`, then the iOS bundle (`expo export`, including the Hermes bytecode compile) and the Electron main/preload build, both `--affected` |
| Migrations | `bun run db:check`: `drizzle-kit check` passes and `drizzle-kit generate` produces no new migration |

Turbo uses the Vercel remote cache when `TURBO_TOKEN`/`TURBO_TEAM` are set, so
work done in CI, on Vercel, or locally (if logged in) is not repeated. Web is
not built in CI: it needs production env vars, and Vercel builds it on deploy.
`SKIP_ENV_VALIDATION=1` lets type-checks run without secrets.

## Releases (`release.yml`)

```
push to main
 └─ changes: what changed since each target last shipped?
     └─ web (if changed): Vercel builds a staged production deployment
         → drizzle-kit migrate → vercel promote (traffic switches here)
         ├─ mobile (if changed): same fingerprint → eas update (OTA)
         │                       new fingerprint → macOS runner: eas build --local → eas submit
         └─ desktop (if the shell changed): macOS runner: build, sign, notarize,
                                            verify, GitHub release (Latest)
```

- Mobile and desktop wait for web. If web or the migration fails, they don't
  run; if web had no changes, they run right away. Clients are never ahead of
  the API they call.
- The staged deployment (`vercel deploy --prod --skip-domain`) is built on
  Vercel with the project's production env vars and turbo remote cache, but
  serves no traffic until `vercel promote`. A failed migration leaves the
  current deployment live.
- Vercel's Git integration stays off (`apps/web/vercel.json`), so there are no
  preview deployments. `buildCommand` in `vercel.json` is `turbo run build`;
  migrations only run in the workflow, never in a Vercel build.

### What "changed" means

Each target remembers the commit it last shipped with a moving tag, so a
failed or skipped run never loses changes: the next run compares against the
last *successful* release, not the previous commit.

| Target | Ships when | Marker tags |
| --- | --- | --- |
| Web + migrations | `turbo query affected --packages web` since `shipped/web` | `shipped/web` |
| Mobile | `turbo query affected --packages native` since `shipped/mobile` | `shipped/mobile`, `ios-fp/<fingerprint>` per shipped binary |
| Desktop | the desktop fingerprint has no `desktop-fp/<hash>` tag | `shipped/desktop`, `desktop-fp/<hash>` per release, `v<version>` |

- **Mobile fingerprint**: `expo-updates runtimeversion:resolve`, the same value
  as the app's `runtimeVersion` (policy `fingerprint`). It changes with native
  dependencies, config plugins, and app config, not with JS. A matching
  `ios-fp/` tag means a binary with that runtime is already out, so an OTA
  update reaches it. Server-only changes can also mark `native` as affected
  (it imports `@kompose/api` for types); that just publishes an identical OTA
  update.
- **Desktop fingerprint**: `.github/scripts/desktop-fingerprint.sh` hashes the
  built main/preload bundles, `electron-builder.yml`, `build/`, and the
  Electron package versions. The UI is the hosted web app, so web changes
  never need a new binary.
- **Desktop version**: the next patch after the latest `v*` tag, injected with
  `-c.extraMetadata.version`. No version-bump commits.

### Retrying

Rerun the failed jobs, or run the workflow from the Actions tab
(`workflow_dispatch`). Targets that already shipped are skipped because their
markers moved. If a desktop upload failed after its tag was pushed, delete the
partial release first: `gh release delete vX.Y.Z --cleanup-tag`.

## Migrations: expand only

Migrations run before the new web deployment takes traffic, and the previous
deployment, older iOS binaries, and older desktop shells keep calling the API.
So a PR should only expand the schema: add tables, nullable or defaulted
columns, indexes.

To remove or tighten something:

1. Ship the code that stops using the old shape (and, for NOT NULL, the
   backfill).
2. Once no shipped client depends on it, ship the destructive migration in its
   own PR.

CI runs `bun run db:check`, which fails when `drizzle-kit check` finds a
problem or the schema changed without a committed migration.

`DATABASE_URL` for the migration step should be a direct connection or
Supabase's session pooler (port 5432), not the transaction pooler (port 6543).

## One-time setup

### GitHub environment and secrets

Create an environment named `production` (Settings → Environments). Add
required reviewers there if you ever want to approve releases by hand.

| Secret (environment `production`) | Value / how to get it |
| --- | --- |
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | `orgId` in `.vercel/project.json` (after `vercel link`) |
| `VERCEL_PROJECT_ID` | `projectId` in `.vercel/project.json` |
| `DATABASE_URL` | Production Postgres: direct connection or Supabase session pooler (port 5432) |
| `EXPO_TOKEN` | expo.dev → Account Settings → Access Tokens (a robot user token is best) |
| `CSC_LINK` | Export "Developer ID Application: Nathan Colosimo (B8R99NL6HM)" with its private key from Keychain Access as a `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_API_KEY_P8` | Contents of the App Store Connect API key (`AuthKey_XXXX.p8`, the same key `.env.release` pointed to): `pbcopy < AuthKey_XXXX.p8` |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | The issuer ID shown above the key list in App Store Connect → Users and Access → Integrations |

Repository-level (Settings → Secrets and variables → Actions), used by both
workflows:

| Name | Kind | Value |
| --- | --- | --- |
| `TURBO_TOKEN` | secret | A Vercel token (the same kind as `VERCEL_TOKEN`) |
| `TURBO_TEAM` | variable | Your Vercel team slug (`nathan-colosimo`) |

With the GitHub CLI:

```bash
gh secret set VERCEL_TOKEN --env production
gh secret set CSC_LINK --env production < <(base64 -i cert.p12)
gh secret set APPLE_API_KEY_P8 --env production < AuthKey_XXXX.p8
gh secret set TURBO_TOKEN
gh variable set TURBO_TEAM --body nathan-colosimo
```

### Vercel

- Clear the project's dashboard Build Command (Settings → Build and
  Deployment), which used to run `db:migrate`. `vercel.json`'s `buildCommand`
  overrides it anyway; clearing it avoids confusion.
- Keep Git deployments disabled until preview environments exist.

### EAS

- `EXPO_PUBLIC_SERVER_URL` must exist in the EAS `production` environment
  (plaintext); `eas update` and `eas build` both read it.
- iOS signing credentials and the App Store Connect key for `eas submit` stay
  managed by EAS, as before.

### First run

Missing marker tags count as "changed", so the first run ships every target.
That is what the Expo 58 / Electron 45 upgrade needs anyway (a new iOS binary
and a new desktop build), so no bootstrap is required for this rollout.

To start tracking from a known state instead (e.g. when re-creating the
workflow later), tag what is already live before the first run:

```bash
git fetch origin --tags
LIVE=<sha of the commit currently deployed>
for target in web mobile desktop; do git tag -f "shipped/$target" "$LIVE"; done
git push -f origin refs/tags/shipped/web refs/tags/shipped/mobile refs/tags/shipped/desktop

# The binary in the App Store: its runtime version is its fingerprint.
FP=$(cd apps/native && bunx expo-updates runtimeversion:resolve --platform ios | jq -r .runtimeVersion)
git tag "ios-fp/$FP" "$LIVE" && git push origin "refs/tags/ios-fp/$FP"

# The latest desktop release (run on the commit it was built from).
bun run build:desktop
DFP=$(.github/scripts/desktop-fingerprint.sh)
git tag "desktop-fp/$DFP" "$LIVE" && git push origin "refs/tags/desktop-fp/$DFP"
```

## Xcode version

iOS builds run on GitHub's `macos-26` runner with the Xcode set by
`XCODE_VERSION` in `release.yml` (26.6, the newest on that image). Expo's own
SDK 58 build image uses Xcode 27; if a build needs it, bump `XCODE_VERSION`
once GitHub's runner image includes it
([runner images](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)).
