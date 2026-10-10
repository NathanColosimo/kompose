import path from "node:path";
import type { NextConfig } from "next";

// When building for desktop, use static export (no server routes).
const isDesktopBuild = process.env.DESKTOP_BUILD === "1";
const workspaceRoot = path.resolve(import.meta.dirname, "../..");

// Validate env at build time for web deploys only (desktop builds
// don't have server env vars like DATABASE_URL).
if (!isDesktopBuild) {
  await import("@kompose/env");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost:3000", "local.kompose.dev"],
  experimental: {
    turbopackRustReactCompiler: true,
  },
  // pg-cursor imports pg internals; keep their CommonJS resolution in the runtime.
  serverExternalPackages: ["pg-cursor"],
  reactCompiler: true,
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },
  typedRoutes: true,
  // desktop requires static export; the Next.js Image component needs
  // unoptimized mode because there is no server to optimize images.
  ...(isDesktopBuild && {
    images: { unoptimized: true },
    output: "export" as const,
  }),
};

// Load Fumadocs MDX only for web builds. Desktop builds exclude docs routes.
const withMDX = isDesktopBuild
  ? (config: NextConfig) => config
  : (await import("fumadocs-mdx/next")).createMDX();

export default withMDX(nextConfig);
