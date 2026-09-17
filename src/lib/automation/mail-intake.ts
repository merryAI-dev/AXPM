import { google, type gmail_v1 } from "googleapis";
import { z } from "zod";
import {
  beginGoogleUserOAuth,
  disconnectGoogleUser,
  googleUserClient,
} from "../google-user-oauth";
import { ApiError, userDoc } from "../firebase";
import { productConfig } from "../product-config";
import { workspace, type DriveWorkspace } from "../workspace/drive";
import { FOLDER, XLSX } from "../workspace/schema";
import { digest } from "./blueprint";
import { inspectMaster } from "./master-service";
import { reportNamePlan } from "./report-names";
import { readReportSource } from "./report-source";

const INTAKE_FOLDER = "[AXPM] 메일 첨부 수집함";
const MAX_ATTACHMENT_BYTES = 10_000_000;
const supported = /\.(xlsx|pdf|docx|hwp|hwpx)$/i;

export function safeAttachmentName(value: string) {
  const name = value
    .normalize("NFC")
    .replace(/[\x00-\x1f/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (name || "attachment").slice(0, 220);
}

function headers(message: gmail_v1.Schema$Message) {
  return Object.fromEntries(
    (message.payload?.headers || []).map((entry) => [
      String(entry.name || "").toLowerCase(),
      String(entry.value || ""),
    ]),
  );
}

function attachmentParts(part?: gmail_v1.Schema$MessagePart) {
  const found: gmail_v1.Schema$MessagePart[] = [];
  if (!part) return found;
  if (part.filename && (part.body?.attachmentId || part.body?.data))
    found.push(part);
  for (const child of part.parts || []) found.push(...attachmentParts(child));
  return found;
}

async function gmailClient(uid: string) {
  const config = productConfig();
  const { auth, email } = await googleUserClient(uid);
  return {
    inbox: email,
    query: config.gmailQuery,
    api: google.gmail({ version: "v1", auth, timeout: 30000 }),
  };
}

async function ensureIntakeFolder(uid: string, ws: DriveWorkspace) {
  const ref = userDoc(uid).collection("config").doc("mailIntake");
  const configured = (await ref.get()).data()?.folderId;
  if (configured) {
    try {
      const folder = await ws.folder(String(configured));
      return folder;
    } catch {
    }
  }
  let token = "";
  do {
    const page = await ws.port.list(ws.root, token);
    const existing = page.files.find(
      (file) => file.mimeType === FOLDER && file.name === INTAKE_FOLDER,
    );
    if (existing) {
      await ref.set({ folderId: existing.id, updatedAt: new Date().toISOString() });
      return existing;
    }
    token = page.nextPageToken;
  } while (token);
  const created = await ws.port.create(ws.root, INTAKE_FOLDER);
  await ws.scoped(created.id);
  await ref.set({ folderId: created.id, updatedAt: new Date().toISOString() });
  return created;
}

async function hasSiblingName(
  ws: DriveWorkspace,
  folderId: string,
  fileId: string,
  name: string,
) {
  let token = "";
  do {
    const page = await ws.port.list(folderId, token);
    if (page.files.some((file) => file.id !== fileId && file.name === name))
      return true;
    token = page.nextPageToken;
  } while (token);
  return false;
}

async function attachmentBytes(
  api: gmail_v1.Gmail,
  inbox: string,
  messageId: string,
  part: gmail_v1.Schema$MessagePart,
) {
  let data = part.body?.data || "";
  if (!data && part.body?.attachmentId) {
    const response = await api.users.messages.attachments.get({
      userId: inbox,
      messageId,
      id: part.body.attachmentId,
    });
    data = response.data.data || "";
  }
  const bytes = Buffer.from(data, "base64url");
  if (!bytes.length) throw new Error("첨부 파일 내용이 비어 있습니다.");
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    throw new Error("10MB를 넘는 첨부 파일은 자동 수집하지 않습니다.");
  return bytes;
}

export async function syncMailAttachments(uid: string, scheduled = false) {
  const startedAt = new Date().toISOString();
  const { inbox, query, api } = await gmailClient(uid);
  const ws = await workspace(uid);
  const folder = await ensureIntakeFolder(uid, ws);
  const listed = await api.users.messages.list({
    userId: inbox,
    q: query,
    maxResults: 25,
  });
  let collected = 0,
    normalized = 0,
    review = 0,
    skipped = 0;
  const errors: string[] = [];
  let companies: Awaited<ReturnType<typeof inspectMaster>>["companies"] | null = null;

  for (const item of listed.data.messages || []) {
    if (!item.id) continue;
    const message = (
      await api.users.messages.get({
        userId: inbox,
        id: item.id,
        format: "full",
      })
    ).data;
    const metadata = headers(message);
    for (const [index, part] of attachmentParts(message.payload).entries()) {
      const originalName = safeAttachmentName(part.filename || "attachment");
      if (!supported.test(originalName)) {
        skipped++;
        continue;
      }
      const recordId = digest({
        inbox,
        messageId: item.id,
        attachment: part.body?.attachmentId || part.partId || index,
      });
      const ref = userDoc(uid).collection("mailAttachments").doc(recordId);
      const previous = await ref.get();
      if (previous.exists && previous.data()?.status !== "failed") {
        skipped++;
        continue;
      }
      await ref.set({
        id: recordId,
        messageId: item.id,
        originalName,
        sender: metadata.from || "",
        subject: metadata.subject || "(제목 없음)",
        receivedAt: message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : "",
        status: "processing",
        scheduled,
        createdAt: previous.data()?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      try {
        const bytes = await attachmentBytes(api, inbox, item.id, part);
        let file = await ws.port.create(
          folder.id,
          originalName,
          bytes,
          part.mimeType || "application/octet-stream",
        );
        await ws.scoped(file.id);
        let status = "collected";
        let issues: string[] = [];
        if (file.mimeType === XLSX || /\.xlsx$/i.test(file.name)) {
          companies ||= (await inspectMaster(uid, undefined, false)).companies;
          const plan = reportNamePlan(
            await readReportSource(uid, ws, file.id),
            companies,
            ".xlsx",
          );
          issues = plan.issues;
          if (
            plan.ready &&
            (await hasSiblingName(ws, folder.id, file.id, plan.after))
          ) {
            status = "review";
            issues = [...issues, "같은 표준 파일명의 파일이 이미 있습니다."];
            review++;
          } else if (plan.ready) {
            file = await ws.port.update(file.id, { name: plan.after });
            await ws.scoped(file.id);
            status = "normalized";
            normalized++;
          } else {
            status = plan.after === file.name && !issues.length ? "normalized" : "review";
            status === "normalized" ? normalized++ : review++;
          }
        } else {
          status = "review";
          issues = ["본문 기준 파일명 자동 통일은 XLSX 보고서만 지원합니다."];
          review++;
        }
        collected++;
        await ref.update({
          status,
          issues,
          storedName: file.name,
          driveFileId: file.id,
          driveUrl: file.webViewLink || "",
          mimeType: file.mimeType,
          size: bytes.length,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "첨부 수집 실패";
        errors.push(`${originalName}: ${message}`);
        await ref.update({ status: "failed", error: message, updatedAt: new Date().toISOString() });
      }
    }
  }
  const result = {
    inbox,
    query,
    folderId: folder.id,
    scannedMessages: listed.data.messages?.length || 0,
    collected,
    normalized,
    review,
    skipped,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  await Promise.all([
    userDoc(uid).collection("config").doc("mailIntake").set(
      { folderId: folder.id, lastSync: result },
      { merge: true },
    ),
    userDoc(uid).collection("automationActivity").add({
      type: "mail-intake",
      status: errors.length ? "attention" : "done",
      source: "mail-intake",
      title: `메일 첨부 ${collected}건 수집`,
      result,
      createdAt: result.finishedAt,
    }),
  ]);
  return result;
}

export async function mailIntakeStatus(uid: string, search = "") {
  const config = productConfig();
  let connected = false;
  let connectionError = "";
  try {
      const { inbox, api } = await gmailClient(uid);
      await api.users.getProfile({ userId: inbox });
      connected = true;
  } catch (error) {
      connectionError =
        error instanceof Error ? error.message : "Gmail 연결을 확인하지 못했습니다.";
  }
  const [settings, recent] = await Promise.all([
    userDoc(uid).collection("config").doc("mailIntake").get(),
    userDoc(uid)
      .collection("mailAttachments")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get(),
  ]);
  return {
    configured: !!process.env.GOOGLE_OAUTH_CLIENT_ID,
    connected,
    connectionError,
    inbox: connected ? (await googleUserClient(uid)).email : "",
    query: config.gmailQuery,
    folderId: settings.data()?.folderId || "",
    lastSync: settings.data()?.lastSync || null,
    items: recent.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => {
        const needle = search.trim().normalize("NFC").toLowerCase();
        if (!needle) return true;
        const data = item as Record<string, unknown>;
        return [data.subject, data.sender, data.originalName, data.storedName]
          .join(" ")
          .normalize("NFC")
          .toLowerCase()
          .includes(needle);
      }),
  };
}

export async function mailIntakeApi(request: Request, uid: string, path: string) {
  if (path === "mail/oauth/start" && request.method === "POST")
    return Response.json(await beginGoogleUserOAuth(uid));
  if (path === "mail/oauth/disconnect" && request.method === "POST")
    return Response.json(await disconnectGoogleUser(uid));
  if (path === "mail/intake" && request.method === "GET")
    return Response.json(
      await mailIntakeStatus(
        uid,
        new URL(request.url).searchParams.get("q")?.slice(0, 200) || "",
      ),
    );
  if (path === "mail/sync" && request.method === "POST")
    return Response.json(await syncMailAttachments(uid));
  if (path === "mail/download" && request.method === "POST") {
    const { id } = z.object({ id: z.string().length(64) }).parse(await request.json());
    const record = (
      await userDoc(uid).collection("mailAttachments").doc(id).get()
    ).data();
    if (!record?.driveFileId) throw new ApiError(404, "수집된 파일을 찾지 못했습니다.");
    const ws = await workspace(uid);
    const file = await ws.scoped(String(record.driveFileId));
    const bytes = await ws.port.download(file.id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      },
    });
  }
  return null;
}
