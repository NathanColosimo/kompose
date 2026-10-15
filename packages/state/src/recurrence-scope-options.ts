import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import type { RecurrenceScope } from "@kompose/google-cal/schema";

export interface RecurrenceScopeOption<TValue extends string = string> {
  label: string;
  value: TValue;
}

export type RecurrenceScopeValue = RecurrenceScope;

export const RECURRENCE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<RecurrenceScope>[] =
  [
    { label: "Only this occurrence", value: "this" },
    { label: "Entire series", value: "all" },
    { label: "This and following", value: "following" },
  ] as const;

export const TASK_UPDATE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<UpdateScope>[] =
  [
    { label: "Only this occurrence", value: "this" },
    { label: "This and following", value: "following" },
  ] as const;

export const TASK_DELETE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<DeleteScope>[] =
  [
    { label: "Only this occurrence", value: "this" },
    { label: "This and following", value: "following" },
  ] as const;
