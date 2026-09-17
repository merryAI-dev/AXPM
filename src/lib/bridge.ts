import { authorizeBridgeOperation } from "./bridge-policy";
import { inspectMaster, recordMasterEvent } from "./automation/master-service";
import { runAgent } from "./agent";
import { workspaceTools, callWorkspaceTool } from "./workspace/agent-tools";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, userDoc, ApiError, isEmulator, audit } from "./firebase";
import { isAuthorizedEmail } from "./access-policy";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function issueBridgeKey(
  uid: string,
  email: string,
  allowAgent = false,
  readOnly = false,
  allowMasterWrite = false,
  allowOperationsWrite = false,
) {
  const raw = `axpm_${randomBytes(32).toString("hex")}`;
  const expires = Date.now() + 24 * 3600000;
  await db().collection("bridgeKeys").doc(hash(raw)).set({
    uid,
    email,
    expires,
    allowAgent,
    readOnly,
    allowMasterWrite,
    allowOperationsWrite,
  });
  await audit(uid, "bridge.key.issue", { expires });
  return { key: raw, expires };
}
export async function authenticateBridge(request: Request) {
  const raw =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const key = await db().collection("bridgeKeys").doc(hash(raw)).get();
  const owner = key.data();
  if (!owner || owner.expires < Date.now())
    throw new ApiError(401, "MCP 연결 키가 만료되었거나 유효하지 않습니다.");
  if (!isEmulator() && !isAuthorizedEmail(owner.email))
    throw new ApiError(403, "운영자 접근이 해제되었습니다.");
  return owner;
}
export async function bridgeRequest(request: Request) {
  const owner = await authenticateBridge(request);
  const { operation, input } = z
    .object({
      operation: z.enum([
        "agent",
        "master",
        "record_mentoring",
        "inspect_workspace",
        "inspect_report_watch",
        "inspect_report_file",
        "apply_report_submissions",
        "apply_report_names",
        "scan_report_submissions",
        "preview_report_names",
        "list_drive_files",
        "search_drive_index",
        "read_drive_cells",
        "propose_drive_change",
        "inspect_mail_intake",
        "sync_mail_attachments",
      ]),
      input: z.record(z.string(), z.unknown()).default({}),
    })
    .parse(await request.json());
  authorizeBridgeOperation(owner, operation);
  await audit(owner.uid, "bridge.call", { operation });
  if (operation === "agent") {
    const { goal } = z
      .object({ goal: z.string().min(1).max(18000) })
      .parse(input);
    return runAgent(owner.uid, goal);
  }
  if (operation === "master")
    return inspectMaster(
      owner.uid,
      z.object({ campus: z.string().max(40).optional() }).parse(input).campus,
    );
  if (operation === "record_mentoring") {
    return recordMasterEvent(owner.uid, input, "agent");
  }
  if (operation in workspaceTools)
    return callWorkspaceTool(owner.uid, operation, input);
  throw new ApiError(404, "지원하지 않는 에이전트 작업입니다.");
}
