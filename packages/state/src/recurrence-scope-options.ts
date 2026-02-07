import type {
  DeleteScope,
  UpdateScope,
} from "@kompose/api/routers/task/contract";
import type { RecurrenceScope } from "@kompose/google-cal/schema";

export interface RecurrenceScopeOption<TValue extends string = string> {
  value: TValue;
  label: string;
}

export type RecurrenceScopeValue = RecurrenceScope;

export const RECURRENCE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<RecurrenceScope>[] =
  [
    { value: "this", label: "Only this occurrence" },
    { value: "all", label: "Entire series" },
    { value: "following", label: "This and following" },
  ] as const;

export const TASK_UPDATE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<UpdateScope>[] =
  [
    { value: "this", label: "Only this occurrence" },
    { value: "following", label: "This and following" },
  ] as const;

export const TASK_DELETE_SCOPE_OPTIONS: readonly RecurrenceScopeOption<DeleteScope>[] =
  [
    { value: "this", label: "Only this occurrence" },
    { value: "following", label: "This and following" },
  ] as const;
