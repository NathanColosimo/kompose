import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// Validate env at build time.
await import("@kompose/env");

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost:3000", "local.kompose.dev"],
  experimental: {
    turbopackRustReactCompiler: true,
  },
  reactCompiler: true,
  reactStrictMode: true,
  // pg-cursor imports pg internals; keep their CommonJS resolution in the runtime.
  serverExternalPackages: ["pg-cursor"],
  turbopack: {
    root: workspaceRoot,
  },
  typedRoutes: true,
};

export default createMDX()(nextConfig);
