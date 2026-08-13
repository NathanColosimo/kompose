import path from "node:path";
import type { NextConfig } from "next";

// When building for Tauri, use static export (no server routes).
const isTauriBuild = process.env.TAURI_BUILD === "1";
const workspaceRoot = path.resolve(import.meta.dirname, "../..");

// Validate env at build time for web deploys only (Tauri builds
// don't have server env vars like DATABASE_URL).
if (!isTauriBuild) {
  await import("@kompose/env");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost:3000", "local.kompose.dev"],
  experimental: {
    turbopackRustReactCompiler: true,
  },
  reactCompiler: true,
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },
  typedRoutes: true,
  // Tauri requires static export; the Next.js Image component needs
  // unoptimized mode because there is no server to optimize images.
  ...(isTauriBuild && {
    images: { unoptimized: true },
    output: "export" as const,
  }),
  // The deployed Next.js server needs these headers for requests from the
  // Tauri webview. Static exports cannot apply server response headers.
  ...(!isTauriBuild && {
    async headers() {
      return [
        {
          headers: [
            {
              key: "Access-Control-Allow-Origin",
              value: "tauri://localhost",
            },
            {
              key: "Access-Control-Allow-Methods",
              value: "GET, POST, PUT, DELETE, OPTIONS",
            },
            {
              key: "Access-Control-Allow-Headers",
              value:
                "Content-Type, Authorization, X-Requested-With, x-request-start",
            },
            {
              key: "Access-Control-Allow-Credentials",
              value: "true",
            },
          ],
          source: "/api/:path*",
        },
      ];
    },
  }),
};

// Load Fumadocs MDX only for web builds. Desktop builds exclude docs routes.
const withMDX = isTauriBuild
  ? (config: NextConfig) => config
  : (await import("fumadocs-mdx/next")).createMDX();

export default withMDX(nextConfig);
