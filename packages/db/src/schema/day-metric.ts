import {
  date,
  doublePrecision,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { connectionTable } from "./connection";

/**
 * The numbers a plugin can report about a day. Kompose owns the names, and
 * each has one unit, so rows from two plugins compare directly. The units are
 * in documents/plugins.md.
 */
export const dayMetrics = [
  "energy_burned_kcal",
  "recovery_score",
  "sleep_duration_min",
  "sleep_performance",
  "strain",
] as const;

export type DayMetric = (typeof dayMetrics)[number];

/**
 * One number about one day, from one connection: its recovery score, how
 * long the user slept. See documents/plugins.md.
 */
export const dayMetricTable = pgTable(
  "day_metric",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connectionTable.id, { onDelete: "cascade" }),
    /** The day the number is about, as the provider assigns it. */
    date: date("date", { mode: "string" }).notNull(),
    /** Text, not a Postgres enum, so a new metric needs no migration. */
    metric: text("metric", { enum: dayMetrics }).notNull(),
    value: doublePrecision("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.date, table.metric] }),
  ]
);
