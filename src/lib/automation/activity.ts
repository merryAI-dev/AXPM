import { createReadCache } from "../read-cache";
import { userDoc } from "../firebase";
async function readActivity(uid: string) {
  const base = userDoc(uid);
  const [master, scans, agents] = await Promise.all([
    base
      .collection("masterEvents")
      .orderBy("createdAt", "desc")
      .limit(30)
      .get(),
    base
      .collection("automationActivity")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get(),
    base.collection("runs").orderBy("createdAt", "desc").limit(10).get(),
  ]);
  const items = [
    ...master.docs.map((doc) => {
      const d = doc.data();
      const reversal = d.activityType === "master-reversal";
      return {
        id: `master-${doc.id}`,
        type: d.activityType || "master-record",
        source: d.source || "unclassified",
        status: d.status,
        createdAt: d.createdAt,
        title: reversal
          ? `${d.event?.company || "기업 확인 필요"} · ${d.event?.kind || ""} ${d.event?.round || ""}회차 자동 반영 취소`
          : `${d.event?.company || "기업 확인 필요"} · ${d.event?.kind || ""} ${d.event?.round || ""}회차`,
        cells:
          d.result?.cells ||
          d.plan?.changes?.map((c: { cell: string }) => c.cell) ||
          [],
        changes: (d.plan?.changes || []).map(
          (c: {
            cell: string;
            before: { value: unknown };
            after: unknown;
            numberFormat?: { pattern: string };
          }) => ({
            cell: c.cell,
            before: c.before.value,
            after: c.after,
            format: c.numberFormat?.pattern || "",
          }),
        ),
        evidence: d.event?.evidence || "",
        error: ["verified", "reversed"].includes(d.status)
          ? ""
          : d.error || "",
        summary: d.result?.reconciliation || "",
        results: [],
      };
    }),
    ...scans.docs
      .filter((doc) => {
        const data = doc.data();
        return (
          data.type === "mail-intake" ||
          (data.type === "report-scan" &&
            (data.processed > 0 || ["attention", "failed"].includes(data.status)))
        );
      })
      .map((doc) => {
      const d = doc.data();
      const mail = d.type === "mail-intake";
      return {
        id: `scan-${doc.id}`,
        type: d.activityType || d.type,
        source: d.source,
        status: d.status,
        createdAt: d.createdAt,
        title: mail
          ? d.title || `메일 첨부 ${d.result?.collected || 0}건 수집`
          : `${d.autoApply ? "자동 반영 점검" : "보고서 미리보기 점검"} · ${d.processed || 0}/${d.totalFiles || 0}개 파일`,
        cells: [],
        changes: [],
        evidence: "",
        error: d.error || d.result?.errors?.join(" · ") || "",
        summary: mail
          ? `이름 통일 ${d.result?.normalized || 0}건 · 검토 필요 ${d.result?.review || 0}건 · 중복/제외 ${d.result?.skipped || 0}건`
          : "",
        results: d.results || [],
      };
    }),
    ...agents.docs.map((doc) => {
      const d = doc.data();
      return {
        id: `agent-${doc.id}`,
        type: "agent-run",
        source: "agent",
        status: d.status,
        createdAt: d.createdAt,
        title: d.goal || "에이전트 요청",
        cells: [],
        changes: [],
        evidence: "",
        error: d.error || "",
        summary: d.summary || "",
        results: [],
      };
    }),
  ]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);
  return { items, checkedAt: new Date().toISOString() };
}

const cachedActivity = createReadCache<
  Awaited<ReturnType<typeof readActivity>>
>(60_000, 100);
export async function automationActivity(uid: string) {
  return cachedActivity(uid, () => readActivity(uid));
}
