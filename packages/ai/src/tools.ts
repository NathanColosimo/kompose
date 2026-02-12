/**
 * Phase 1 keeps tool execution disabled. This registry interface exists so
 * Phase 2 can plug in calendar/task/data tools without reshaping callers.
 */

export type ToolRegistry = Record<string, never>;

export function getToolRegistry(): ToolRegistry {
  return {};
}
