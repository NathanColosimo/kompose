# Kompose

Kompose is a calendar and task manager with web, iOS, and macOS clients.

## Stack

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better Auth
- **Tauri** - Build native desktop applications
- **Turborepo** - Optimized monorepo build system

## Getting Started

Install dependencies:

```bash
bun install
```

Install `portless` globally so the web app can run at
`https://local.kompose.dev` during development:

```bash
npm install -g portless
```

Start the Portless HTTPS proxy once. The web package registers
`local.kompose.dev` when its dev task starts:

```bash
bun run portless:proxy
```

## Database setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/web/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
bun run db:push
```

Start everything:

```bash
bun run dev
```

For Google OAuth, set `NEXT_PUBLIC_WEB_URL=https://local.kompose.dev` in `apps/web/.env.local`, then add these entries in Google Cloud:

- Authorized JavaScript origin: `https://local.kompose.dev`
- Authorized redirect URI: `https://local.kompose.dev/api/auth/callback/google`

Open [https://local.kompose.dev](https://local.kompose.dev) in your browser to see your fullstack application.
The native app uses an Expo development client rather than Expo Go. Build and
install it with `bun run --cwd apps/native ios`, then start Metro with
`bun run dev:native`.

## Project Structure

```
kompose/
├── apps/
│   ├── native/      # iOS application (React Native, Expo)
│   └── web/         # Web application and API (Next.js) + desktop shell (Tauri)
├── packages/
│   ├── ai/          # Shared AI services
│   ├── api/         # API layer and business logic
│   ├── auth/        # Authentication configuration and logic
│   ├── db/          # Database schema and queries
│   ├── env/         # Environment validation
│   ├── google-cal/  # Google Calendar integration
│   ├── state/       # Shared client state and data hooks
│   └── whoop/       # WHOOP integration
└── documents/       # Product and operational documentation
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run dev:web`: Start the web app, database studio, and AI SDK DevTools
- `bun run dev:native`: Start Expo Metro without clearing its cache
- `bun run portless:proxy`: Start the local HTTPS proxy used by `local.kompose.dev`
- `bun run build`: Build all applications
- `bun run type-check`: Check TypeScript across all apps and packages
- `bun run fix`: Format and lint the repository with Biome
- `bun run db:push`: Push schema changes to database
- `bun run db:studio`: Open database studio UI
- `cd apps/web && bun run desktop:dev`: Start Tauri desktop app in development
- `cd apps/web && bun run desktop:build`: Build Tauri desktop app
