import { env } from "@kompose/env";

// Production links point at the public web URL; other deployments link
// within the current origin.
const legalOrigin =
  env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production"
    ? env.NEXT_PUBLIC_WEB_URL
    : "";

export const PRIVACY_HREF = `${legalOrigin}/privacy`;
export const TERMS_HREF = `${legalOrigin}/terms`;
