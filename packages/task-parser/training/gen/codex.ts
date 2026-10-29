/**
 * Runs Codex non-interactively with a JSON schema for the final answer.
 * Codex gets an empty scratch directory, read-only, so it can only answer.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CodexOptions {
  effort?: "low" | "medium" | "high" | "xhigh";
  model: string;
  prompt: string;
  schema: object;
}

const TIMEOUT_MS = 30 * 60_000;

/**
 * The user's Codex config loads MCP servers and plugins (computer use, a
 * browser, a node REPL) on every exec. They take ~50 s to start and add
 * thousands of prompt tokens, and none of them are useful here.
 */
const PLUGINS = [
  "browser@openai-bundled",
  "chrome@openai-bundled",
  "code-review@openai-bundled",
  "codex-app-tools@openai-bundled",
  "computer-use@openai-bundled",
  "documents@openai-primary-runtime",
  "pdf@openai-primary-runtime",
  "presentations@openai-primary-runtime",
  "spreadsheets@openai-primary-runtime",
  "template-creator@openai-primary-runtime",
  "unified-computer-use@openai-bundled",
  "visualize@openai-bundled",
];
const LEAN = [
  "mcp_servers.node_repl.enabled=false",
  "mcp_servers.computer-use.enabled=false",
  "mcp_servers.axiom_kompose.enabled=false",
  "notify=[]",
  "features.apps=false",
  "features.browser_use=false",
  "features.browser_use_external=false",
  "features.computer_use=false",
  "features.goals=false",
  'web_search="disabled"',
  ...PLUGINS.map((plugin) => `plugins."${plugin}".enabled=false`),
].flatMap((setting) => ["-c", setting]);

export async function codexJson<T>({
  effort = "low",
  model,
  prompt,
  schema,
}: CodexOptions): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "codex-"));
  try {
    await writeFile(join(dir, "schema.json"), JSON.stringify(schema));
    const output = join(dir, "out.json");
    const args = [
      "exec",
      "-m",
      model,
      "-c",
      `model_reasoning_effort="${effort}"`,
      ...LEAN,
      "--ephemeral",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "-C",
      dir,
      "--output-schema",
      join(dir, "schema.json"),
      "-o",
      output,
      "-",
    ];
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", args, {
        env,
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`codex exited ${code}: ${stderr}`));
        }
      });
      child.stdin.end(prompt);
    });
    return JSON.parse(await readFile(output, "utf8")) as T;
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

/**
 * Run `tasks` with at most `limit` in flight; failures are retried twice,
 * then logged as "<name> <index> failed".
 */
export async function pool<T>(
  name: string,
  tasks: (() => Promise<T>)[],
  limit: number,
  onDone?: (index: number, result: T | Error) => void
) {
  const results: (T | Error)[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      let result: T | Error = new Error("not run");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          result = await (tasks[index] as () => Promise<T>)();
          break;
        } catch (error) {
          result = error as Error;
        }
      }
      if (result instanceof Error) {
        console.log(`${name} ${index} failed: ${result.message.slice(0, 200)}`);
      }
      results[index] = result;
      onDone?.(index, result);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
