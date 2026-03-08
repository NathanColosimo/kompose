import { auth } from "@kompose/auth";

/**
 * Fetch provider profile info for a linked account using Better Auth's
 * accountInfo endpoint (server-side, no session headers needed).
 */
export async function getAccountInfo(input: {
  accountId: string;
  userId: string;
}): Promise<{ email: string; image: string | null; name: string }> {
  try {
    const info = await auth.api.accountInfo({
      query: {
        accountId: input.accountId,
        userId: input.userId,
      } as Record<string, string>,
    });
    return {
      email: info?.user?.email ?? "",
      image: info?.user?.image ?? null,
      name: info?.user?.name ?? "",
    };
  } catch {
    return { email: "", image: null, name: "" };
  }
}
