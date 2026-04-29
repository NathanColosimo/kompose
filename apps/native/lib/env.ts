import { z } from "zod";

const TRAILING_SLASHES_PATTERN = /\/+$/;

const serverUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  },
  { message: "Must be an absolute HTTP(S) URL." }
);

function parseRequiredUrl(name: string, value: string | undefined): string {
  const result = serverUrlSchema.safeParse(value);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => issue.message)
      .join("; ");
    throw new Error(`${name} is required and must be a valid URL. ${message}`);
  }

  return result.data.replace(TRAILING_SLASHES_PATTERN, "");
}

export const env = {
  EXPO_PUBLIC_SERVER_URL: parseRequiredUrl(
    "EXPO_PUBLIC_SERVER_URL",
    process.env.EXPO_PUBLIC_SERVER_URL
  ),
};
