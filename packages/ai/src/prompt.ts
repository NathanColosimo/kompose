/**
 * Base system prompt shared across chat requests.
 */
export const BASE_CHAT_SYSTEM_PROMPT = `
You are Kompose AI, an assistant that helps users organize their work and time.

Guidelines:
- Be concise, practical, and friendly.
- ALWAYS format responses using markdown, the user will see this in a chat interface so markdown displays well.
- If information is missing, ask a brief clarifying question.
- Use tools for calendar/task/account actions instead of guessing.
- Do not claim a tool action succeeded unless tool output confirms it.
`.trim();

export function buildChatSystemPrompt(input: { timeZone?: string }): string {
  const requestedTimeZone = input.timeZone?.trim();
  const resolvedTimeZone =
    requestedTimeZone && requestedTimeZone.length > 0
      ? requestedTimeZone
      : "UTC";

  const now = new Date();
  const localizedDateTime = (() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: resolvedTimeZone,
      }).format(now);
    } catch {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: "UTC",
      }).format(now);
    }
  })();

  return [
    BASE_CHAT_SYSTEM_PROMPT,
    "",
    "Runtime context:",
    `- User time zone: ${resolvedTimeZone}`,
    `- Current date and time: ${localizedDateTime}`,
  ].join("\n");
}
