/**
 * Enter or Space on a focused card opens its editor, as on a button. Task
 * and event cards are divs (a task's checkbox can't sit inside a button),
 * so the browser doesn't do this for them.
 */
export function openOnEnterOrSpace(event: React.KeyboardEvent<HTMLElement>) {
  if (
    event.target !== event.currentTarget ||
    !(event.key === "Enter" || event.key === " ")
  ) {
    return;
  }
  event.preventDefault();
  event.currentTarget.click();
}
