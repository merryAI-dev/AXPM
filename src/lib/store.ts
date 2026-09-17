import { userDoc, ApiError, audit } from "./firebase";
import type { Proposal } from "./types";

export async function decide(uid: string, id: string, approval: boolean) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("제안 ID를 확인해주세요.");
  const ref = userDoc(uid).collection("proposals").doc(id);
  let proposal!: Proposal;
  await ref.firestore.runTransaction(async (tx) => {
    const record = await tx.get(ref);
    proposal = record.data() as Proposal;
    if (
      !proposal ||
      proposal.kind !== "master_reversal" ||
      proposal.status !== "pending"
    )
      throw new ApiError(409, "이미 처리되었거나 존재하지 않는 제안입니다.");
    tx.update(ref, {
      status: approval ? "executing" : "rejected",
      decidedAt: new Date().toISOString(),
    });
  });
  if (!approval) return;
  try {
    if (!proposal.masterEventId || !proposal.fileId || !proposal.round)
      throw new Error("자동 반영 취소 근거가 부족합니다.");
    const result = await (
      await import("./automation/master-service")
    ).reverseMasterEvent(uid, {
      masterEventId: proposal.masterEventId,
      proposalId: id,
      fileId: proposal.fileId,
      round: proposal.round,
    });
    await ref.update({ status: "done", reversalResult: result });
    await audit(uid, "master.reversal.execute", {
      proposalId: id,
      masterEventId: proposal.masterEventId,
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "자동 반영 취소 확인 실패";
    if (message.includes("보고서 원본이 다시 유효")) {
      await ref.update({
        status: "obsolete",
        error: message,
        decidedAt: new Date().toISOString(),
      });
      throw new ApiError(409, message);
    }
    await ref.update({
      status: "uncertain",
      error: `${message} 활동 이력과 마스터 원본을 확인해주세요.`,
    });
    throw new ApiError(
      409,
      "자동 반영 취소 결과 확인이 필요합니다. 중복 원복 방지를 위해 자동 재시도하지 않습니다.",
    );
  }
}
