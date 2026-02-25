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
  // Debug: disable Strict Mode to rule out dev double-mount behavior.
  reactStrictMode: false,
  reactCompiler: true,
  // Force environment validation at build time.
  transpilePackages: ["@t3-oss/env-nextjs", "@t3-oss/env-core"],
  experimental: {
    turbopackFileSystemCacheForDev: true,
    optimizePackageImports: ["lucide-react"],
  },
  // Tauri requires static export; the Next.js Image component needs
  // unoptimized mode because there is no server to optimize images.
  ...(isTauriBuild && {
    output: "export" as const,
    images: { unoptimized: true },
  }),
  // Allow the Tauri desktop webview (origin: tauri://localhost) to
  // make credentialed cross-origin requests to /api routes.
  async headers() {
    return [
      {
        source: "/api/:path*",
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
      },
    ];
  },
};

// Load Fumadocs MDX only for web builds. Desktop builds exclude docs routes.
const withMDX = isTauriBuild
  ? (config: NextConfig) => config
  : (await import("fumadocs-mdx/next")).createMDX();

export default withMDX(nextConfig);
