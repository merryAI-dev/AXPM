import { NextRequest, NextResponse } from "next/server";
import {
  randomBytes,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { google } from "googleapis";
import { z } from "zod";
import {
  authenticate,
  ApiError,
  userDoc,
  db,
  audit,
  storage,
} from "@/lib/firebase";
import {
  overview,
  settings,
  settingsSchema,
  saveSnapshot,
  decide,
  snapshot,
} from "@/lib/store";
import { importWorkbooks, type Input } from "@/lib/importer";
import {
  oauthClient,
  SCOPES,
  encrypt,
  decrypt,
  readSheetAsWorkbook,
} from "@/lib/google";
import { runAgent } from "@/lib/agent";
import { defaultMapping, inspectTemplate, fillTemplate } from "@/lib/template";
import { bridgeRequest, issueBridgeKey } from "@/lib/bridge";
export const runtime = "nodejs";
export const maxDuration = 300;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const fieldsSchema = z.object(
  Object.fromEntries(
    Object.keys(defaultMapping).map((k) => [k, z.string().max(16000)]),
  ) as Record<string, z.ZodString>,
);
async function sync(uid: string) {
  const config = await settings(uid);
  if (!config.sheetUrls.mentor || !config.sheetUrls.applications)
    throw new Error("멘토용 마스터와 특화 신청 시트 URL이 필요합니다.");
  const inputs = await Promise.all(
    Object.entries(config.sheetUrls)
      .filter(([, url]) => url)
      .map(([role, url]) =>
        readSheetAsWorkbook(uid, role as Input["role"], url),
      ),
  );
  const data = await importWorkbooks(inputs);
  await saveSnapshot(uid, data);
  return data;
}
async function handle(request: NextRequest) {
  const path = request.nextUrl.pathname.replace("/api/", "");
  try {
    if (path === "bridge" && request.method === "POST")
      return NextResponse.json(await bridgeRequest(request));
    if (path === "google/callback" && request.method === "GET") {
      const state = request.nextUrl.searchParams.get("state");
      const cookie = request.cookies.get("axpm-oauth")?.value;
      if (!state || !cookie || hash(state) !== cookie)
        throw new ApiError(
          400,
          "Google 연결 요청이 만료되었습니다. 다시 시도해주세요.",
        );
      const ref = db().collection("oauthStates").doc(hash(state));
      const saved = await ref.firestore.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists || s.data()!.expires < Date.now())
          throw new ApiError(400, "만료된 연결 요청입니다.");
        tx.delete(ref);
        return s.data()!;
      });
      const code = request.nextUrl.searchParams.get("code");
      if (!code) throw new ApiError(400, "Google 권한 동의가 취소되었습니다.");
      const client = oauthClient();
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);
      const profile = await google
        .oauth2({ version: "v2", auth: client })
        .userinfo.get();
      if (
        !profile.data.verified_email ||
        profile.data.email?.toLowerCase() !== saved.email.toLowerCase()
      )
        throw new ApiError(
          403,
          "로그인한 운영 계정과 동일한 Google 계정을 연결해주세요.",
        );
      const info = await client.getTokenInfo(tokens.access_token!);
      const privateRef = userDoc(saved.uid).collection("private").doc("google");
      const previous = await privateRef.get();
      const old = previous.exists ? decrypt(previous.data()!.tokens) : {};
      if (!tokens.refresh_token && !old.refresh_token)
        throw new Error(
          "오프라인 접근 동의가 필요합니다. Google 연결을 해제하고 다시 연결해주세요.",
        );
      await privateRef.set({
        tokens: encrypt({
          ...tokens,
          refresh_token: tokens.refresh_token || old.refresh_token,
        }),
        scopes: info.scopes,
        email: profile.data.email,
        connectedAt: new Date().toISOString(),
      });
      await audit(saved.uid, "google.connect", { scopes: info.scopes });
      const response = NextResponse.redirect(
        `${process.env.APP_ORIGIN}/?connected=google`,
      );
      response.cookies.delete("axpm-oauth");
      return response;
    }
    if (path === "cron" && request.method === "POST") {
      const expected = process.env.CRON_SECRET;
      const actual =
        request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
      if (
        !expected ||
        expected.length < 32 ||
        actual.length !== expected.length ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      )
        throw new ApiError(401, "인증 실패");
      const { uid } = z
        .object({ uid: z.string().min(1).max(128) })
        .parse(await request.json());
      if (!(await settings(uid)).monitoringEnabled)
        return NextResponse.json({ skipped: true });
      await sync(uid);
      return NextResponse.json(
        await runAgent(
          uid,
          "최신 시트의 전담·특화 미신청 후보, 진행횟수, 누락, 일정 확인사항을 점검하고 우선순위를 보고해주세요. 외부 발송은 제안만 하세요.",
          true,
        ),
      );
    }
    const user = await authenticate(request);
    const uid = user.uid;
    const base = userDoc(uid);
    if (path === "bridge/key" && request.method === "POST")
      return NextResponse.json(await issueBridgeKey(uid, user.email || ""));
    if (path === "bridge/revoke" && request.method === "POST") {
      const keys = await db()
        .collection("bridgeKeys")
        .where("uid", "==", uid)
        .get();
      await Promise.all(keys.docs.map((x) => x.ref.delete()));
      return NextResponse.json({ ok: true });
    }
    if (path === "state" && request.method === "GET")
      return NextResponse.json({ ...(await overview(uid)), uid });
    if (path === "audit" && request.method === "GET")
      return NextResponse.json(
        (
          await base
            .collection("audit")
            .orderBy("createdAt", "desc")
            .limit(50)
            .get()
        ).docs.map((x) => ({ id: x.id, ...x.data() })),
      );
    if (path === "settings" && request.method === "POST") {
      const config = settingsSchema.parse(await request.json());
      await base.collection("config").doc("settings").set(config);
      return NextResponse.json({ ok: true });
    }
    if (path === "import" && request.method === "POST") {
      if (Number(request.headers.get("content-length") || 0) > 30_000_000)
        throw new ApiError(413, "업로드 파일 합계는 30MB 이하여야 합니다.");
      const form = await request.formData();
      const inputs: Input[] = [];
      for (const role of [
        "mentor",
        "internal",
        "applications",
        "dedicated",
      ] as const) {
        const f = form.get(role);
        if (!(f instanceof File) || f.size === 0) continue;
        if (f.size > 10_000_000 || !f.name.endsWith(".xlsx"))
          throw new Error("파일별 10MB 이하의 .xlsx만 지원합니다.");
        inputs.push({
          role,
          name: f.name,
          buffer: Buffer.from(await f.arrayBuffer()),
        });
      }
      const data = await importWorkbooks(inputs);
      await saveSnapshot(uid, data);
      return NextResponse.json({
        companies: data.companies.length,
        appointments: data.appointments.length,
      });
    }
    if (path === "sync" && request.method === "POST") {
      const data = await sync(uid);
      return NextResponse.json({
        companies: data.companies.length,
        appointments: data.appointments.length,
      });
    }
    if (path === "agent" && request.method === "POST") {
      const { goal } = z
        .object({ goal: z.string().min(1).max(18000) })
        .parse(await request.json());
      return NextResponse.json(await runAgent(uid, goal));
    }
    if (path === "proposal" && request.method === "POST") {
      const { id, approve } = z
        .object({ id: z.string(), approve: z.boolean() })
        .parse(await request.json());
      await decide(uid, id, approve);
      return NextResponse.json({ ok: true });
    }
    if (path === "google/connect" && request.method === "POST") {
      const { capability } = z
        .object({ capability: z.enum(["sheets", "gmail", "calendar"]) })
        .parse(await request.json());
      const client = oauthClient();
      encrypt({ check: true }); // Validate key before sending user through OAuth.
      const state = randomBytes(32).toString("hex");
      await db()
        .collection("oauthStates")
        .doc(hash(state))
        .set({ uid, email: user.email, expires: Date.now() + 10 * 60000 });
      const url = client.generateAuthUrl({
        scope: ["openid", "email", ...SCOPES[capability]],
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        state,
        login_hint: user.email,
      });
      const response = NextResponse.json({ url });
      response.cookies.set("axpm-oauth", hash(state), {
        httpOnly: true,
        secure: process.env.APP_ORIGIN?.startsWith("https:"),
        sameSite: "lax",
        maxAge: 600,
        path: "/api/google/callback",
      });
      return response;
    }
    if (path === "google/disconnect" && request.method === "POST") {
      const ref = base.collection("private").doc("google");
      const saved = await ref.get();
      if (saved.exists) {
        const tokens = decrypt(saved.data()!.tokens);
        await oauthClient().revokeToken(
          tokens.refresh_token || tokens.access_token,
        );
        await ref.delete();
      }
      await audit(uid, "google.disconnect", {});
      return NextResponse.json({ ok: true });
    }
    if (path === "template" && request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("템플릿 파일이 필요합니다.");
      if (file.size > 10000000)
        throw new Error("템플릿은 10MB 이하로 업로드해주세요.");
      const buffer = Buffer.from(await file.arrayBuffer());
      const info = await inspectTemplate(buffer);
      const objectPath = `users/${uid}/templates/${randomUUID()}.xlsx`;
      await storage()
        .file(objectPath)
        .save(buffer, {
          resumable: false,
          metadata: {
            contentType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        });
      await base
        .collection("private")
        .doc("template")
        .set({
          name: file.name,
          objectPath,
          imageCount: info.imageCount,
          sheets: info.sheets,
          sheet: info.sheets[0],
          mapping: info.mapping,
          sha256: hash(buffer.toString("base64")),
        });
      return NextResponse.json(info);
    }
    if (path === "template/mapping" && request.method === "POST") {
      const input = z
        .object({
          sheet: z.string(),
          mapping: z.record(z.string(), z.string()),
        })
        .parse(await request.json());
      const ref = base.collection("private").doc("template");
      const template = (await ref.get()).data();
      if (!template) throw new Error("먼저 템플릿을 업로드해주세요.");
      const [original] = await storage().file(template.objectPath).download();
      await fillTemplate(
        original,
        input.sheet,
        input.mapping,
        Object.fromEntries(Object.keys(defaultMapping).map((k) => [k, ""])),
      );
      await ref.update(input);
      return NextResponse.json({ ok: true });
    }
    if (path === "report" && request.method === "POST") {
      const input = z
        .object({
          id: z.string().uuid().optional(),
          companyId: z.string(),
          fields: fieldsSchema,
        })
        .parse(await request.json());
      const data = await snapshot(uid);
      const company = data?.companies.find((x) => x.id === input.companyId);
      if (!company || input.fields.company !== company.name)
        throw new Error("보고서 기업명이 선택한 기업과 일치해야 합니다.");
      const id = input.id || randomUUID();
      const ref = base.collection("reports").doc(id);
      const previous = (await ref.get()).data();
      if (previous && previous.companyId !== input.companyId)
        throw new Error("기존 보고서의 기업을 변경할 수 없습니다.");
      await ref.set({
        id,
        companyId: input.companyId,
        fields: input.fields,
        status: "reviewed",
        snapshotId: data!.id,
        createdAt: previous?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json({ id });
    }
    if (path === "report/download" && request.method === "POST") {
      const { id } = z
        .object({ id: z.string().uuid() })
        .parse(await request.json());
      const report = (await base.collection("reports").doc(id).get()).data();
      const template = (
        await base.collection("private").doc("template").get()
      ).data();
      if (!report || !template)
        throw new Error("보고서와 템플릿을 먼저 저장해주세요.");
      if (report.status !== "reviewed")
        throw new Error("보고서 초안을 검토하고 저장한 뒤 다운로드해주세요.");
      const [original] = await storage().file(template.objectPath).download();
      const output = await fillTemplate(
        original,
        template.sheet,
        template.mapping,
        report.fields,
      );
      await audit(uid, "report.download", {
        reportId: id,
        templateHash: template.sha256,
      });
      return new Response(new Uint8Array(output), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="mentoring-report-${id.slice(0, 8)}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }
    throw new ApiError(404, "요청을 찾을 수 없습니다.");
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 400;
    const message =
      e instanceof z.ZodError
        ? "입력값을 확인해주세요."
        : e instanceof Error
          ? e.message
          : "요청을 처리하지 못했습니다.";
    // Provider errors can contain request details; don't serialize error objects or credentials.
    return NextResponse.json({ error: message.slice(0, 500) }, { status });
  }
}
export { handle as GET, handle as POST };
