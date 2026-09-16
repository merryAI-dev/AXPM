import { google } from "googleapis";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { userDoc } from "./firebase";
import type { Input } from "./importer";
export const SCOPES: Record<string, string[]> = {
  sheets: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  calendar: ["https://www.googleapis.com/auth/calendar.events"],
};
function key() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY || ""))
    throw new Error("TOKEN_ENCRYPTION_KEY 설정이 필요합니다.");
  return Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex");
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((x) => x.toString("base64"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((x) => Buffer.from(x, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(data), cipher.final()]).toString(),
  );
}
export function oauthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    throw new Error("Google OAuth 클라이언트 설정이 필요합니다.");
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_ORIGIN}/api/google/callback`,
  );
}
export async function googleClient(
  uid: string,
  capability: keyof typeof SCOPES,
) {
  const doc = await userDoc(uid).collection("private").doc("google").get();
  if (!doc.exists) throw new Error("먼저 Google 연결에 동의해주세요.");
  const data = doc.data()!;
  if (!SCOPES[capability].every((s) => (data.scopes as string[]).includes(s)))
    throw new Error(`${capability} 권한 동의가 필요합니다.`);
  const client = oauthClient();
  client.setCredentials(decrypt(data.tokens));
  return client;
}
export async function gmailSearch(
  uid: string,
  approvedQuery: string,
  companyEmail?: string,
) {
  if (!approvedQuery.trim())
    throw new Error("설정에서 업무 메일 검색 범위를 먼저 지정해주세요.");
  const gmail = google.gmail({
    version: "v1",
    auth: await googleClient(uid, "gmail"),
  });
  const query = companyEmail
    ? `(${approvedQuery}) (from:${companyEmail} OR to:${companyEmail})`
    : approvedQuery;
  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 10,
  });
  return Promise.all(
    (list.data.messages || []).map(async (item) => {
      const { data } = await gmail.users.messages.get({
        userId: "me",
        id: item.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      return {
        id: `gmail:${data.id}`,
        subject:
          data.payload?.headers?.find(
            (x) => x.name?.toLowerCase() === "subject",
          )?.value || "",
        from:
          data.payload?.headers?.find((x) => x.name?.toLowerCase() === "from")
            ?.value || "",
        snippet: data.snippet || "",
        threadId: data.threadId,
      };
    }),
  );
}
export async function calendarList(uid: string, start: string, end: string) {
  const api = google.calendar({
    version: "v3",
    auth: await googleClient(uid, "calendar"),
  });
  const { data } = await api.events.list({
    calendarId: "primary",
    timeMin: start,
    timeMax: end,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });
  return (data.items || []).map((x) => ({
    id: `calendar:${x.id}`,
    title: x.summary,
    start: x.start,
    end: x.end,
    status: x.status,
  }));
}
export async function sendMail(
  uid: string,
  to: string,
  subject: string,
  body: string,
  id: string,
) {
  if (
    /[\r\n]/.test(to + subject) ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)
  )
    throw new Error("메일 주소 또는 제목이 유효하지 않습니다.");
  const gmail = google.gmail({
    version: "v1",
    auth: await googleClient(uid, "gmail"),
  });
  const raw = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `Message-ID: <${id}@axpm.local>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64"),
  ].join("\r\n");
  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(raw).toString("base64url") },
  });
  return result.data.id!;
}
export async function createCalendarEvent(
  uid: string,
  title: string,
  body: string,
  start: string,
  end: string,
  to: string,
  id: string,
) {
  const events = await calendarList(uid, start, end);
  if (events.some((x) => x.status !== "cancelled"))
    throw new Error(
      "연결한 캘린더에 겹치는 일정이 있습니다. 시간대를 다시 확인해주세요.",
    );
  const api = google.calendar({
    version: "v3",
    auth: await googleClient(uid, "calendar"),
  });
  const { data } = await api.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    requestBody: {
      id: id.replace(/-/g, ""),
      summary: title,
      description: body,
      start: { dateTime: start, timeZone: "Asia/Seoul" },
      end: { dateTime: end, timeZone: "Asia/Seoul" },
      attendees: [{ email: to }],
    },
  });
  return data.id!;
}
export function spreadsheetId(value: string) {
  const id = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || value;
  if (!/^[a-zA-Z0-9_-]{15,150}$/.test(id))
    throw new Error("Google 스프레드시트 URL 또는 ID를 확인해주세요.");
  return id;
}
export async function readSheetAsWorkbook(
  uid: string,
  role: Input["role"],
  value: string,
): Promise<Input> {
  const api = google.sheets({
    version: "v4",
    auth: await googleClient(uid, "sheets"),
  });
  const id = spreadsheetId(value);
  const { data: meta } = await api.spreadsheets.get({
    spreadsheetId: id,
    fields: "properties(title),sheets(properties)",
  });
  const selected = (meta.sheets || []).filter((x) =>
    role === "mentor"
      ? x.properties?.title?.includes("전체 사업관리현황")
      : role === "internal"
        ? x.properties?.title === "기술협상"
        : true,
  );
  if (!selected.length)
    throw new Error(`${role}: 읽을 시트를 찾지 못했습니다.`);
  const { data } = await api.spreadsheets.get({
    spreadsheetId: id,
    ranges: selected.map(
      (x) => `'${x.properties!.title!.replace(/'/g, "''")}'!A1:AR2000`,
    ),
    includeGridData: true,
    fields:
      "sheets(properties,merges,data(startRow,startColumn,rowData(values(effectiveValue,effectiveFormat(numberFormat,textFormat/strikethrough)))))",
  });
  const w = new ExcelJS.Workbook();
  for (const s of data.sheets || []) {
    const ws = w.addWorksheet(s.properties!.title!);
    for (const grid of s.data || [])
      (grid.rowData || []).forEach((row, ri) =>
        (row.values || []).forEach((cell, ci) => {
          const dest = ws.getCell(
            (grid.startRow || 0) + ri + 1,
            (grid.startColumn || 0) + ci + 1,
          );
          const v = cell.effectiveValue;
          if (v?.boolValue != null) dest.value = v.boolValue;
          else if (v?.numberValue != null)
            dest.value = /DATE/.test(
              cell.effectiveFormat?.numberFormat?.type || "",
            )
              ? new Date(Math.round((v.numberValue - 25569) * 86400000))
              : v.numberValue;
          else if (v?.stringValue != null) dest.value = v.stringValue;
          if (cell.effectiveFormat?.textFormat?.strikethrough)
            dest.font = { strike: true };
        }),
      );
    for (const m of s.merges || [])
      if ((m.endRowIndex || 0) <= 2000 && (m.endColumnIndex || 0) <= 44)
        ws.mergeCells(
          (m.startRowIndex || 0) + 1,
          (m.startColumnIndex || 0) + 1,
          m.endRowIndex!,
          m.endColumnIndex!,
        );
  }
  return {
    role,
    name: meta.properties?.title || role,
    buffer: Buffer.from(await w.xlsx.writeBuffer()),
  };
}
