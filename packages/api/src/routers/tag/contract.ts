import { tagInsertSchema, tagSelectSchema } from "@kompose/db/schema/tag";
import { oc } from "@orpc/contract";
import z from "zod";

export const tagIconNames = [
  "Tag",
  "Star",
  "Heart",
  "Briefcase",
  "Home",
  "Calendar",
  "Bug",
  "Book",
  "Code",
  "Rocket",
  "Bell",
  "Flag",
  "Lightbulb",
  "Flame",
  "Coffee",
  "ClipboardList",
  "CheckSquare",
  "ListTodo",
  "Target",
  "Zap",
] as const;

export const tagIconSchema = z.enum(tagIconNames);

export const tagSelectSchemaWithIcon = tagSelectSchema.extend({
  icon: tagIconSchema,
});

const tagInsertSchemaWithIcon = tagInsertSchema.extend({
  icon: tagIconSchema,
  name: z.string().min(1),
});

export const createTagInputSchema = tagInsertSchemaWithIcon.omit({
  userId: true,
});

export const listTags = oc
  .input(z.object({}).optional())
  .output(z.array(tagSelectSchemaWithIcon));

export const createTag = oc
  .input(createTagInputSchema)
  .output(tagSelectSchemaWithIcon);

const updateTagInputSchema = z.object({
  id: z.uuidv7(),
  name: z.string().min(1).optional(),
  icon: tagIconSchema.optional(),
});

export const updateTag = oc
  .input(updateTagInputSchema)
  .output(tagSelectSchemaWithIcon);

const deleteTagInputSchema = z.object({
  id: z.uuidv7(),
});

export const deleteTag = oc.input(deleteTagInputSchema).output(z.null());

export const tagContract = {
  list: listTags,
  create: createTag,
  update: updateTag,
  delete: deleteTag,
};

export type CreateTagInput = z.infer<typeof createTagInputSchema>;
export type UpdateTagInput = z.infer<typeof updateTagInputSchema>;
export type TagSelect = z.infer<typeof tagSelectSchemaWithIcon>;
