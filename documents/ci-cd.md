# CI/CD

Two GitHub Actions workflows run everything; nothing ships from a laptop.

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
- `.github/workflows/release.yml` runs on pushes to `main` and ships what
  changed. `main` is the only (stable) channel.

## PR checks (`ci.yml`)

| Job | What it checks |
| --- | --- |
| Lint and format | `biome ci .` |
| Lint workflows | `actionlint` (with `shellcheck` on `run:` blocks) on `.github/workflows/` |
| Type-check and build | `turbo run type-check --affected`, then `turbo run build doctor --affected`: the iOS bundle (`expo export`, including the Hermes bytecode compile), the Electron main/preload build, and `expo-doctor` (native dependency versions against the Expo SDK; it calls the Expo API, so it can fail on network issues) |
| Migrations | `bun run db:check`: `drizzle-kit check` validates the migrations and fails if the schema differs from them |

`--affected` runs only the packages changed since the PR base
(`origin/<base>`) or, on `main`, the previous push (`TURBO_SCM_BASE`).
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
         ├─ mobile (if changed): same fingerprint → Linux runner: eas update (OTA)
         │                       new fingerprint → macOS runner: eas build --local → eas submit
         └─ desktop (if the shell changed): macOS runner: build, sign, notarize,
                                            verify, GitHub release (Latest)
