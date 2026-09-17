import { serviceAccountMode } from "../google-service-account";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { userDoc, storage } from "../firebase";
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
import { driveHistory, indexStep, indexStatus, searchIndex } from "./indexer";
import { runAgent } from "../agent";
const json = NextResponse.json;
export async function workspaceApi(
  request: NextRequest,
  uid: string,
  path: string,
): Promise<Response | null> {
  if (!/^(drive|jobs)(\/|$)/.test(path)) return null;
  const base = userDoc(uid),
    get = request.method === "GET";
  if (path === "drive/status" && get) {
    const config = await driveConfig(uid);
    let connected = false;
    let connectionError = "";
    if (serviceAccountMode() && config) {
      try {
        await (await workspace(uid)).folder(config.rootId);
        connected = true;
      } catch (e) {
        connected = false;
        connectionError = e instanceof Error ? e.message : "접근 확인 실패";
      }
    }
    return json({
      config,
      connected,
      connectionError,
      connectionMode: "service-account",
      index: await indexStatus(uid),
    });
  }
  if (path === "drive/config" && !get) {
    const config = driveConfigSchema.parse(await request.json());
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
  if (path === "drive/download" && !get) {
    const { fileId } = z
      .object({ fileId: idSchema })
      .parse(await request.json());
    const ws = await workspace(uid),
      file = await ws.scoped(fileId);
    if (
      file.mimeType !==
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
      throw new Error("원본 XLSX 파일만 다운로드할 수 있습니다.");
    const buffer = await ws.port.download(fileId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": 'attachment; filename="report.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  }
  if (path === "drive/read" && !get) {
    const p = z
      .object({
        fileId: idSchema,
        selected: editSchema.optional(),
        preview: z.boolean().default(false),
      })
      .parse(await request.json());
    return json(
      await (await workspace(uid)).read(p.fileId, p.selected, p.preview),
    );
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
  if (path === "drive/history" && get) return json(await driveHistory(uid));
  if (path === "drive/search" && get)
    return json(
      await searchIndex(
        uid,
        (request.nextUrl.searchParams.get("q") || "").slice(0, 200),
        request.nextUrl.searchParams.get("cursor") || undefined,
      ),
    );
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
