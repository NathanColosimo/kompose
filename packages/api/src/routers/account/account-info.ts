import { auth } from "@kompose/auth";
import { getGoogleUserInfo } from "@kompose/google-cal";

export interface LinkedAccountRecord {
  id: string;
  providerId: string;
}

export async function getAccountInfo(input: {
  account: LinkedAccountRecord;
  userId: string;
}): Promise<{ email: string; name: string }> {
  if (input.account.providerId === "google") {
    try {
      const { accessToken } = await auth.api.getAccessToken({
        body: {
          providerId: "google",
          accountId: input.account.id,
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
