/**
 * Enter or Space on a focused card opens its editor, as on a button. An
 * event card is a div (it holds a lock's tooltip, which a button can't),
 * so the browser doesn't do this for it.
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
