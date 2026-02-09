import { auth } from "@kompose/auth";
import type { Session, User } from "better-auth";
import type { NextRequest } from "next/server";

// used in RPCHandler in api route
export async function createContext(req: NextRequest): Promise<Context> {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  return {
    session: session?.session,
    user: session?.user,
  };
}

export interface Context {
  session?: Omit<Session, "id">;
  user?: User;
}
