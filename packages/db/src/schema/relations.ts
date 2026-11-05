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
  taskTable: {
    // A task's tags, joined through task_tag
    tags: r.many.tagTable({
      from: r.taskTable.id.through(r.taskTagTable.taskId),
      to: r.tagTable.id.through(r.taskTagTable.tagId),
    }),
  },
  user: {
    accounts: r.many.account(),
    sessions: r.many.session(),
  },
}));
