/**
 * Why a new event can't be made (a task still can), the same words on web
 * and iOS.
 */
export function eventCreationBlockedReason(params: {
  hasGoogleAccount: boolean;
  loading: boolean;
}): string {
  if (params.loading) {
    return "Your calendars are still loading.";
  }
  if (!params.hasGoogleAccount) {
    return "Connect a Google calendar in Settings to create events.";
  }
  return "Show a calendar you can edit from the Calendars menu to create events.";
}
