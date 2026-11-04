/// <reference lib="webworker" />
// Dedicated Worker entry; see worker-server.ts.
import { serveTaskParser } from "./worker-server";

serveTaskParser(self);
