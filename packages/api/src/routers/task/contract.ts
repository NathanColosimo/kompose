import {
  taskInsertSchema,
  taskSelectSchema,
  taskUpdateSchema,
} from "@kompose/db/schema/task";
import { oc } from "@orpc/contract";
import z from "zod";
import {
  instantCodec,
  plainDateCodec,
  plainTimeCodec,
} from "../../lib/temporal-codecs";
import { tagSelectSchemaWithIcon } from "../tag/contract";

// Re-export recurrence types for frontend use
export type { TaskRecurrence } from "@kompose/db/schema/task";

// ============================================================================
// SCOPE ENUMS (for recurring task operations)
// ============================================================================

/** Scope for updating recurring tasks */
export const updateScopeSchema = z.enum(["this", "following"]);
export type UpdateScope = z.infer<typeof updateScopeSchema>;

/** Scope for deleting recurring tasks */
export const deleteScopeSchema = z.enum(["this", "following"]);
export type DeleteScope = z.infer<typeof deleteScopeSchema>;

const tagIdsSchema = z.array(z.uuidv7());
const tagsSchema = z.array(tagSelectSchemaWithIcon);

const taskSelectSchemaWithTags = taskSelectSchema.extend({
  tags: tagsSchema,
});

const taskInsertSchemaWithTagIds = taskInsertSchema.extend({
  tagIds: tagIdsSchema.optional(),
});

const taskUpdateSchemaWithTagIds = taskUpdateSchema.extend({
  tagIds: tagIdsSchema.optional(),
});

// ============================================================================
// SELECT CODEC (for API responses - decodes strings to Temporal)
// ============================================================================

/**
 * Task select codec with Temporal types for date/time fields.
 * Used for output contracts - decodes string dates to Temporal objects.
 * Note: recurrence stays as-is (already typed correctly from schema)
 */
export const taskSelectCodec = taskSelectSchemaWithTags.extend({
  dueDate: plainDateCodec.nullable(),
  startDate: plainDateCodec.nullable(),
  startTime: plainTimeCodec.nullable(),
  createdAt: instantCodec,
  updatedAt: instantCodec,
  // seriesMasterId, recurrence, isException are already correctly typed from schema
});

/** Task type with Temporal date/time fields (decoded from API) */
export type TaskSelectEncoded = z.input<typeof taskSelectCodec>;
export type TaskSelectDecoded = z.output<typeof taskSelectCodec>;

// ============================================================================
// UPDATE CODEC (for client-side encoding)
// ============================================================================

/**
 * Task update codec with Temporal types.
 * Use on client to encode Temporal → strings before API call.
 * - z.input = string types (for API)
 * - z.output = Temporal types (for app use)
 * - schema.encode(temporalData) = converts to strings for API
 */
export const taskUpdateCodec = taskUpdateSchemaWithTagIds.extend({
  dueDate: plainDateCodec.nullable().optional(),
  startDate: plainDateCodec.nullable().optional(),
  startTime: plainTimeCodec.nullable().optional(),
  createdAt: instantCodec.optional(),
  updatedAt: instantCodec.optional(),
});

export type TaskUpdateEncoded = z.input<typeof taskUpdateCodec>;
export type TaskUpdateDecoded = z.output<typeof taskUpdateCodec>;

// ============================================================================
// INSERT CODEC (for client-side encoding)
// ============================================================================

/**
 * Task insert codec with Temporal types. Omits userId (added server-side).
 * Use on client to encode Temporal → strings before API call.
 * - z.input = string types (for API)
 * - z.output = Temporal types (for app use)
 * - schema.encode(temporalData) = converts to strings for API
 */
export const taskInsertCodec = taskInsertSchemaWithTagIds.extend({
  dueDate: plainDateCodec.nullable().optional(),
  startDate: plainDateCodec.nullable().optional(),
  startTime: plainTimeCodec.nullable().optional(),
  createdAt: instantCodec.optional(),
  updatedAt: instantCodec.optional(),
});

export type TaskInsertEncoded = z.input<typeof taskInsertCodec>;
export type TaskInsertDecoded = z.output<typeof taskInsertCodec>;

// ============================================================================
// CLIENT-SIDE CODECS (for encoding before API calls)
// ============================================================================

/** Client insert codec - use .encode() to convert Temporal → strings */
export const clientTaskInsertCodec = taskInsertCodec.omit({ userId: true });
export type ClientTaskInsertEncoded = z.input<typeof clientTaskInsertCodec>;
export type ClientTaskInsertDecoded = z.output<typeof clientTaskInsertCodec>;

// ============================================================================
// API CONTRACTS (use base string schemas - no Temporal transformations)
// ============================================================================

/** Base client insert schema (strings) for API contract */
const clientTaskInsertSchema = taskInsertSchemaWithTagIds.omit({
  userId: true,
});

/** API returns string types - decode on client with taskSelectCodec */
export const listTasks = oc
  .input(z.void())
  .output(z.array(taskSelectSchemaWithTags));

export const createTask = oc
  .input(clientTaskInsertSchema)
  .output(z.array(taskSelectSchemaWithTags)); // Returns array (single for non-recurring, multiple for recurring)

export const updateTask = oc
  .input(
    z.object({
      id: z.uuidv7(),
      task: taskUpdateSchemaWithTagIds,
      /** Scope for recurring tasks: this (single), following (this + future) */
      scope: updateScopeSchema,
    })
  )
  .output(z.array(taskSelectSchemaWithTags)); // Returns array since "following" can update multiple

export const deleteTask = oc
  .input(
    z.object({
      id: z.uuidv7(),
      /** Scope for recurring tasks: this (single), following (this + future) */
      scope: deleteScopeSchema,
    })
  )
  .output(z.void());

export const taskContract = {
  list: listTasks,
  create: createTask,
  update: updateTask,
  delete: deleteTask,
};
