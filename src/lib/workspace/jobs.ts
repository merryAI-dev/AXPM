import { localWorkbook } from "./local-files";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { userDoc, storage, ApiError } from "../firebase";
import { workspace, driveConfig, type DriveWorkspace } from "./drive";
import { executeCommand, validateCommand } from "./commands";
import { jobInput, commandSchema, type Command } from "./schema";
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const now = () => new Date().toISOString();
const jobs = (uid: string) => userDoc(uid).collection("jobs");
export async function listJobs(uid: string) {
  return (
    await jobs(uid).orderBy("createdAt", "desc").limit(50).get()
  ).docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function proposeDrive(
  uid: string,
  raw: unknown,
  adapter?: DriveWorkspace,
) {
  const p = jobInput.parse(raw);
  if (Buffer.byteLength(JSON.stringify(p)) > 400000)
    throw new Error("변경 내용은 400KB 이하여야 합니다.");
  const ws = adapter || (await workspace(uid));
  const preview = await validateCommand(ws, p.command);
  if (p.command.kind === "workbook.publish") {
    const source = await localWorkbook(uid, p.command.workbookId);
    if (source.file.version !== p.command.version)
      throw new ApiError(409, "게시할 엑셀이 변경되었습니다.");
  }
  const id = createHash("sha256").update(p.requestId).digest("hex");
  const ref = jobs(uid).doc(id);
  await ref.firestore.runTransaction(async (tx) => {
    const previous = await tx.get(ref);
    if (previous.exists) {
      if (stable(previous.data()!.command) !== stable(p.command))
        throw new ApiError(
          409,
          "같은 요청 ID에 다른 변경을 사용할 수 없습니다.",
        );
      return;
    }
    tx.create(ref, {
      id,
      kind: "drive.command",
      command: p.command,
      reason: p.reason,
      target: preview.target,
      rootId: ws.root,
      status: "pending",
      createdAt: now(),
      attempts: 0,
    });
    tx.create(ref.collection("events").doc(), { type: "proposed", at: now() });
  });
  return { id, status: (await ref.get()).data()!.status };
}
export async function decideJob(uid: string, id: string, approve: boolean) {
  const ref = jobs(uid).doc(
    z
      .string()
      .regex(/^[\w-]{1,128}$/)
      .parse(id),
  );
  return ref.firestore.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d) throw new ApiError(404, "작업을 찾을 수 없습니다.");
    if (d.status !== "pending")
      throw new ApiError(409, "이미 결정된 작업입니다.");
    const status = approve ? "queued" : "rejected";
    tx.update(ref, { status, decidedAt: now() });
    tx.create(ref.collection("events").doc(), { type: status, at: now() });
    return { id, status };
  });
}
export async function enqueueAgent(uid: string, goal: string) {
  z.string().min(1).max(18000).parse(goal);
  if (!process.env.ANTHROPIC_API_KEY || !process.env.AGENT_MODEL)
    throw new Error("에이전트 모델과 API 키를 먼저 설정해주세요.");
  const ref = jobs(uid).doc();
  await ref.set({
    id: ref.id,
    kind: "agent.run",
    goal,
    status: "queued",
    attempts: 0,
    createdAt: now(),
  });
  return { id: ref.id, status: "queued" };
}
export async function processJob(
  uid: string,
  id: string,
  agent: (uid: string, goal: string) => Promise<unknown>,
  adapter?: DriveWorkspace,
) {
  z.string()
    .regex(/^[\w-]{1,128}$/)
    .parse(id);
  const ref = jobs(uid).doc(id),
    lock = userDoc(uid).collection("private").doc("workspace-worker");
  const claim = randomUUID();
  const job = await ref.firestore.runTransaction(async (tx) => {
    const [s, l] = await Promise.all([tx.get(ref), tx.get(lock)]);
    const d = s.data();
    if (!d) throw new ApiError(404, "작업을 찾을 수 없습니다.");
    if (d.status !== "queued") return null;
    if ((l.data()?.until || 0) > Date.now())
      throw new ApiError(409, "다른 작업을 처리 중입니다.");
    tx.set(lock, { claim, until: Date.now() + 15 * 60000 });
    tx.update(ref, {
      status: "running",
      claim,
      startedAt: now(),
      leaseUntil: Date.now() + 15 * 60000,
      attempts: d.attempts + 1,
    });
    tx.create(ref.collection("events").doc(), {
      type: "started",
      at: now(),
      claim,
    });
    return d;
  });
  if (!job) return { id, skipped: true };
  let writeStarted = false;
  try {
    let result: unknown;
    if (job.kind === "agent.run") result = await agent(uid, job.goal);
    else {
      const ws = adapter || (await workspace(uid));
      if (ws.root !== job.rootId)
        throw new Error("관리 폴더가 변경되었습니다. 새로 제안해주세요.");
      result = await executeCommand(
        ws,
        commandSchema.parse(job.command),
        async (bytes, mime) => {
          const objectPath = `users/${uid}/backups/${id}.${mime.includes("json") ? "json" : "xlsx"}`;
          await storage()
            .file(objectPath)
            .save(bytes, { resumable: false, metadata: { contentType: mime } });
          await ref.update({ backupPath: objectPath, backupMime: mime });
        },
        async () => {
          // Durable marker comes before sending the write. A crash afterward is uncertain.
          await ref.update({ writeStartedAt: now() });
          writeStarted = true;
        },
        async () => {
          const c = commandSchema.parse(job.command);
          if (c.kind !== "workbook.publish")
            throw new Error("게시 작업이 아닙니다.");
          const source = await localWorkbook(uid, c.workbookId);
          if (source.file.version !== c.version)
            throw new ApiError(409, "게시할 엑셀이 변경되었습니다.");
          return source.buffer;
        },
      );
    }
    await ref.update({
      status: "done",
      result: JSON.parse(JSON.stringify(result)),
      finishedAt: now(),
    });
    await ref.collection("events").add({ type: "verified", at: now() });
    return { id, status: "done", result };
  } catch (e) {
    const status =
      writeStarted || job.kind === "agent.run" ? "uncertain" : "failed";
    await ref.update({
      status,
      error: e instanceof Error ? e.message.slice(0, 500) : "작업 실패",
      finishedAt: now(),
    });
    await ref.collection("events").add({ type: status, at: now() });
    return { id, status };
  } finally {
    await ref.firestore.runTransaction(async (tx) => {
      if ((await tx.get(lock)).data()?.claim === claim) tx.delete(lock);
    });
  }
}
export async function recoverJobs(uid: string) {
  // Expired write/agent leases are never automatically replayed.
  const running = await jobs(uid)
    .where("status", "==", "running")
    .limit(100)
    .get();
  for (const item of running.docs)
    await item.ref.firestore.runTransaction(async (tx) => {
      const d = (await tx.get(item.ref)).data()!;
      if (d.status === "running" && d.leaseUntil < Date.now())
        tx.update(item.ref, {
          status: "uncertain",
          error:
            "실행 확인 시간이 지났습니다. 원본과 실행 이력을 확인해주세요.",
          finishedAt: now(),
        });
    });
}
export async function drainJobs(
  uid: string,
  agent: (uid: string, goal: string) => Promise<unknown>,
) {
  await recoverJobs(uid);
  const queued = await jobs(uid).where("status", "==", "queued").limit(1).get();
  return queued.empty
    ? { idle: true }
    : processJob(uid, queued.docs[0].id, agent);
}
