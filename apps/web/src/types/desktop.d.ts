import type { ExposedBridges } from "@better-auth/electron/preload";
import type { DesktopBridge } from "@kompose/desktop";

type AuthBridges = ExposedBridges<
  Parameters<typeof import("@better-auth/electron/client").electronClient>[0]
>;
declare global {
  interface Window extends AuthBridges {
    komposeDesktop?: DesktopBridge;
  }
}
