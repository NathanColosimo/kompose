/// <reference lib="webworker" />
// Worker entry, dedicated or shared; see worker-server.ts.
import { taskParserHandler } from "./worker-server";

declare const self: DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;

if ("onconnect" in self) {
  // A SharedWorker: every window that connects shares one loaded model.
  self.addEventListener("connect", (event) => {
    for (const port of event.ports) {
      taskParserHandler.upgrade(port);
      // A port listened to with addEventListener only delivers once started.
      port.start();
    }
  });
} else {
  taskParserHandler.upgrade(self);
}
