import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, userDoc, ApiError, isEmulator, audit } from "./firebase";
import { overview, propose } from "./store";
import { gmailSearch, calendarList } from "./google";
import { defaultMapping } from "./report-fields";
import { operationsContext, companyContext } from "./agent-context";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function issueBridgeKey(uid: string, email: string) {
  const raw = `axpm_${randomBytes(32).toString("hex")}`;
  const expires = Date.now() + 24 * 3600000;
  await db()
    .collection("bridgeKeys")
    .doc(hash(raw))
    .set({ uid, email, expires });
  await audit(uid, "bridge.key.issue", { expires });
  return { key: raw, expires };
}
export async function bridgeRequest(request: Request) {
  const raw =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const key = await db().collection("bridgeKeys").doc(hash(raw)).get();
  const owner = key.data();
  if (!owner || owner.expires < Date.now())
    throw new ApiError(401, "MCP 연결 키가 만료되었거나 유효하지 않습니다.");
  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase());
  if (!isEmulator() && !allowed.includes(owner.email.toLowerCase()))
    throw new ApiError(403, "운영자 접근이 해제되었습니다.");
  const { operation, input } = z
    .object({
      operation: z.enum([
        "overview",
        "company",
        "propose",
        "report_draft",
        "mail",
        "calendar",
      ]),
      input: z.record(z.string(), z.unknown()).default({}),
    })
    .parse(await request.json());
  const state = await overview(owner.uid);
  if (operation === "overview") return operationsContext(state);
  if (operation === "company") {
    const { companyId } = z.object({ companyId: z.string() }).parse(input);
    return companyContext(state, companyId);
  }
  if (operation === "mail") {
    const { companyId } = z.object({ companyId: z.string() }).parse(input);
    const company = state.snapshot?.companies.find((c) => c.id === companyId);
    if (!company || !z.email().safeParse(company.email).success)
      throw new Error("기업 이메일을 확인해주세요.");
    return gmailSearch(owner.uid, state.settings.gmailQuery, company.email);
  }
  if (operation === "calendar") {
    const p = z
      .object({
        start: z.iso.datetime({ offset: true }),
        end: z.iso.datetime({ offset: true }),
      })
      .parse(input);
    if (
      Date.parse(p.end) <= Date.parse(p.start) ||
      Date.parse(p.end) - Date.parse(p.start) > 31 * 86400000
    )
      throw new Error("조회 기간은 최대 31일입니다.");
    return calendarList(owner.uid, p.start, p.end);
  }
  if (operation === "propose") {
    const p = z
      .object({
        userRequest: z.string().min(1).max(18000),
        proposal: z.record(z.string(), z.unknown()),
      })
      .parse(input);
    const requestId = `user:${randomUUID()}`;
    // External agent request is an asserted instruction, never proof of approval.
    await audit(owner.uid, "bridge.proposal.request", {
      requestId,
      userRequest: p.userRequest,
    });
    return propose(
      owner.uid,
      {
        ...p.proposal,
        evidenceIds: [
          ...((p.proposal.evidenceIds as string[]) || []),
          requestId,
        ],
      },
      [requestId],
    );
  }
  const p = z
    .object({
      companyId: z.string(),
      fields: z.object(
        Object.fromEntries(
          Object.keys(defaultMapping).map((k) => [k, z.string().max(16000)]),
        ) as Record<string, z.ZodString>,
      ),
      sourceNotes: z.string().min(1).max(18000),
    })
    .parse(input);
  const company = state.snapshot?.companies.find((c) => c.id === p.companyId);
  if (!company || p.fields.company !== company.name)
    throw new Error("보고서 기업명과 원본이 일치해야 합니다.");
  const id = randomUUID();
  await userDoc(owner.uid)
    .collection("reports")
    .doc(id)
    .set({
      id,
      companyId: p.companyId,
      fields: p.fields,
      sourceNotes: p.sourceNotes,
      status: "draft",
      createdAt: new Date().toISOString(),
      snapshotId: state.snapshot!.id,
    });
  return {
    id,
    status: "draft",
    message: "운영 콘솔에서 검토한 뒤 원본 양식으로 다운로드하세요.",
  };
}
