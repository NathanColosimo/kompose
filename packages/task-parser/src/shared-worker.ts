/// <reference lib="webworker" />
// SharedWorker entry: every window of the app shares one loaded model.
import { serveTaskParser } from "./worker-server";

declare const self: SharedWorkerGlobalScope;

self.addEventListener("connect", (event) => {
  for (const port of event.ports) {
    serveTaskParser(port);
  }
});
