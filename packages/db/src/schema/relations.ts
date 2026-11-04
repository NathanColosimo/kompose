import { defineRelations } from "drizzle-orm";
import { account, session, user } from "./auth";
import { tagTable, taskTagTable } from "./tag";
import { taskTable } from "./task";

const relationalSchema = {
  account,
  session,
  tagTable,
  taskTable,
  taskTagTable,
  user,
};

// Better Auth's adapter joins through these when `advanced.database.joins`
// is on, so the auth keys and names follow its convention: `user`,
// `user.accounts`, `user.sessions`, `account.user`, `session.user`.
export const relations = defineRelations(relationalSchema, (r) => ({
  account: {
    user: r.one.user({
      from: r.account.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      optional: false,
      to: r.user.id,
    }),
  },
  tagTable: {
    taskTags: r.many.taskTagTable({
      from: r.tagTable.id,
      to: r.taskTagTable.tagId,
    }),
  },
  taskTable: {
    taskTags: r.many.taskTagTable({
      from: r.taskTable.id,
      to: r.taskTagTable.taskId,
    }),
  },
  taskTagTable: {
    tag: r.one.tagTable({
      from: r.taskTagTable.tagId,
      optional: false,
      to: r.tagTable.id,
    }),
    task: r.one.taskTable({
      from: r.taskTagTable.taskId,
      optional: false,
      to: r.taskTable.id,
    }),
  },
  user: {
    accounts: r.many.account(),
    sessions: r.many.session(),
  },
}));
