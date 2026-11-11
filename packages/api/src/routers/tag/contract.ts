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

/** The tag palette. Each app maps a name to its swatch; see tag-colors.ts in @kompose/state. */
export const tagColorNames = [
  "rose",
  "coral",
  "apricot",
  "butter",
  "sage",
  "mint",
  "sky",
  "periwinkle",
  "lavender",
  "mauve",
] as const;

const tagColorSchema = z.enum(tagColorNames);

export const tagSelectSchemaWithIcon = tagSelectSchema.extend({
  color: tagColorSchema.nullable(),
  icon: tagIconSchema,
});

const tagInsertSchemaWithIcon = tagInsertSchema.extend({
  color: tagColorSchema.nullable().optional(),
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
  /** null clears the color. */
  color: tagColorSchema.nullable().optional(),
  icon: tagIconSchema.optional(),
  id: z.uuidv7(),
  name: z.string().min(1).optional(),
});

export const updateTag = oc
  .input(updateTagInputSchema)
  .output(tagSelectSchemaWithIcon);

const deleteTagInputSchema = z.object({
  id: z.uuidv7(),
});

export const deleteTag = oc.input(deleteTagInputSchema).output(z.null());

export const tagContract = {
  create: createTag,
  delete: deleteTag,
  list: listTags,
  update: updateTag,
};

export type CreateTagInput = z.infer<typeof createTagInputSchema>;
export type UpdateTagInput = z.infer<typeof updateTagInputSchema>;
export type TagSelect = z.infer<typeof tagSelectSchemaWithIcon>;
export type TagColorName = (typeof tagColorNames)[number];
