import { createTool } from "@orpc/ai-sdk";
import type { ToolSet } from "ai";
import type { User } from "better-auth";
import { accountRouter } from "../account/router";
import { googleCalRouter } from "../google-cal/router";
import { taskRouter } from "../task/router";

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
      needsApproval: true,
    }),
    update_calendar_event: createTool(googleCalRouter.events.update, {
      context: { user },
      description: "Update a calendar event.",
      needsApproval: true,
    }),
    delete_calendar_event: createTool(googleCalRouter.events.delete, {
      context: { user },
      description: "Delete a calendar event.",
      needsApproval: true,
    }),
    list_tasks: createTool(taskRouter.list, {
      context: { user },
      description: "List tasks.",
    }),
    create_task: createTool(taskRouter.create, {
      context: { user },
      description: "Create a task.",
      needsApproval: true,
    }),
    update_task: createTool(taskRouter.update, {
      context: { user },
      description: "Update a task.",
      needsApproval: true,
    }),
    delete_task: createTool(taskRouter.delete, {
      context: { user },
      description: "Delete a task.",
      needsApproval: true,
    }),
  };
}
