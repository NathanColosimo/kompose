// Utility process behind the Prompt API (`LanguageModel`) in app windows.
// Electron forwards each renderer call here; prompts run on Apple's on-device
// model through the bundled kompose-fm helper (native/foundation-models).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  type LanguageModelCreateOptions,
  type LanguageModelMessage,
  type LanguageModelPromptOptions,
  LanguageModelUtility,
  localAIHandler,
} from "electron";

const [helperPath = "", allowedOrigin = ""] = process.argv.slice(2);

interface HelperReply {
  availability?: string;
  contextWindow?: number;
  error?: string;
  id: number;
  text?: string;
}

const helper = spawn(helperPath, [], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map<number, (reply: HelperReply) => void>();
let nextId = 1;
createInterface({ input: helper.stdout }).on("line", (line) => {
  const reply = JSON.parse(line) as HelperReply;
  pending.get(reply.id)?.(reply);
  pending.delete(reply.id);
});
helper.on("exit", () => {
  for (const resolve of pending.values()) {
    resolve({ error: "Foundation Models helper exited", id: 0 });
  }
  pending.clear();
});

function request(
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<HelperReply> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", () => {
      helper.stdin.write(`${JSON.stringify({ id, type: "cancel" })}\n`);
      pending.delete(id);
      reject(signal.reason);
    });
    pending.set(id, (reply) =>
      reply.error ? reject(new Error(reply.error)) : resolve(reply)
    );
    helper.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
  });
}

const status = request({ type: "availability" }).catch(() => ({
  availability: "unavailable",
  contextWindow: 0,
  id: 0,
}));

function messageText(message: LanguageModelMessage) {
  return message.content
    .flatMap((part) => (part.type === "text" ? [String(part.value)] : []))
    .join("\n");
}

/**
 * Adds `x-order` to every object schema. Foundation Models generates
 * properties in that order, and Swift's JSON decoding loses key order.
 */
function withPropertyOrder(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(withPropertyOrder);
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    result[key] =
      key === "properties" && value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([name, property]) => [
              name,
              withPropertyOrder(property),
            ])
          )
        : withPropertyOrder(value);
  }
  const properties = result.properties;
  if (properties && typeof properties === "object" && !result["x-order"]) {
    result["x-order"] = Object.keys(properties);
  }
  return result;
}

/**
 * A Prompt API session. Each prompt is answered by a fresh Foundation Models
 * session: system messages become its instructions, and earlier turns are
 * replayed as text ahead of the new input.
 */
class AppleFoundationModel extends LanguageModelUtility {
  #history: LanguageModelMessage[];

  constructor(
    initialState: { contextUsage: number; contextWindow: number },
    history: LanguageModelMessage[] = []
  ) {
    super(initialState);
    this.#history = history;
  }

  static override async availability() {
    return (await status).availability ?? "unavailable";
  }

  static override async create(options: LanguageModelCreateOptions) {
    const { contextWindow = 0 } = await status;
    return new AppleFoundationModel(
      { contextUsage: 0, contextWindow },
      options.initialPrompts ?? []
    );
  }

  override async prompt(
    input: LanguageModelMessage[],
    options: LanguageModelPromptOptions
  ) {
    if (options.responseConstraint instanceof RegExp) {
      throw new Error("RegExp response constraints are not supported");
    }
    const messages = [...this.#history, ...input];
    const instructions = messages
      .filter((message) => message.role === "system")
      .map(messageText)
      .join("\n\n");
    const turns = messages.filter((message) => message.role !== "system");
    const prompt =
      turns.length === 1
        ? messageText(turns[0] as LanguageModelMessage)
        : turns
            .map((message) => `${message.role}: ${messageText(message)}`)
            .join("\n\n");
    const { text = "" } = await request(
      {
        instructions: instructions || undefined,
        prompt,
        schema: options.responseConstraint
          ? withPropertyOrder(options.responseConstraint)
          : undefined,
        type: "respond",
      },
      options.signal
    );
    this.#history = [
      ...messages,
      { content: [{ type: "text", value: text }], role: "assistant" },
    ];
    return text;
  }

  override append(input: LanguageModelMessage[]) {
    this.#history = [...this.#history, ...input];
    return Promise.resolve(undefined);
  }

  override clone() {
    return Promise.resolve(
      new AppleFoundationModel(
        { contextUsage: 0, contextWindow: this.contextWindow },
        [...this.#history]
      )
    );
  }

  override measureContextUsage(input: LanguageModelMessage[]) {
    // Rough estimate; the helper doesn't expose the tokenizer.
    const characters = [...this.#history, ...input]
      .map(messageText)
      .join("").length;
    return Promise.resolve(Math.ceil(characters / 4));
  }

  override destroy() {
    this.#history = [];
  }
}

// Only the app's own pages get the model.
localAIHandler.setPromptAPIHandler(({ securityOrigin }) =>
  securityOrigin === allowedOrigin ? AppleFoundationModel : null
);
