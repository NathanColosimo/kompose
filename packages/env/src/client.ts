/**
 * Browser config without zod, so client bundles don't ship a validator.
 * next.config imports ./index.ts, which validates these values at build time;
 * Next inlines each `process.env.NEXT_PUBLIC_*` read below.
 */
export const deploymentEnvs = ["local", "preview", "production"] as const;

type DeploymentEnv = (typeof deploymentEnvs)[number];

export const clientEnv = {
  // Validated at build time by ./index.ts.
  NEXT_PUBLIC_DEPLOYMENT_ENV: process.env
    .NEXT_PUBLIC_DEPLOYMENT_ENV as DeploymentEnv,
  // Validated at build time by ./index.ts.
  NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL as string,
};
