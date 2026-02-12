import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";

/**
 * Convert a UI message chunk stream into SSE string chunks.
 * This shape is required by `resumable-stream`.
 */
export function uiMessageChunkStreamToSseStringStream(
  stream: ReadableStream<UIMessageChunk>
): ReadableStream<string> {
  const response = createUIMessageStreamResponse({ stream });
  const body = response.body;
  if (!body) {
    throw new Error("Missing UI message stream body.");
  }

  return body.pipeThrough(new TextDecoderStream());
}

/**
 * Parse AI SDK SSE protocol (`data: {...}\n\n`) back into UI message chunks.
 * This lets reconnect streams flow through oRPC as typed chunk events.
 */
export function sseStringStreamToUiMessageChunkStream(
  stream: ReadableStream<string>
): ReadableStream<UIMessageChunk> {
  const reader = stream.getReader();
  let buffer = "";

  const processEventBlock = (eventBlock: string): UIMessageChunk[] => {
    const normalized = eventBlock.replaceAll("\r\n", "\n");
    const dataLines = normalized
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return [];
    }

    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") {
      return [];
    }

    try {
      return [JSON.parse(payload) as UIMessageChunk];
    } catch {
      // Ignore malformed keep-alive/proxy lines.
      return [];
    }
  };

  const dequeueEventBlock = (): string | null => {
    const separatorIndex = buffer.indexOf("\n\n");
    if (separatorIndex < 0) {
      return null;
    }

    const eventBlock = buffer.slice(0, separatorIndex);
    buffer = buffer.slice(separatorIndex + 2);
    return eventBlock;
  };

  const enqueueChunksFromBlock = (
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    eventBlock: string
  ): boolean => {
    const chunks = processEventBlock(eventBlock);
    for (const chunk of chunks) {
      controller.enqueue(chunk);
    }
    return chunks.length > 0;
  };

  const flushFinalBuffer = (
    controller: ReadableStreamDefaultController<UIMessageChunk>
  ) => {
    if (buffer.trim().length === 0) {
      return;
    }

    enqueueChunksFromBlock(controller, buffer);
    buffer = "";
  };

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      while (true) {
        const eventBlock = dequeueEventBlock();
        if (eventBlock) {
          if (enqueueChunksFromBlock(controller, eventBlock)) {
            return;
          }
          continue;
        }

        const result = await reader.read();
        if (result.done) {
          flushFinalBuffer(controller);
          controller.close();
          return;
        }
        buffer += result.value;
      }
    },
    async cancel() {
      await reader.cancel();
    },
  });
}
