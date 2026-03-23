# kompose

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Tauri** - Build native desktop applications
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

Install `portless` globally so the web app can run at `https://local.kompose.dev` during development:

```bash
npm install -g portless
```

Start the Portless proxy with HTTPS and the `dev` TLD. The app name is set to `local.kompose`, which produces `https://local.kompose.dev`:

```bash
bun run portless:proxy
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/web/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:
```bash
bun run db:push
```


Then, run the development server:

```bash
bun run dev
```

For Google OAuth, set `NEXT_PUBLIC_WEB_URL=https://local.kompose.dev` in `apps/web/.env.local`, then add these entries in Google Cloud:

- Authorized JavaScript origin: `https://local.kompose.dev`
- Authorized redirect URI: `https://local.kompose.dev/api/auth/callback/google`

Open [https://local.kompose.dev](https://local.kompose.dev) in your browser to see your fullstack application.
Use the Expo Go app to run the mobile application.







## Project Structure

```
kompose/
├── apps/
│   └── web/         # Fullstack application (Next.js)
│   ├── native/      # Mobile application (React Native, Expo)
├── packages/
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run portless:proxy`: Start the local HTTPS proxy used by `local.kompose.dev`
- `bun run build`: Build all applications
- `bun run check-types`: Check TypeScript types across all apps
- `bun run dev:native`: Start the React Native/Expo development server
- `bun run db:push`: Push schema changes to database
- `bun run db:studio`: Open database studio UI
- `cd apps/web && bun run desktop:dev`: Start Tauri desktop app in development
- `cd apps/web && bun run desktop:build`: Build Tauri desktop app
