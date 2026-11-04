// Worker entry for the magic box parser (see use-magic-task.ts). It lives
// here so the bundler can resolve `new URL("./task-parser.worker.ts")`.
import "@kompose/task-parser/worker";
