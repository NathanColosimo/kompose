import type { NextConfig } from "next";

// When building for Tauri, use static export (no server routes).
const isTauriBuild = process.env.TAURI_BUILD === "1";

// Validate env at build time for web deploys only (Tauri builds
// don't have server env vars like DATABASE_URL).
if (!isTauriBuild) {
  import("@kompose/env");
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  // Force environment validation at build time
  transpilePackages: ["@t3-oss/env-nextjs", "@t3-oss/env-core"],
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  // Tauri requires static export; the Next.js Image component needs
  // unoptimized mode because there is no server to optimize images.
  ...(isTauriBuild && {
    output: "export" as const,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
