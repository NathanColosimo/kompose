import { expect, test } from "bun:test";
import type { LinkMeta } from "@kompose/api/routers/task/contract";
import { type StateConfig, stateConfigAtom } from "@kompose/state/config";
import { useLinkMetadata } from "@kompose/state/hooks/use-link-metadata";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { renderToString } from "react-dom/server";

// Render the real hook to register its queries without a browser or DOM shim.
test("two link previews settle independently when the second finishes first", async () => {
  const first = Promise.withResolvers<LinkMeta>();
  const second = Promise.withResolvers<LinkMeta>();
  const urls = ["https://youtu.be/first", "https://youtu.be/second"];
  const meta: LinkMeta = {
    durationSeconds: 600,
    fetchedAt: "2026-11-10T00:00:00Z",
    provider: "youtube",
    title: "First video",
    url: urls[0],
  };
  const store = createStore();
  // Only the remote metadata service is needed by this hook.
  const orpc = {
    tasks: {
      parseLink: ({ url }: { url: string }) =>
        url === urls[0] ? first.promise : second.promise,
    },
  } as StateConfig["orpc"];
  store.set(stateConfigAtom, {
    authClient: {
      accountInfo: async () => null,
      listAccounts: async () => [],
      unlinkAccount: async () => undefined,
    },
    orpc,
  });
  const client = new QueryClient();
  let previews: ReturnType<typeof useLinkMetadata> = [];
  function Previews() {
    previews = useLinkMetadata(urls);
    return null;
  }
  const render = () =>
    renderToString(
      <Provider store={store}>
        <QueryClientProvider client={client}>
          <Previews />
        </QueryClientProvider>
      </Provider>
    );
  try {
    render();
    const queries = client.getQueryCache().getAll();
    expect(queries).toHaveLength(2);
    const requests = queries.map((query) => query.fetch());
    second.resolve({ ...meta, title: "Second video", url: urls[1] });
    await requests[1];
    render();
    expect(previews.map((preview) => preview.isPending)).toEqual([true, false]);
    first.resolve(meta);
    await requests[0];
    render();
    expect(previews.map((preview) => preview.data?.title)).toEqual([
      "First video",
      "Second video",
    ]);
    expect(previews.some((preview) => preview.isPending)).toBe(false);
  } finally {
    client.clear();
  }
});
