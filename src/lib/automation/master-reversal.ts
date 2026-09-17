import { randomUUID } from "node:crypto";
import { userDoc } from "../firebase";
import { digest } from "./blueprint";
import type { ReportSource } from "./report-submission";

type Submission = {
  round: number;
  tab: string;
  sourceHash: string;
  issues: string[];
  event: unknown;
};

function legacyEventId(fileId: string, round: number) {
  const base = `report-${digest({ file: fileId, round: String(round) }).slice(0, 40)}`;
  return `${base}-fields-v2`;
}

export async function detectMasterReversals(
  uid: string,
  source: ReportSource,
  submissions: Submission[],
) {
  const base = userDoc(uid);
  const observations = await base
    .collection("reportObservations")
    .where("fileId", "==", source.id)
    .get();
  const priorByRound = new Map<number, Record<string, unknown>>();
  for (const doc of observations.docs) {
    const data = doc.data();
    const round = Number(data.round);
    if (Number.isInteger(round) && round >= 1 && round <= 4)
      priorByRound.set(round, data);
  }
  for (const [round, previous] of priorByRound) {
    const masterEventId =
      typeof previous.masterEventId === "string" && previous.masterEventId
        ? previous.masterEventId
        : legacyEventId(source.id, round);
    const masterEvent = (
      await base.collection("masterEvents").doc(digest(masterEventId)).get()
    ).data();
    if (
      !masterEvent ||
      masterEvent.source !== "report-monitor" ||
      masterEvent.status !== "verified"
    )
      continue;
    const current = submissions.find((item) => item.round === round);
    const proposals = await base
      .collection("proposals")
      .where("masterEventId", "==", masterEventId)
      .limit(20)
      .get();
    if (current?.event) {
      await Promise.all(
        proposals.docs
          .filter((doc) => doc.data().status === "pending")
          .map((doc) =>
            doc.ref.update({
              status: "obsolete",
              decidedAt: new Date().toISOString(),
              reason:
                "보고서 원본이 다시 유효해져 자동 반영 취소 후보를 종료했습니다.",
            }),
          ),
      );
      continue;
    }
    const issues = current?.issues?.length
      ? current.issues
      : [`${round}회차 탭이 원본에서 사라졌습니다.`];
    const invalidHash = digest({
      masterEventId,
      state: current ? current.sourceHash : "missing",
      issues,
    });
    if (
      proposals.docs.some((doc) => {
        const data = doc.data();
        return (
          data.invalidHash === invalidHash ||
          ["pending", "executing", "uncertain"].includes(data.status)
        );
      })
    )
      continue;
    const id = randomUUID();
    await base.collection("proposals").doc(id).create({
      id,
      kind: "master_reversal",
      title: `${masterEvent.event?.company || previous.company || "기업 확인 필요"} · 전담 ${round}회차 반영 취소`,
      reason: issues.join(" "),
      evidenceIds: [
        `master-event:${masterEventId}`,
        `drive-file:${source.id}`,
      ],
      status: "pending",
      createdAt: new Date().toISOString(),
      masterEventId,
      fileId: source.id,
      fileName: source.name,
      tab: current?.tab || `${round}회차 (삭제됨)`,
      round,
      invalidHash,
      sourceVersion: source.version,
    });
  }
}
