import { agentRuntime } from "./agent-runtime";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { userDoc, ApiError, audit } from "./firebase";
import { monitor } from "./importer";
import { sendMail, createCalendarEvent } from "./google";
import type { Snapshot, Settings, Proposal } from "./types";
export const settingsSchema = z.object({
  gmailQuery: z.string().max(300).default(""),
  monitoringEnabled: z.boolean().default(false),
  targetPerCompany: z.number().int().min(0).max(100).default(3),
  sheetUrls: z
    .object({
      mentor: z.string().max(300),
      applications: z.string().max(300),
      dedicated: z.string().max(300),
      internal: z.string().max(300),
    })
    .default({ mentor: "", applications: "", dedicated: "", internal: "" }),
});
export async function settings(uid: string) {
  return settingsSchema.parse(
    (await userDoc(uid).collection("config").doc("settings").get()).data() ||
      {},
  );
}
export async function snapshot(uid: string): Promise<Snapshot | null> {
  return (
    ((
      await userDoc(uid).collection("snapshots").doc("current").get()
    ).data() as Snapshot) || null
  );
}
export async function saveSnapshot(uid: string, data: Snapshot) {
  if (Buffer.byteLength(JSON.stringify(data)) > 850000)
    throw new Error(
      "현재 저장 한도(850KB)를 넘었습니다. 시트 범위를 줄여주세요.",
    );
  await userDoc(uid).collection("snapshots").doc("current").set(data);
  await audit(uid, "snapshot.import", {
    snapshotId: data.id,
    companies: data.companies.length,
    appointments: data.appointments.length,
  });
}
export async function overview(uid: string) {
  const base = userDoc(uid);
  const [data, config, proposals, runs, google, template, tickets, reports] =
    await Promise.all([
      snapshot(uid),
      settings(uid),
      base.collection("proposals").orderBy("createdAt", "desc").limit(50).get(),
      base.collection("runs").orderBy("createdAt", "desc").limit(15).get(),
      base.collection("private").doc("google").get(),
      base.collection("private").doc("template").get(),
      base.collection("tickets").get(),
      base.collection("reports").orderBy("createdAt", "desc").limit(30).get(),
    ]);
  return {
    snapshot: data,
    settings: config,
    findings: data
      ? monitor(
          data,
          config.targetPerCompany,
          new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
        )
      : [],
    proposals: proposals.docs.map((x) => x.data()),
    runs: runs.docs.map((x) => x.data()),
    tickets: tickets.docs.map((x) => x.data()),
    reports: reports.docs.map((x) => x.data()),
    google: google.exists
      ? {
          connected: true,
          scopes: google.data()!.scopes,
          email: google.data()!.email,
        }
      : { connected: false, scopes: [] },
    template: template.exists
      ? {
          imageCount: template.data()!.imageCount || 0,
          name: template.data()!.name,
          sheet: template.data()!.sheet,
          sheets: template.data()!.sheets,
          mapping: template.data()!.mapping,
        }
      : null,
    agentConfigured: agentRuntime().configured,
    agentRuntime: agentRuntime(),
    googleConfigured:
      !!process.env.GOOGLE_CLIENT_ID &&
      !!process.env.GOOGLE_CLIENT_SECRET &&
      !!process.env.TOKEN_ENCRYPTION_KEY,
  };
}
export const proposalInput = z.object({
  kind: z.enum(["email", "calendar", "ticket"]),
  title: z.string().min(1).max(160),
  reason: z.string().min(1).max(2000),
  evidenceIds: z.array(z.string()).min(1).max(20),
  companyId: z.string(),
  to: z.string().default(""),
  subject: z.string().max(200).default(""),
  body: z.string().max(12000).default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  ticketKind: z.enum(["dedicated", "specialty"]).optional(),
  ticketDelta: z.number().int().min(-100).max(100).optional(),
  hoursDelta: z.number().min(-1000).max(1000).optional(),
  ticketMode: z.enum(["set", "adjust"]).optional(),
});
export async function propose(
  uid: string,
  input: unknown,
  runEvidence: string[],
) {
  const p = proposalInput.parse(input);
  const data = await snapshot(uid);
  if (!data) throw new Error("먼저 시트를 연결해주세요.");
  const company = data.companies.find((x) => x.id === p.companyId);
  if (!company) throw new Error("기업을 찾을 수 없습니다.");
  const allowed = new Set([...data.evidence.map((x) => x.id), ...runEvidence]);
  if (p.evidenceIds.some((x) => !allowed.has(x)))
    throw new Error("실제 근거 ID만 사용할 수 있습니다.");
  if (p.kind !== "ticket") {
    if (
      !z.email().safeParse(p.to).success ||
      p.to.toLowerCase() !== company.email.toLowerCase()
    )
      throw new Error(
        "수신자는 선택 기업의 마스터시트 이메일과 일치해야 합니다.",
      );
    if (!p.body || !p.subject || /[\r\n]/.test(p.subject))
      throw new Error("메일/일정 제목과 본문을 확인해주세요.");
  }
  if (p.kind === "calendar") {
    if (
      !z.iso.datetime({ offset: true }).safeParse(p.start).success ||
      !z.iso.datetime({ offset: true }).safeParse(p.end).success ||
      Date.parse(p.end) <= Date.parse(p.start) ||
      Date.parse(p.start) < Date.now() ||
      Date.parse(p.end) - Date.parse(p.start) > 8 * 3600000
    )
      throw new Error("미래 일정의 시작·종료 시각(최대 8시간)을 확인해주세요.");
  }
  let ticketRevision = 0;
  if (p.kind === "ticket") {
    if (
      !p.ticketKind ||
      !p.ticketMode ||
      (p.ticketDelta == null && p.hoursDelta == null)
    )
      throw new Error("티켓 종류·조정 방식·횟수 또는 시간이 필요합니다.");
    const current = await userDoc(uid)
      .collection("tickets")
      .doc(`${p.companyId}-${p.ticketKind}`)
      .get();
    ticketRevision = current.data()?.revision || 0;
    ticketResult(current.data(), p);
    if (!p.evidenceIds.some((x) => x.startsWith("user:")))
      throw new Error(
        "티켓 조정은 사용자의 이번 대화 요청을 근거로 해야 합니다.",
      );
  }
  const proposal: Proposal = {
    ...p,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
    snapshotId: data.id,
    ticketRevision,
  };
  await userDoc(uid).collection("proposals").doc(proposal.id).set(proposal);
  return {
    id: proposal.id,
    status: proposal.status,
    message: "운영자 승인 대기. 아직 실행되지 않았습니다.",
  };
}
export function ticketResult(
  current: Record<string, unknown> | undefined,
  p: Pick<Proposal, "ticketMode" | "ticketDelta" | "hoursDelta">,
) {
  const calc = (field: string, amount: number | undefined) => {
    if (amount == null) return current?.[field] ?? null;
    if (p.ticketMode === "adjust" && typeof current?.[field] !== "number")
      throw new Error(
        "남은 티켓/시간 기준이 없습니다. 먼저 잔여 수량을 지정해주세요.",
      );
    const result =
      p.ticketMode === "set" ? amount : (current![field] as number) + amount;
    if (result < 0) throw new Error("잔여 티켓/시간은 음수가 될 수 없습니다.");
    return result;
  };
  return {
    remainingTickets: calc("remainingTickets", p.ticketDelta),
    remainingHours: calc("remainingHours", p.hoursDelta),
  };
}
export async function decide(uid: string, id: string, approval: boolean) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("제안 ID를 확인해주세요.");
  const base = userDoc(uid);
  const ref = base.collection("proposals").doc(id);
  let proposal!: Proposal;
  await ref.firestore.runTransaction(async (tx) => {
    const record = await tx.get(ref);
    proposal = record.data() as Proposal;
    if (!proposal || proposal.status !== "pending")
      throw new ApiError(409, "이미 처리되었거나 존재하지 않는 제안입니다.");
    if (!approval) {
      tx.update(ref, {
        status: "rejected",
        decidedAt: new Date().toISOString(),
      });
      return;
    }
    const current = await tx.get(base.collection("snapshots").doc("current"));
    if (current.data()?.id !== proposal.snapshotId)
      throw new ApiError(
        409,
        "시트가 갱신되었습니다. 최신 근거로 다시 제안해주세요.",
      );
    if (proposal.kind === "ticket") {
      const ticketRef = base
        .collection("tickets")
        .doc(`${proposal.companyId}-${proposal.ticketKind}`);
      const ticket = await tx.get(ticketRef);
      if ((ticket.data()?.revision || 0) !== proposal.ticketRevision)
        throw new ApiError(409, "티켓이 변경되었습니다. 다시 제안해주세요.");
      const result = ticketResult(ticket.data(), proposal);
      tx.set(ticketRef, {
        ...result,
        companyId: proposal.companyId,
        kind: proposal.ticketKind,
        revision: (proposal.ticketRevision || 0) + 1,
        updatedAt: new Date().toISOString(),
        reason: proposal.reason,
        proposalId: id,
        snapshotId: proposal.snapshotId,
      });
      tx.update(ref, { status: "done", decidedAt: new Date().toISOString() });
      tx.set(base.collection("audit").doc(), {
        action: "ticket.adjust",
        proposalId: id,
        before: ticket.data() || null,
        after: result,
        createdAt: new Date().toISOString(),
      });
    } else
      tx.update(ref, {
        status: "executing",
        decidedAt: new Date().toISOString(),
      });
  });
  if (!approval || proposal.kind === "ticket") return;
  try {
    const externalId =
      proposal.kind === "email"
        ? await sendMail(uid, proposal.to, proposal.subject, proposal.body, id)
        : await createCalendarEvent(
            uid,
            proposal.subject,
            proposal.body,
            proposal.start,
            proposal.end,
            proposal.to,
            id,
          );
    await ref.update({ status: "done", externalId });
    await audit(uid, `${proposal.kind}.execute`, {
      proposalId: id,
      externalId,
    });
  } catch {
    // External service may have accepted the request. Never blindly retry an uncertain send.
    await ref.update({
      status: "uncertain",
      error:
        "외부 처리 결과를 확정하지 못했습니다. Gmail/Calendar에서 확인한 뒤 새 제안을 진행해주세요.",
    });
    throw new ApiError(
      409,
      "처리 결과 확인이 필요합니다. 중복 실행 방지를 위해 자동 재시도하지 않습니다.",
    );
  }
}
