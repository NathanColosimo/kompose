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
  plainDateTimeCodec,
} from "../../lib/temporal-codecs";

// ============================================================================
// SELECT CODEC (for API responses - decodes strings to Temporal)
// ============================================================================

/**
 * Task select codec with Temporal types for date/time fields.
 * Used for output contracts - decodes string dates to Temporal objects.
 */
export const taskSelectCodec = taskSelectSchema.extend({
  dueDate: plainDateCodec.nullable(),
  startDate: plainDateCodec.nullable(),
  startTime: plainDateTimeCodec.nullable(),
  createdAt: instantCodec,
  updatedAt: instantCodec,
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
export const taskUpdateCodec = taskUpdateSchema.extend({
  dueDate: plainDateCodec.nullable().optional(),
  startDate: plainDateCodec.nullable().optional(),
  startTime: plainDateTimeCodec.nullable().optional(),
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
export const taskInsertCodec = taskInsertSchema.extend({
  dueDate: plainDateCodec.nullable().optional(),
  startDate: plainDateCodec.nullable().optional(),
  startTime: plainDateTimeCodec.nullable().optional(),
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
const clientTaskInsertSchema = taskInsertSchema.omit({ userId: true });

/** API returns string types - decode on client with taskSelectCodec */
export const listTasks = oc.input(z.void()).output(z.array(taskSelectSchema));

export const createTask = oc
  .input(clientTaskInsertSchema)
  .output(taskSelectSchema);

export const updateTask = oc
  .input(
    z.object({
      id: z.uuidv7(),
      task: taskUpdateSchema,
    })
  )
  .output(taskSelectSchema);

export const deleteTask = oc
  .input(z.object({ id: z.uuidv7() }))
  .output(z.void());

export const taskContract = {
  list: listTasks,
  create: createTask,
  update: updateTask,
  delete: deleteTask,
};
