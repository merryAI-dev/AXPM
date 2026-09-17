import {
  isQuotaError,
  QUOTA_MESSAGE,
  QUOTA_RETRY_SECONDS,
} from "@/lib/provider-errors";
import { reportWatchApi, runReportWatch } from "@/lib/automation/report-watch";
import { reportNameApi } from "@/lib/automation/report-name-service";
import { masterApi } from "@/lib/automation/master-service";
import {
  mailIntakeApi,
  syncMailAttachments,
} from "@/lib/automation/mail-intake";
import { finishGoogleUserOAuth } from "@/lib/google-user-oauth";
import { handleMcp } from "@/lib/mcp-http";
import { agentRuntime } from "@/lib/agent-runtime";
import { indexStep, indexStatus } from "@/lib/workspace/indexer";
import { workspaceApi } from "@/lib/workspace/api";
import { drainJobs, enqueueAgent } from "@/lib/workspace/jobs";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  authenticate,
  ApiError,
  userDoc,
  db,
} from "@/lib/firebase";
import { decide } from "@/lib/store";
import { runAgent } from "@/lib/agent";
import { bridgeRequest, issueBridgeKey } from "@/lib/bridge";
export const runtime = "nodejs";
export const maxDuration = 900;
async function handle(request: NextRequest) {
  const path = request.nextUrl.pathname.replace("/api/", "");
  try {
    if (path === "health" && request.method === "GET")
      return NextResponse.json({ status: "ok" });
    if (path === "mail/oauth/callback" && request.method === "GET") {
      await finishGoogleUserOAuth(request.nextUrl);
      return NextResponse.redirect(new URL("/?gmail=connected", process.env.APP_ORIGIN));
    }
    if (path === "mcp") return await handleMcp(request);
    if (path === "bridge" && request.method === "POST")
      return NextResponse.json(await bridgeRequest(request));
    if (["cron", "worker"].includes(path) && request.method === "POST") {
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
      const { uid, scope } = z
        .object({
          uid: z.string().min(1).max(128),
          scope: z.enum(["workspace", "reports", "mail"]).default("reports"),
        })
        .parse(await request.json());
      if (path === "worker")
        return NextResponse.json(await drainJobs(uid, runAgent));
      if (scope === "reports")
        return NextResponse.json(await runReportWatch(uid, true));
      if (scope === "mail")
        return NextResponse.json(await syncMailAttachments(uid, true));
      if (scope === "workspace") {
        const state = await indexStatus(uid);
        const scan = await indexStep(uid, !state || state.complete);
        if (!scan.complete || !agentRuntime().configured)
          return NextResponse.json({ scan, agent: "not_started" });
        return NextResponse.json({
          scan,
          job: await enqueueAgent(
            uid,
            "관리 폴더의 최신성과 보고서 파일을 실제 셀 근거로 점검하고 미확인 사항을 보고해주세요.",
            true,
          ),
        });
      }
      throw new ApiError(400, "지원하지 않는 예약 작업입니다.");
    }
    const user = await authenticate(request);
    const uid = user.uid;
    const base = userDoc(uid);
    const reportResponse =
      (await reportWatchApi(request, uid, path)) ||
      (await reportNameApi(request, uid, path));
    if (reportResponse) return reportResponse;
    const masterResponse = await masterApi(request, uid, path);
    if (masterResponse) return masterResponse;
    const mailResponse = await mailIntakeApi(request, uid, path);
    if (mailResponse) return mailResponse;
    const workspaceResponse = await workspaceApi(request, uid, path);
    if (workspaceResponse) return workspaceResponse;
    if (path === "bridge/key" && request.method === "POST") {
      const { allowAgent } = z
        .object({ allowAgent: z.boolean().default(false) })
        .parse(await request.json());
      return NextResponse.json(
        await issueBridgeKey(uid, user.email || "", allowAgent),
      );
    }
    if (path === "bridge/revoke" && request.method === "POST") {
      const keys = await db()
        .collection("bridgeKeys")
        .where("uid", "==", uid)
        .get();
      await Promise.all(keys.docs.map((x) => x.ref.delete()));
      return NextResponse.json({ ok: true });
    }
    if (path === "state" && request.method === "GET") {
      const [proposals, runs] = await Promise.all([
        base
          .collection("proposals")
          .where("kind", "==", "master_reversal")
          .limit(50)
          .get(),
        base.collection("runs").orderBy("createdAt", "desc").limit(10).get(),
      ]);
      return NextResponse.json({
        uid,
        proposals: proposals.docs
          .map((doc) => doc.data())
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
        runs: runs.docs.map((doc) => doc.data()),
        agentConfigured: agentRuntime().configured,
        agentRuntime: agentRuntime(),
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
    throw new ApiError(404, "요청을 찾을 수 없습니다.");
  } catch (e) {
    if (isQuotaError(e)) {
      console.error("Provider quota error", {
        path,
        code:
          typeof e === "object" && e && "code" in e
            ? String(e.code)
            : undefined,
        message: e instanceof Error ? e.message.slice(0, 500) : String(e),
      });
      return NextResponse.json(
        {
          error: QUOTA_MESSAGE,
          code: "RESOURCE_EXHAUSTED",
          retryAfter: QUOTA_RETRY_SECONDS,
        },
        {
          status: 429,
          headers: { "Retry-After": String(QUOTA_RETRY_SECONDS) },
        },
      );
    }
    const status = e instanceof ApiError ? e.status : 400;
    const message =
      e instanceof z.ZodError
        ? "입력값을 확인해주세요."
        : e instanceof Error
          ? e.message
          : "요청을 처리하지 못했습니다.";
    return NextResponse.json({ error: message.slice(0, 500) }, { status });
  }
}
export { handle as GET, handle as POST };
