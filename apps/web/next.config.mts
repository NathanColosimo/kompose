import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// Validate env at build time.
await import("@kompose/env");

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost:3000", "local.kompose.dev"],
  experimental: {
    // Required with more than one root layout (app/(site) and app/(docs)).
    globalNotFound: true,
    turbopackRustReactCompiler: true,
  },
  reactCompiler: true,
  reactStrictMode: true,
  turbopack: {
    root: workspaceRoot,
  },
  typedRoutes: true,
};

export default createMDX()(nextConfig);
