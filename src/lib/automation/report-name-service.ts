import { randomUUID } from "node:crypto";
import { z } from "zod";
import { userDoc, ApiError } from "../firebase";
import { workspace } from "../workspace/drive";
import { proposeDrive, decideJob, processJob } from "../workspace/jobs";
import { XLSX } from "../workspace/schema";
import { inspectMaster } from "./master-service";
import { reportCatalog } from "./report-catalog";
import { readReportSource } from "./report-source";
import { reportNamePlan } from "./report-names";
import { reportFolder } from "./report-submission";
export const renameInput = z.object({
  folderId: z
    .string()
    .regex(/^[\w-]{1,150}$/)
    .default(reportFolder),
});
export async function previewReportNames(uid: string, raw: unknown) {
  const { folderId } = renameInput.parse(raw),
    ws = await workspace(uid);
  const [files, master] = await Promise.all([
    reportCatalog(ws, folderId),
    inspectMaster(uid),
  ]);
  const started = Date.now(),
    items: ReturnType<typeof reportNamePlan>[] = [];
  for (const file of files) {
    if (Date.now() - started > 180000)
      throw new Error(
        "파일명 대조가 3분을 넘었습니다. 캠퍼스별 하위 폴더로 나누어 실행해주세요.",
      );
    try {
      items.push(
        reportNamePlan(
          await readReportSource(uid, ws, file.id),
          master.companies,
          file.mimeType === XLSX ? ".xlsx" : "",
        ),
      );
    } catch (e) {
      items.push({
        fileId: file.id,
        version: file.version,
        before: file.name,
        after: "",
        hints: { campus: "", company: [] },
        issues: [e instanceof Error ? e.message : "조회 실패"],
        ready: false,
      });
    }
  }
  const siblingNames = new Map<string, Map<string, string[]>>();
  for (const parent of new Set(files.flatMap((f) => f.parents))) {
    const names = new Map<string, string[]>();
    let pageToken = "";
    do {
      const page = await ws.list(parent, pageToken || undefined);
      for (const f of page.files)
        names.set(f.name, [...(names.get(f.name) || []), f.id]);
      pageToken = page.nextPageToken;
    } while (pageToken);
    siblingNames.set(parent, names);
  }
  for (const item of items.filter((i) => i.ready)) {
    const parent = files.find((f) => f.id === item.fileId)!.parents[0];
    const conflicting =
      (siblingNames.get(parent)?.get(item.after) || []).some(
        (id) => id !== item.fileId,
      ) ||
      items.some(
        (other) =>
          other.fileId !== item.fileId &&
          other.after === item.after &&
          files.find((f) => f.id === other.fileId)?.parents[0] === parent,
      );
    if (conflicting) {
      item.ready = false;
      item.issues.push("같은 폴더에서 통일 파일명이 중복됩니다.");
    }
  }
  const batchId = randomUUID();
  await userDoc(uid).collection("renameBatches").doc(batchId).set({
    folderId,
    items,
    status: "preview",
    createdAt: new Date().toISOString(),
  });
  return { batchId, folderId, items };
}
export async function applyReportNames(uid: string, raw: unknown) {
  const { batchId } = z.object({ batchId: z.string().uuid() }).parse(raw);
  const ref = userDoc(uid).collection("renameBatches").doc(batchId);
  const batch = await ref.firestore.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.status !== "preview")
      throw new ApiError(409, "이미 실행했거나 없는 파일명 변경 목록입니다.");
    tx.update(ref, { status: "running" });
    return data;
  });
  const results: {
    fileId: string;
    status: string;
    error?: string;
    jobId?: string;
  }[] = [];
  try {
    const ws = await workspace(uid);
    await ws.folder(batch.folderId);
    const currentIds = new Set(
      (await reportCatalog(ws, batch.folderId)).map((f) => f.id),
    );
    for (const item of batch.items.filter((i: { ready: boolean }) => i.ready)) {
      try {
        if (!currentIds.has(item.fileId))
          throw new Error("파일이 선택한 보고서 폴더 밖으로 이동했습니다.");
        const file = await ws.expect(item.fileId, item.version);
        let token = "",
          collision = false;
        do {
          const page = await ws.list(file.parents[0], token || undefined);
          collision ||= page.files.some(
            (f) => f.id !== file.id && f.name === item.after,
          );
          token = page.nextPageToken;
        } while (token);
        if (collision) throw new Error("같은 이름의 파일이 새로 생겼습니다.");
        const job = await proposeDrive(
          uid,
          {
            requestId: randomUUID(),
            reason: `보고서 본문·마스터 대조 후 파일명 통일: ${item.before} → ${item.after}`,
            command: {
              kind: "file.rename",
              fileId: item.fileId,
              version: item.version,
              name: item.after,
            },
          },
          ws,
        );
        await decideJob(uid, job.id, true);
        const outcome = await processJob(
          uid,
          job.id,
          async () => {
            throw new Error("파일명 변경은 에이전트 실행 작업이 아닙니다.");
          },
          ws,
        );
        results.push({
          fileId: item.fileId,
          status: outcome.status || "skipped",
          jobId: job.id,
        });
      } catch (e) {
        results.push({
          fileId: item.fileId,
          status: "blocked",
          error: e instanceof Error ? e.message : "변경 실패",
        });
      }
      await ref.update({ results });
    }
    const status = !results.length
      ? "no_changes"
      : results.every((r) => r.status === "done")
        ? "done"
        : "partial";
    await ref.update({ status });
    return { batchId, status, results };
  } catch (e) {
    await ref.update({
      status: "failed",
      results,
      error: e instanceof Error ? e.message : "실행 실패",
    });
    throw e;
  }
}
export async function reportNameApi(
  request: Request,
  uid: string,
  path: string,
) {
  if (path === "automation/report-names/preview" && request.method === "POST")
    return Response.json(await previewReportNames(uid, await request.json()));
  if (path === "automation/report-names/apply" && request.method === "POST")
    return Response.json(await applyReportNames(uid, await request.json()));
  return null;
}
