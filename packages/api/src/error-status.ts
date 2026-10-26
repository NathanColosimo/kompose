import {
  COMMON_ERROR_STATUS_MAP,
  walkProcedureContractsSync,
} from "@orpc/server";
import { clientErrorStatuses } from "./errors";
import { appContract } from "./routers";

/**
 * HTTP status for each error code: oRPC's common codes plus every client
 * error a contract declares, from that error class's `httpApiStatus`.
 */
export const errorStatusMap: Record<string, number> = {
  ...COMMON_ERROR_STATUS_MAP,
};

walkProcedureContractsSync(appContract, (procedure) => {
  Object.assign(
    errorStatusMap,
    clientErrorStatuses(procedure["~orpc"].errorMap)
  );
});