```

- Mobile and desktop wait for web. If web or the migration fails, they don't
  run; if web had no changes, they run right away. Clients are never ahead of
  the API they call.
- Each target releases one run at a time (job-level `concurrency`), so a
  20-minute native iOS build never holds up a web deploy. A newer run replaces
  one that's still waiting and ships everything since that target's last
  shipped tag. Desktop rechecks `shipped/desktop` once its turn comes, so an
  earlier run that already shipped the same shell doesn't produce a duplicate
  release.
- The staged deployment (`vercel deploy --prod --skip-domain`) is built on
  Vercel with the project's production env vars and turbo remote cache, but
  serves no traffic until `vercel promote`. A failed migration leaves the
  current deployment live.
- Before migrating, `vercel curl` POSTs to `/api/rpc/tags/list` on the staged
  deployment with no session and expects oRPC's `UNAUTHORIZED` error. That
  proves the route, auth context, and API code load. It doesn't touch the
  database, so it works before migrations run.
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
| Mobile | `turbo query affected --packages native` since `shipped/mobile` | `shipped/mobile`; `shipped/ios-binary` (message: the latest binary's fingerprint) |
| Desktop | the desktop fingerprint differs from the one in `shipped/desktop` | `shipped/desktop` (message: the released fingerprint), `v<version>` |

- **Mobile fingerprint**: `expo-updates runtimeversion:resolve`, the same value
  as the app's `runtimeVersion` (policy `fingerprint`). It changes with native
  dependencies, config plugins, and app config, not with JS. If it matches the
  latest submitted binary (`shipped/ios-binary`), an OTA update reaches it;
  otherwise a new binary is built, including when a revert returns to an older
  fingerprint, since OTA updates only reach binaries with the same runtime. Server-only changes can also mark `native` as affected
  (it imports `@kompose/api` for types); that just publishes an identical OTA
  update.
- **Submitting**: `eas submit --no-wait` ends the job once EAS accepts the
  upload instead of waiting ~20 minutes for App Store Connect processing.
  Expo and Apple email if processing fails; `shipped/ios-binary` has already
  moved by then, so rebuild by retagging it (or with the next native change).
- **Native build cache**: a cold iOS build takes about 20 minutes, mostly
  Xcode compiling the third-party native modules (React Native core is
  prebuilt). The build runs with ccache (`USE_CCACHE=1`), and `actions/cache`
  restores its objects from the last native build, so C/C++/Objective-C files
  that didn't change aren't recompiled. Swift isn't cached. GitHub evicts
  caches unused for 7 days, and Expo/React Native upgrades change most inputs,
  so those builds stay cold.
- **Desktop fingerprint**: a hash of the per-task file inputs and locked
  dependency versions that `turbo run build --filter=@kompose/electron
  --dry=json` reports for the Electron build and the workspace packages it
  bundles. It changes with the Electron sources, `packages/desktop`,
  `electron-builder.yml`, `build/`, and Electron's dependencies, but not with
  root tooling bumps. The UI is the hosted web app, so web changes never need
  a new binary. A rollback to an earlier shell ships as a new patch release.
- **Desktop version**: the next patch after the latest GitHub release
  (`semver --increment patch`), injected with `-c.extraMetadata.version`. No
  version-bump commits.
- **Desktop publishing**: `electron-builder --publish always` uploads every
  artifact electron-updater needs to a draft release. After Gatekeeper accepts
  the app, `gh release edit --draft=false --latest` publishes it on the
  released commit.

### Retrying

Rerun the failed jobs, or run the workflow from the Actions tab
(`workflow_dispatch`). Targets that already shipped are skipped because their
markers moved. A desktop run that fails after uploading leaves a draft release;
the rerun reuses it under the same version.

To inspect the markers locally, run `git fetch --tags --force`. Plain
`git fetch --tags` doesn't update tags that already exist locally, and every
`shipped/*` tag moves.

### Testing workflow changes

The release workflow only runs on `main`, so a mistake there shows up in a
real release. Before merging:

1. Run `actionlint` locally (`brew install actionlint shellcheck`). CI runs it
   too.
2. Run each new step's exact command locally against real inputs, e.g. a
   staged deployment URL for a `vercel` call. CLI flag handling (such as
   `vercel curl` passing its flags through to curl) only shows up when run.
3. For behaviour that only exists on a runner (caches, Xcode, ccache), push a
   temporary `workflow_dispatch` workflow containing just those steps to a
   `tmp/` branch, run it with `gh workflow run <file> --ref tmp/<name>`, then
   delete the branch and any caches it saved (`gh cache delete`).

Wait for a run with `gh run watch <id> --exit-status` (in the background)
rather than polling `gh run view`.

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

CI runs `bun run db:check`. It fails when `drizzle-kit check` reports a problem
or warns that the schema differs from the committed migrations (run
`bun run db:generate` and commit the result).

`DATABASE_URL` for the migration step should be a direct connection or
Supabase's session pooler (port 5432), not the transaction pooler (port 6543).

## Security (public repo)

- **Fork PRs:** they run `ci.yml` (the only workflow they can trigger) with a
  read-only `GITHUB_TOKEN` and no secrets. Workflows from anyone outside the
  repo need approval before they run. No workflow uses `pull_request_target`
  or `workflow_run`, the triggers that hand secrets to fork code.
- **Production secrets:** the `production` environment only deploys from
  `main`, and `main` requires a PR with passing CI.
- **Supply chain:** every action is pinned to a commit SHA. The repo setting
  requires this, and only GitHub-owned actions, `oven-sh/setup-bun`, and
  `maxim-lobanov/setup-xcode` are allowed. CLIs that receive secrets (vercel,
  eas-cli, semver) run at exact versions. Everything else runs from the main
  lockfile, and Bun skips untrusted install scripts. Dependabot keeps the
  action pins current.
- **Least privilege:** workflows default to `contents: read`; only the release
  jobs that push tags or releases get `contents: write`. Each secret is set
  only on the steps that use it.
- **Detection:** secret scanning with push protection, Dependabot alerts, and
  private vulnerability reporting are enabled.

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
git fetch origin --tags --force  # --force updates tags that moved
LIVE=<sha of the commit currently deployed>
git checkout "$LIVE"
git tag -f shipped/web "$LIVE" && git tag -f shipped/mobile "$LIVE"

# The binary in the App Store: its runtime version is its fingerprint.
FP=$(cd apps/native && bunx expo-updates runtimeversion:resolve --platform ios | jq -r .runtimeVersion)
git tag -fa shipped/ios-binary -m "$FP" "$LIVE"

# The latest desktop release (run on the commit it was built from).
DFP=$(bunx turbo run build --filter=@kompose/electron --dry=json \
  | jq -c '[.tasks[] | {taskId, inputs, hashOfExternalDependencies}]' \
  | shasum -a 256 | cut -c1-16)
git tag -fa shipped/desktop -m "$DFP" "$LIVE"

git push -f origin refs/tags/shipped/web refs/tags/shipped/mobile \
  refs/tags/shipped/ios-binary refs/tags/shipped/desktop
```

## Xcode version

iOS builds run on GitHub's `macos-26` runner with the Xcode pinned by the
`setup-xcode` step in `release.yml` (26.6, the newest on that image). Expo's own
SDK 58 build image uses Xcode 27; if a build needs it, bump that version once
GitHub's runner image includes it
([runner images](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)).
