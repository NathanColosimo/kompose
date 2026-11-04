/// <reference lib="webworker" />
// SharedWorker entry: every window that connects shares one loaded model.
import { taskParserHandler } from "./worker-server";

declare const self: SharedWorkerGlobalScope;

self.addEventListener("connect", (event) => {
  for (const port of event.ports) {
    taskParserHandler.upgrade(port);
    // A port listened to with addEventListener only delivers once started.
    port.start();
  }
});
