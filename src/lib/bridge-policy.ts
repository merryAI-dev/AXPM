import { ApiError } from "./firebase";
export type BridgePermissions = {
  readOnly?: boolean;
  allowAgent?: boolean;
  allowMasterWrite?: boolean;
  allowOperationsWrite?: boolean;
};
export function hermesPermissions(scheduled: boolean): BridgePermissions {
  return {
    allowAgent: false,
    readOnly: scheduled,
    allowMasterWrite: !scheduled,
    allowOperationsWrite: !scheduled,
  };
}
export function authorizeBridgeOperation(
  owner: BridgePermissions,
  operation: string,
) {
  if (
    owner.readOnly &&
    [
      "agent",
      "record_mentoring",
      "apply_report_submissions",
      "apply_report_names",
      "sync_mail_attachments",
      "propose_drive_change",
    ].includes(operation)
  )
    throw new ApiError(403, "정기 점검 키는 조회만 허용합니다.");
  if (operation === "agent" && !owner.allowAgent)
    throw new ApiError(403, "이 키에는 에이전트 실행 권한이 없습니다.");
  if (
    [
      "record_mentoring",
      "apply_report_submissions",
      "apply_report_names",
      "sync_mail_attachments",
    ].includes(operation) &&
    !owner.allowAgent &&
    !owner.allowMasterWrite
  )
    throw new ApiError(403, "이 키에는 마스터 기록 권한이 없습니다.");
}
