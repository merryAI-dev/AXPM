import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userDoc, storage } from "../firebase";
import { SCOPES } from "../google";
import { driveConfig, workspace } from "./drive";
import { driveConfigSchema, editSchema, idSchema, jobInput } from "./schema";
import {
  decideJob,
  listJobs,
  processJob,
  proposeDrive,
  enqueueAgent,
  recoverJobs,
} from "./jobs";
import { indexStep, indexStatus, searchIndex } from "./indexer";
import {
  listWorkbooks,
  uploadWorkbook,
  readLocal,
  saveLocal,
  localWorkbook,
} from "./local-files";
import { runAgent } from "../agent";
const json = NextResponse.json;
export async function workspaceApi(
  request: NextRequest,
  uid: string,
  path: string,
): Promise<Response | null> {
  if (!/^(drive|workbooks|jobs)(\/|$)/.test(path)) return null;
  const base = userDoc(uid),
    get = request.method === "GET";
  if (path === "drive/status" && get) {
    const token = (await base.collection("private").doc("google").get()).data();
    return json({
      config: await driveConfig(uid),
      connected: SCOPES.drive.every((s) => token?.scopes?.includes(s)),
      index: await indexStatus(uid),
    });
  }
  if (path === "drive/config" && !get) {
    const config = driveConfigSchema.parse(await request.json());
    // Saving configuration is possible before consent; this does not claim access was verified.
    await base.collection("config").doc("drive").set(config);
    return json({ saved: true, accessVerified: false });
  }
  if (path === "drive/list" && get) {
    const parent = request.nextUrl.searchParams.get("parent") || undefined;
    return json(
      await (
        await workspace(uid)
      ).list(
        parent,
        request.nextUrl.searchParams.get("pageToken") || undefined,
        request.nextUrl.searchParams.get("trashed") === "true",
      ),
    );
  }
  if (path === "drive/read" && !get) {
    const p = z
      .object({ fileId: idSchema, selected: editSchema.optional() })
      .parse(await request.json());
    return json(await (await workspace(uid)).read(p.fileId, p.selected));
  }
  if (path === "drive/profile" && !get) {
    const p = z
      .object({ fileId: idSchema, ...editSchema.shape })
      .parse(await request.json());
    await (await workspace(uid)).read(p.fileId, p);
    await base
      .collection("driveProfiles")
      .doc(p.fileId)
      .set({ sheet: p.sheet, mapping: p.mapping });
    return json({ saved: true });
  }
  if (path === "drive/profile" && get) {
    const id = idSchema.parse(request.nextUrl.searchParams.get("id"));
    await (await workspace(uid)).scoped(id);
    return json(
      (await base.collection("driveProfiles").doc(id).get()).data() || null,
    );
  }
  if (path === "drive/propose" && !get)
    return json(await proposeDrive(uid, jobInput.parse(await request.json())));
  if (path === "drive/index" && !get) {
    const p = z
      .object({ restart: z.boolean().default(false) })
      .parse(await request.json());
    return json(await indexStep(uid, p.restart));
  }
  if (path === "drive/search" && get)
    return json(
      await searchIndex(
        uid,
        (request.nextUrl.searchParams.get("q") || "").slice(0, 200),
        request.nextUrl.searchParams.get("cursor") || undefined,
      ),
    );
  if (path === "workbooks" && get) return json(await listWorkbooks(uid));
  if (path === "workbooks/upload" && !get) {
    if (Number(request.headers.get("content-length") || 0) > 11000000)
      throw new Error("파일은 10MB 이하로 선택해주세요.");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new Error("파일을 선택해주세요.");
    return json(await uploadWorkbook(uid, file));
  }
  if (path === "workbooks/read" && !get) {
    const p = z
      .object({ id: z.string().uuid(), selected: editSchema.optional() })
      .parse(await request.json());
    return json(await readLocal(uid, p.id, p.selected));
  }
  if (path === "workbooks/save" && !get) {
    const raw = await request.json(),
      id = z.string().uuid().parse(raw.id);
    return json(await saveLocal(uid, id, raw));
  }
  if (path === "workbooks/download" && !get) {
    const { id } = z
      .object({ id: z.string().uuid() })
      .parse(await request.json());
    const { buffer } = await localWorkbook(uid, id);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="report.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  }
  if (path === "jobs" && get) {
    await recoverJobs(uid);
    return json(await listJobs(uid));
  }
  if (path === "jobs/agent" && !get) {
    const { goal } = z.object({ goal: z.string() }).parse(await request.json());
    return json(await enqueueAgent(uid, goal));
  }
  if (path === "jobs/decide" && !get) {
    const p = z
      .object({ id: idSchema, approve: z.boolean() })
      .parse(await request.json());
    return json(await decideJob(uid, p.id, p.approve));
  }
  if (path === "jobs/process" && !get) {
    const p = z.object({ id: idSchema }).parse(await request.json());
    return json(await processJob(uid, p.id, runAgent));
  }
  if (path === "jobs/events" && get) {
    const id = idSchema.parse(request.nextUrl.searchParams.get("id"));
    return json(
      (
        await base
          .collection("jobs")
          .doc(id)
          .collection("events")
          .orderBy("at")
          .limit(100)
          .get()
      ).docs.map((d) => d.data()),
    );
  }
  if (path === "jobs/backup" && !get) {
    const { id } = z.object({ id: idSchema }).parse(await request.json());
    const job = (await base.collection("jobs").doc(id).get()).data();
    if (!job?.backupPath) throw new Error("이 작업에는 백업 파일이 없습니다.");
    const [buffer] = await storage().file(job.backupPath).download();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": job.backupMime,
        "Content-Disposition": `attachment; filename="backup.${job.backupMime.includes("json") ? "json" : "xlsx"}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return null;
}
