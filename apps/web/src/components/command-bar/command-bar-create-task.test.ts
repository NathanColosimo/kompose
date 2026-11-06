import { expect, test } from "bun:test";
import type { LinkMeta } from "@kompose/api/routers/task/contract";
import { getLinkMetadataQueryKey } from "@kompose/state/link-metadata";
import { QueryClient } from "@tanstack/react-query";
import { buildTaskDataFromParsed } from "./command-bar-create-task";

const meta: LinkMeta = {
  url: "https://youtu.be/submitted",
  provider: "youtube",
  title: "Submitted video",
  durationSeconds: 600,
  fetchedAt: "2026-11-06T00:00:00Z",
};

test("a submitted URL uses its cached metadata after the draft changes", async () => {
  const queryClient = new QueryClient();
  const parse =
    Promise.withResolvers<Parameters<typeof buildTaskDataFromParsed>[0]>();
  queryClient.setQueryData(getLinkMetadataQueryKey(meta.url), meta);
  const pending = parse.promise.then((parsed) =>
    buildTaskDataFromParsed(parsed, queryClient)
  );
  const other = {
    ...meta,
    url: "https://youtu.be/new-draft",
    title: "New draft video",
  };
  queryClient.setQueryData(getLinkMetadataQueryKey(other.url), other);
  parse.resolve({
    title: "",
    description: null,
    durationMinutes: null,
    links: [meta.url],
    dueDate: null,
    startDate: null,
    startTime: null,
    recurrence: null,
    tags: [],
  });
  const task = await pending;
  expect(task.title).toBe("Submitted video");
  expect(task.durationMinutes).toBe(10);
  expect(task.links).toEqual([meta]);
  queryClient.clear();
});
