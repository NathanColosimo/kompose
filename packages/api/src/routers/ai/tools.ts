import { createTool } from "@orpc/ai-sdk";
import type { ToolApprovalConfiguration, ToolSet } from "ai";
import type { User } from "better-auth";
import { accountRouter } from "../account/router";
import { googleCalRouter } from "../google-cal/router";
import { taskRouter } from "../task/router";

export const aiToolApproval = {
  create_calendar_event: "user-approval",
  update_calendar_event: "user-approval",
  delete_calendar_event: "user-approval",
  create_task: "user-approval",
  update_task: "user-approval",
  delete_task: "user-approval",
} satisfies ToolApprovalConfiguration<ToolSet, unknown>;

export function createAiTools(user: User): ToolSet {
  return {
    list_linked_accounts: createTool(accountRouter.list, {
      context: { user },
      description: "List linked accounts.",
    }),
    list_calendars: createTool(googleCalRouter.calendars.list, {
      context: { user },
      description: "List Google calendars.",
    }),
    list_calendar_events: createTool(googleCalRouter.events.list, {
      context: { user },
      description: "List calendar events in a time window.",
    }),
    create_calendar_event: createTool(googleCalRouter.events.create, {
      context: { user },
      description: "Create a calendar event.",
    }),
    update_calendar_event: createTool(googleCalRouter.events.update, {
      context: { user },
      description: "Update a calendar event.",
    }),
    delete_calendar_event: createTool(googleCalRouter.events.delete, {
      context: { user },
      description: "Delete a calendar event.",
    }),
    list_tasks: createTool(taskRouter.list, {
      context: { user },
      description: "List tasks.",
    }),
    create_task: createTool(taskRouter.create, {
      context: { user },
      description: "Create a task.",
    }),
    update_task: createTool(taskRouter.update, {
      context: { user },
      description: "Update a task.",
    }),
    delete_task: createTool(taskRouter.delete, {
      context: { user },
      description: "Delete a task.",
    }),
  };
}
