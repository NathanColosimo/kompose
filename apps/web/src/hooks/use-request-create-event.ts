import { useSetAtom } from "jotai";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { createEventRequestedAtom } from "@/state/calendar-navigation";

const CALENDAR_PATH = "/dashboard";

/**
 * Open the new-event editor. The calendar grid handles the request, so from
 * another page (Settings) this goes back to the calendar first.
 */
export function useRequestCreateEvent() {
  const router = useRouter();
  const pathname = usePathname();
  const requestCreateEvent = useSetAtom(createEventRequestedAtom);
  return useCallback(() => {
    requestCreateEvent(true);
    if (pathname !== CALENDAR_PATH) {
      router.push(CALENDAR_PATH);
    }
  }, [pathname, requestCreateEvent, router]);
}
