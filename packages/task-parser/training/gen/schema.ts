/** Final-answer schema shared by generate.ts and repair.ts. */
export const outputSchema = {
  additionalProperties: false,
  properties: {
    examples: {
      items: {
        additionalProperties: false,
        properties: {
          marked: { type: "string" },
          slot: { type: "integer" },
          tags: { items: { type: "string" }, type: "array" },
        },
        required: ["slot", "marked", "tags"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["examples"],
  type: "object",
};
