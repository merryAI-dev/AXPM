import { isQuotaError } from "../provider-errors";
import {
  reportQueue,
  reportRetryDelay,
  type ReportCheckpoint,
} from "./report-queue";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { userDoc, ApiError } from "../firebase";
import { workspace } from "../workspace/drive";
import { digest } from "./blueprint";
import { matchReportCompany } from "./report-names";
import {
  inspectMaster,
  recordMasterEvent,
  reconcileMasterEvent,
} from "./master-service";
import {
  reportWatchSchema,
  inspectSubmissions,
  submissionState,
  type ReportWatchConfig,
} from "./report-submission";
import { readReportSource } from "./report-source";
import { reportCatalog } from "./report-catalog";
import { detectMasterReversals } from "./master-reversal";
const configRef = (uid: string) =>
  userDoc(uid).collection("config").doc("reportWatch");
const latestRef = (uid: string) =>
  userDoc(uid).collection("automation").doc("reportWatch");
export async function reportWatchStatus(uid: string) {
  const [config, latest, worker] = await Promise.all([
    configRef(uid).get(),
    latestRef(uid).get(),
    userDoc(uid).collection("automation").doc("reportWorker").get(),
  ]);
  return {
    config: config.data() || null,
    latest: latest.data() || null,
    worker: worker.data() || null,
  };
}
export async function setupReportWatch(uid: string, raw: unknown) {
  const config = reportWatchSchema.parse(raw);
  await (await workspace(uid)).folder(config.folderId);
  await configRef(uid).set(config);
  return config;
}
export async function runReportWatch(
  uid: string,
  scheduled = false,
  forcePreview = false,
  focusFileId?: string,
) {
  const raw = (await configRef(uid).get()).data();
  if (!raw) throw new Error("보고서 폴더 감시를 먼저 연결해주세요.");
  const config = reportWatchSchema.parse(raw);
  if (scheduled && !config.enabled) return { skipped: true };
  const lock = userDoc(uid).collection("private").doc("reportWatchLock"),
    token = randomUUID();
  await lock.firestore.runTransaction(async (tx) => {
    if (((await tx.get(lock)).data()?.until || 0) > Date.now())
      throw new ApiError(409, "보고서를 점검 중입니다.");
    tx.set(lock, { token, until: Date.now() + 10 * 60_000 });
  });
  try {
    const runStarted = Date.now();
    const ws = await workspace(uid),
      files = await reportCatalog(ws, config.folderId);
    let master: Awaited<ReturnType<typeof inspectMaster>> | undefined;
    const results: Record<string, unknown>[] = [];
    const started = Date.now();
    let processed = 0;
    const catalogHash = digest(files.map((f) => f.id).sort());
    const configHash = digest({ config, processorVersion: 4 });
    const checkpointRef = userDoc(uid)
      .collection("automation")
      .doc("reportQueue");
    const checkpointDoc = await checkpointRef.get();
    const legacy = checkpointDoc.exists
      ? []
      : (await userDoc(uid).collection("reportCheckpoints").get()).docs.map(
          (d) => [d.id, d.data() as ReportCheckpoint] as const,
        );
    const checkpoints = new Map<string, ReportCheckpoint>(
      checkpointDoc.exists
        ? (Object.entries(checkpointDoc.data()?.entries || {}) as [
            string,
            ReportCheckpoint,
          ][])
        : legacy,
    );
    const queue = focusFileId
      ? files.filter((f) => f.id === focusFileId)
      : reportQueue(files, checkpoints, configHash, 60, Date.now());
    if (focusFileId && !queue.length)
      throw new Error("지정 보고서가 감시 폴더에 없습니다.");
    const uncertainEvents = new Set(
      (
        await userDoc(uid)
          .collection("masterEvents")
          .where("status", "==", "uncertain")
          .get()
      ).docs.map((d) => d.data().event?.eventId),
    );
    const offset = 0;
    for (const file of queue) {
      if (Date.now() - started > 60000 || processed >= 15) break;
      const resultStart = results.length;
      processed++;
      try {
        await ws.expect(file.id, file.version);
        const source = await readReportSource(uid, ws, file.id);
        if (source.version !== file.version)
          throw new Error(
            "목록 조회 후 보고서가 변경되었습니다. 다음 점검에서 다시 읽습니다.",
          );
        const submissions = inspectSubmissions(source, config);
        await detectMasterReversals(uid, source, submissions);
        if (!submissions.length)
          results.push({
            fileId: file.id,
            fileName: file.name,
            status: "unmapped",
            issues: ["1~4회차 보고서 탭을 찾지 못했습니다."],
          });
        for (const candidate of submissions) {
          const ref = userDoc(uid)
            .collection("reportObservations")
            .doc(digest({ fileId: file.id, tab: candidate.tab }));
          const previous = (await ref.get()).data();
          const readiness = submissionState(
            candidate.issues,
            candidate.sourceHash,
            configHash,
            previous,
            Date.now(),
          );
          const firstSeenAt = readiness.firstSeenAt;
          let status = readiness.status;
          let error = "";
          let masterEventId =
            typeof previous?.masterEventId === "string"
              ? previous.masterEventId
              : "";
          if (status === "ready" && candidate.event) {
            try {
              master ??= await inspectMaster(uid, undefined, false);
              const company = matchReportCompany(
                candidate.event.company,
                candidate.event.campus,
                master.companies,
              );
              const mentorName = (s: string) =>
                s
                  .trim()
                  .replace(/\s*멘토(?:님)?$/, "")
                  .trim();
              if (
                mentorName(company.mentor) !==
                mentorName(candidate.event.mentor)
              )
                throw new Error("전담 멘토가 마스터와 일치하지 않습니다.");
              for (const pendingId of uncertainEvents) {
                if (
                  typeof pendingId === "string" &&
                  (pendingId === candidate.event.eventId ||
                    pendingId.startsWith(`${candidate.event.eventId}-fields-`))
                )
                  await reconcileMasterEvent(uid, pendingId);
              }
              const hasCompletion = company.completedRounds.includes(
                candidate.event.round,
              );
              const missingDate = company.missingReportRounds.includes(
                candidate.event.round,
              );
              const needsDateFormat = company.unformattedReportRounds.includes(
                candidate.event.round,
              );
              if (hasCompletion && !missingDate && !needsDateFormat) {
                status = "unchanged";
              } else {
                const event = {
                  ...candidate.event,
                  eventId: `${candidate.event.eventId}-fields-v3-${digest({ sourceHash: candidate.sourceHash, version: source.version }).slice(0, 12)}`,
                  company: company.company,
                  campus: company.campus,
                };
                masterEventId = event.eventId;
                const preview = await recordMasterEvent(uid, {
                  event,
                  mode: "preview",
                });
                if (!("planHash" in preview)) status = preview.status;
                else if (config.autoApply && !forcePreview) {
                  await ws.expect(file.id, source.version);
                  const currentLock = (await lock.get()).data();
                  if (
                    currentLock?.token !== token ||
                    currentLock.until <= Date.now()
                  )
                    throw new Error("보고서 감시 실행 잠금이 만료되었습니다.");
                  const applied = await recordMasterEvent(
                    uid,
                    {
                      event,
                      mode: "apply",
                      expectedPlan: preview.planHash,
                    },
                    "report-monitor",
                  );
                  status = applied.status;
                  try {
                    await ws.expect(file.id, source.version);
                  } catch {
                    status = "uncertain";
                    error =
                      "마스터 반영 후 보고서 원본 변경이 감지되었습니다. 원본과 반영 이력을 대조해주세요.";
                  }
                } else status = "preview";
              }
            } catch (e) {
              if (isQuotaError(e)) throw e;
              status = "blocked";
              error = e instanceof Error ? e.message : "마스터 반영 실패";
            }
          }
          const result = {
            fileId: file.id,
            fileName: file.name,
            tab: candidate.tab,
            company: candidate.company,
            round: candidate.round,
            status,
            issues: candidate.issues,
            error,
            sourceHash: candidate.sourceHash,
            masterEventId,
            firstSeenAt,
            configHash,
            checkedAt: new Date().toISOString(),
          };
          await ref.set(result);
          results.push(result);
        }
        const fileResults = results.slice(resultStart);
        const retryable = fileResults.some(
          (r) =>
            r.status === "blocked" &&
            /조회 중 마스터가 변경|다시 읽어|잠금|점검 중|429|503|timeout/i.test(
              String(r.error),
            ),
        );
        const failures = retryable
          ? (checkpoints.get(file.id)?.failures || 0) + 1
          : 0;
        checkpoints.set(file.id, {
          version: file.version,
          configHash,
          checkedAt: Date.now(),
          modifiedTime: file.modifiedTime || "",
          failures,
          retryAt:
            Date.now() + (retryable ? reportRetryDelay(failures) : 60_000),
          revisit:
            retryable ||
            fileResults.some((r) =>
              ["ready", "preview", "error"].includes(String(r.status)),
            ),
        });
      } catch (e) {
        if (isQuotaError(e)) throw e;
        const failures = (checkpoints.get(file.id)?.failures || 0) + 1;
        checkpoints.set(file.id, {
          version: file.version,
          configHash,
          checkedAt: Date.now(),
          revisit: true,
          failures,
          retryAt: Date.now() + reportRetryDelay(failures),
        });
        results.push({
          fileId: file.id,
          fileName: file.name,
          status: "error",
          issues: [e instanceof Error ? e.message : "보고서 조회 실패"],
        });
      }
    }
    if (processed || !checkpointDoc.exists) {
      const activeIds = new Set(files.map((f) => f.id));
      await checkpointRef.set({
        entries: Object.fromEntries(
          [...checkpoints].filter(([id]) => activeIds.has(id)),
        ),
        updatedAt: new Date().toISOString(),
      });
    }
    const nextOffset = processed < queue.length ? processed : 0;
    const latest = {
      results,
      checkedAt: new Date().toISOString(),
      totalFiles: files.length,
      eligibleFiles: queue.length,
      skippedFiles: files.length - queue.length,
      durationMs: Date.now() - runStarted,
      pendingFiles: queue.length - processed,
      processed,
      offset,
      nextOffset,
      complete: nextOffset === 0,
      catalogHash,
      configHash,
      autoApply: config.autoApply && !forcePreview,
    };
    await latestRef(uid).set(latest);
    if (processed || !scheduled)
      await userDoc(uid)
        .collection("automationActivity")
        .doc(token)
        .set({
          type: "report-scan",
          source: "report-monitor",
          createdAt: latest.checkedAt,
          status: results.some((r) =>
            ["error", "blocked", "uncertain"].includes(String(r.status)),
          )
            ? "attention"
            : "done",
          autoApply: latest.autoApply,
          processed,
          totalFiles: files.length,
          eligibleFiles: latest.eligibleFiles,
          skippedFiles: latest.skippedFiles,
          durationMs: latest.durationMs,
          results: results.map((r) => ({
            fileId: r.fileId,
            fileName: r.fileName || "",
            tab: r.tab || "",
            company: r.company || "",
            status: r.status,
            issues: r.issues || [],
            error: r.error || "",
          })),
        });
    return latest;
  } catch (error) {
    if (!isQuotaError(error))
      await userDoc(uid)
        .collection("automationActivity")
        .doc(token)
        .set({
          type: "report-scan",
          source: "report-monitor",
          createdAt: new Date().toISOString(),
          status: "failed",
          error: error instanceof Error ? error.message : "보고서 점검 실패",
        })
        .catch(() => {});
    throw error;
  } finally {
    await lock.firestore.runTransaction(async (tx) => {
      if ((await tx.get(lock)).data()?.token === token) tx.delete(lock);
    });
  }
}
export async function reportWatchApi(
  request: Request,
  uid: string,
  path: string,
) {
  if (path === "automation/reports/agent" && request.method === "POST") {
    const input = z
      .object({
        mode: z.enum(["preview", "apply"]),
        task: z.enum(["reports", "names", "all"]).default("all"),
      })
      .parse(await request.json());
    const config = (await configRef(uid).get()).data() as
      ReportWatchConfig | undefined;
    if (!config) throw new Error("보고서 폴더 감시를 먼저 연결해주세요.");
    if (input.mode === "apply" && input.task !== "names" && !config.autoApply)
      throw new Error("보고서 자동 반영 설정을 먼저 켜주세요.");
    const { runAgent } = await import("../agent");
    const goal = `운영자가 요청한 보고서 자동화입니다. 대상 폴더 ID: ${config.folderId}. 작업: ${input.task}. 모드: ${input.mode}. 먼저 현재 설정과 실제 원본을 조사하세요. ${input.task !== "names" ? "필수 항목이 채워진 기존 회차 보고서를 점검하고 애매한 양식은 실제 셀을 더 읽어 보완 이유를 설명하세요." : ""} ${input.task !== "reports" ? "파일명 힌트를 본문·마스터와 대조해 통일 이름 목록을 만드세요." : ""} ${input.mode === "apply" ? "검증된 보고서 자동 반영 및 요청 범위의 파일명 일괄 변경을 실행한 뒤 원본을 재조회하세요. 필수 항목 누락·날짜 오류·충돌을 우회하지 마세요." : "변경을 실행하지 말고 조사 결과와 계획만 보고하세요."} 이번에 읽은 범위, 실제로 바뀐 셀·파일, 대기·실패와 다음 조치를 구분해 한국어로 보고하세요. 이름 변경 전후로 보고서 내용은 수정하지 마세요.`;
    return Response.json(await runAgent(uid, goal));
  }
  if (path === "automation/reports" && request.method === "GET")
    return Response.json(await reportWatchStatus(uid));
  if (path === "automation/reports/setup" && request.method === "POST")
    return Response.json(await setupReportWatch(uid, await request.json()));
  if (path === "automation/reports/run" && request.method === "POST") {
    const input = z
      .object({
        fileId: z
          .string()
          .regex(/^[\w-]+$/)
          .optional(),
        mode: z.enum(["preview", "apply"]).default("apply"),
      })
      .parse(await request.json());
    return Response.json(
      await runReportWatch(uid, false, input.mode === "preview", input.fileId),
    );
  }
  return null;
}
