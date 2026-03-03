import { auth } from "@kompose/auth";
import { getGoogleUserInfo } from "@kompose/google-cal";
import type { Account } from "better-auth";

export async function getAccountInfo(input: {
  account: Account;
  userId: string;
}): Promise<{ email: string; name: string }> {
  if (input.account.providerId === "google") {
    try {
      const { accessToken } = await auth.api.getAccessToken({
        body: {
          providerId: "google",
          accountId: input.account.accountId,
          userId: input.userId,
        },
      });
      if (!accessToken) {
        return { email: "", name: "" };
      }

      const userInfo = await getGoogleUserInfo(accessToken);
      if (!userInfo) {
        return { email: "", name: "" };
      }

      return { email: userInfo.email, name: userInfo.name };
    } catch {
      return { email: "", name: "" };
    }
  }

  return { email: "", name: "" };
}
