// Explicit opt-in: exercises REAL Drive writes, only in a newly created synthetic folder.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { google } from "googleapis";
import ExcelJS from "exceljs";
import { fixture } from "../tests/fixtures/workspace";
import { isEmulator, userDoc } from "../src/lib/firebase";
import { googleClient } from "../src/lib/google";
import { workspace } from "../src/lib/workspace/drive";
import {
  SHEET,
  type Command,
  type DriveFile,
} from "../src/lib/workspace/schema";
import { proposeDrive, decideJob, processJob } from "../src/lib/workspace/jobs";
import { uploadWorkbook } from "../src/lib/workspace/local-files";
process.loadEnvFile(".env.local");
if (!isEmulator() || !process.argv.includes("--apply"))
  throw new Error(
    "Use --apply with local Firebase emulators to test the shared Drive.",
  );
const { uid } = JSON.parse(
  await readFile("private/agent-runtime.json", "utf8"),
);
const ws = await workspace(uid);
const events: { kind: string; jobId: string; fileId: string }[] = [];
async function execute(command: Command) {
  const job = await proposeDrive(uid, {
    requestId: randomUUID(),
    reason:
      "사용자가 요청한 실제 Drive CRUD 연결 검증: 합성 테스트 파일만 변경",
    command,
  });
  assert.equal(
    (await processJob(uid, job.id, async () => ({}))).skipped,
    true,
    "Pending work cannot execute",
  );
  await decideJob(uid, job.id, true);
  const result = await processJob(uid, job.id, async () => ({}));
  const record = (
    await userDoc(uid).collection("jobs").doc(job.id).get()
  ).data()!;
  assert.equal(result.status, "done", record.error);
  if (command.kind === "cells.update") assert.ok(record.backupPath);
  const file = result.result as DriveFile;
  events.push({ kind: command.kind, jobId: job.id, fileId: file.id });
  console.log(`PASS ${command.kind}`);
  return file;
}
let folder: DriveFile | undefined;
try {
  const root = await ws.list();
  assert.ok(root.folder.capabilities.canAddChildren);
  folder = await execute({
    kind: "folder.create",
    parentId: ws.root,
    name: `[AXPM 연결 검증 · 합성 데이터] ${new Date().toISOString()}`,
  });
  const bytes = await fixture();
  const local = await uploadWorkbook(
    uid,
    new File([new Uint8Array(bytes)], "합성 보고서.xlsx"),
  );
  let file = await execute({
    kind: "workbook.publish",
    parentId: folder.id,
    name: "합성 보고서.xlsx",
    workbookId: local.id,
    version: local.version,
  });
  const selected = {
    sheet: "보고서 ' 1회",
    mapping: [{ key: "notes", label: "논의", cell: "B11" }],
  };
  const read = await ws.read(file.id, selected);
  file = await execute({
    kind: "cells.update",
    fileId: file.id,
    version: read.version,
    ...selected,
    before: read.values,
    after: { notes: "실제 Drive API 셀 편집 검증" },
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await ws.port.download(file.id)) as never);
  assert.equal(
    workbook.getWorksheet(selected.sheet)!.getCell("C3").text,
    "합성기업",
  );
  assert.equal(
    workbook.getWorksheet(selected.sheet)!.getCell("A1").formula,
    "1+1",
  );
  assert.equal(workbook.getWorksheet("다른 시트")!.getCell("A1").text, "보존");
  file = await execute({
    kind: "file.rename",
    fileId: file.id,
    version: file.version,
    name: "합성 보고서 검증 완료.xlsx",
  });
  await execute({
    kind: "file.copy",
    fileId: file.id,
    version: file.version,
    parentId: folder.id,
    name: "합성 복사본.xlsx",
  });
  file = await execute({
    kind: "file.trash",
    fileId: file.id,
    version: file.version,
  });
  assert.equal(file.trashed, true);
  file = await execute({
    kind: "file.restore",
    fileId: file.id,
    version: file.version,
  });
  assert.equal(file.trashed, false);

  // Native Sheets fixture: create through Drive so the file stays in the shared subtree.
  const auth = await googleClient(uid, "drive");
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });
  const native = await drive.files.create({
    supportsAllDrives: true,
    fields: "id",
    requestBody: {
      name: "AXPM 합성 Sheets 검증",
      mimeType: SHEET,
      parents: [folder.id],
    },
  });
  const nativeId = native.data.id!;
  const tabs = await ws.port.sheets(nativeId);
  assert.equal(tabs.length, 1);
  const sheet = tabs[0].name;
  const range = (cell: string) => `'${sheet.replace(/'/g, "''")}'!${cell}`;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: nativeId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: range("A1"), values: [["=1+1"]] },
        { range: range("C3"), values: [["합성기업"]] },
        { range: range("B11"), values: [["기존 논의"]] },
      ],
    },
  });
  const nativeRead = await ws.read(nativeId, { ...selected, sheet });
  await execute({
    kind: "cells.update",
    fileId: nativeId,
    version: nativeRead.version,
    ...selected,
    sheet,
    before: nativeRead.values,
    after: { notes: "실제 Sheets API 셀 편집 검증" },
  });
  const preserved = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: nativeId,
    ranges: [range("A1"), range("C3")],
    valueRenderOption: "FORMULA",
  });
  assert.equal(preserved.data.valueRanges![0].values![0][0], "=1+1");
  assert.equal(preserved.data.valueRanges![1].values![0][0], "합성기업");
  console.log(
    "PASS real Drive XLSX and native Sheets CRUD, formula and other-sheet preservation, pre-write backups, approval gate",
  );
} finally {
  if (folder) {
    const current = await ws.scoped(folder.id);
    await execute({
      kind: "file.trash",
      fileId: current.id,
      version: current.version,
    });
    console.log(
      "Synthetic test folder moved to trash; original business files untouched.",
    );
  }
  await mkdir("private/validation", { recursive: true });
  await writeFile(
    "private/validation/live-drive.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        rootId: ws.root,
        folderId: folder?.id,
        events,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
