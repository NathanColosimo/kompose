// biome-ignore lint/correctness/noUnusedImports: validate at build
import { env } from "@kompose/env";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  // Force environment validation at build time
  transpilePackages: ["@t3-oss/env-nextjs", "@t3-oss/env-core"],
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
