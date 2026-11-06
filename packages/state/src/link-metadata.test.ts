import { expect, test } from "bun:test";
import type { LinkMeta } from "@kompose/api/routers/task/contract";
import {
  QueriesObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/query-core";
import { applyLinkMetadata, linkMetadataQueryOptions } from "./link-metadata";

const url = "https://youtu.be/first";
const meta: LinkMeta = {
  durationSeconds: 600,
  fetchedAt: "2026-11-06T00:00:00.000Z",
  provider: "youtube",
  title: "First video",
  url,
};
const untouched = { durationMinutes: false, title: false };

test("metadata from a removed link or a previous draft cannot autofill the current draft", () => {
  const current = { durationMinutes: 30, links: [], title: "" };
  expect(applyLinkMetadata(current, url, meta, untouched)).toBe(current);
});

test("only the current first link autofills, regardless of response order", () => {
  const other: LinkMeta = {
    ...meta,
    title: "Second video",
    url: "https://youtu.be/second",
  };
  const current = { durationMinutes: 30, links: [other, meta], title: "" };
  const next = applyLinkMetadata(current, url, meta, untouched);
  expect(next.title).toBe("");
  expect(next.durationMinutes).toBe(30);
  const filled = applyLinkMetadata(next, other.url, other, untouched);
  expect(filled.title).toBe("Second video");
  expect(filled.durationMinutes).toBe(10);
});

test("metadata enriches links without overwriting an explicitly edited duration or cleared title", () => {
  const placeholder: LinkMeta = {
    fetchedAt: meta.fetchedAt,
    provider: "unknown",
    url,
  };
  const links: LinkMeta[] = [placeholder];
  const current = { durationMinutes: 45, links, title: "" };
  const next = applyLinkMetadata(current, url, meta, {
    durationMinutes: true,
    title: true,
  });
  expect(next.links).toEqual([meta]);
  expect(next.durationMinutes).toBe(45);
  expect(next.title).toBe("");
});

test("concurrent URL queries settle independently, even when the second completes first", async () => {
  const client = new QueryClient();
  const first = Promise.withResolvers<LinkMeta>();
  const second = Promise.withResolvers<LinkMeta>();
  const other = {
    ...meta,
    title: "Second video",
    url: "https://youtu.be/second",
  };
  const calls: string[] = [];
  const parseLink = ({ url: input }: { url: string }) => {
    calls.push(input);
    return input === url ? first.promise : second.promise;
  };
  const firstOptions = linkMetadataQueryOptions(parseLink, url);
  const secondOptions = linkMetadataQueryOptions(parseLink, other.url);
  const observer = new QueriesObserver(client, [firstOptions, secondOptions]);
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    second.resolve(other);
    await client.fetchQuery(secondOptions);
    expect(
      observer.getCurrentResult().map((result) => result.isPending)
    ).toEqual([true, false]);
    first.resolve(meta);
    await client.fetchQuery(firstOptions);
    expect(observer.getCurrentResult().map((result) => result.data)).toEqual([
      meta,
      other,
    ]);
    expect(observer.getCurrentResult().some((result) => result.isPending)).toBe(
      false
    );
    // Another consumer of the same URL reads the shared cache.
    expect(await client.fetchQuery(firstOptions)).toEqual(meta);
    expect(calls).toEqual([url, other.url]);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("a failed URL stops pending and is retried when re-added", async () => {
  const client = new QueryClient();
  let calls = 0;
  const options = linkMetadataQueryOptions(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.reject(new Error("Metadata unavailable"));
    }
    return Promise.resolve(meta);
  }, url);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await expect(client.fetchQuery(options)).rejects.toThrow(
      "Metadata unavailable"
    );
    expect(observer.getCurrentResult().isError).toBe(true);
    expect(observer.getCurrentResult().isPending).toBe(false);
    expect(calls).toBe(1);
    unsubscribe();
    const retryObserver = new QueryObserver(client, options);
    const unsubscribeRetry = retryObserver.subscribe(() => undefined);
    try {
      expect(await client.fetchQuery(options)).toEqual(meta);
      expect(calls).toBe(2);
    } finally {
      unsubscribeRetry();
    }
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("removing the last URL observer aborts its RPC signal", () => {
  const client = new QueryClient();
  let signal: AbortSignal | undefined;
  const options = linkMetadataQueryOptions((_input, context) => {
    signal = context?.signal;
    return new Promise<LinkMeta>(() => undefined);
  }, url);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => undefined);
  expect(signal?.aborted).toBe(false);
  unsubscribe();
  expect(signal?.aborted).toBe(true);
  client.clear();
});

test("saved metadata seeds the URL cache without reparsing or dirtying the draft", async () => {
  const client = new QueryClient();
  let calls = 0;
  const options = linkMetadataQueryOptions(
    () => {
      calls += 1;
      return Promise.resolve(meta);
    },
    url,
    meta
  );
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    const cached = await client.fetchQuery(options);
    expect(cached).toBe(meta);
    expect(calls).toBe(0);
    const current = {
      durationMinutes: 10,
      links: [meta],
      title: "First video",
    };
    expect(applyLinkMetadata(current, url, cached, untouched)).toBe(current);
  } finally {
    unsubscribe();
    client.clear();
  }
});
