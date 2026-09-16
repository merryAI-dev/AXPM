import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { userDoc, db, storage, isEmulator } from "../src/lib/firebase";
import { fixture, fakePort } from "../tests/fixtures/workspace";
import { DriveWorkspace } from "../src/lib/workspace/drive";
import {
  proposeDrive,
  decideJob,
  processJob,
  recoverJobs,
} from "../src/lib/workspace/jobs";
import { indexStep, searchIndex } from "../src/lib/workspace/indexer";
process.loadEnvFile(".env.local");
if (!isEmulator()) throw new Error("에뮬레이터에서만 실행합니다.");
const signup = await fetch(
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `workspace-${randomUUID()}@example.com`,
      password: "synthetic-test-2026",
      returnSecureToken: true,
    }),
  },
);
assert.equal(signup.status, 200);
const account = await signup.json(),
  uid = account.localId;
async function api(path: string, body?: unknown) {
  return fetch(`http://127.0.0.1:3000/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${account.idToken}`,
      ...(body !== undefined && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
}
try {
  const bytes = await fixture(),
    form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "synthetic.xlsx"));
  const upload = await api("workbooks/upload", form);
  assert.equal(upload.status, 200);
  const { id } = await upload.json();
  const selected = {
    sheet: "보고서 ' 1회",
    mapping: [{ key: "notes", label: "논의", cell: "B11" }],
  };
  const read = await (await api("workbooks/read", { id, selected })).json();
  assert.equal(read.values.notes, "기존 논의");
  const edit = {
    id,
    ...selected,
    version: read.version,
    before: read.values,
    after: { notes: "검증용 기록" },
  };
  const saved = await api("workbooks/save", edit);
  assert.equal(saved.status, 200, await saved.text());
  const conflict = await api("workbooks/save", edit);
  assert.equal(conflict.status, 409);
  const output = await api("workbooks/download", { id });
  assert.equal(output.status, 200);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(Buffer.from(await output.arrayBuffer()) as never);
  assert.equal(
    w.getWorksheet(selected.sheet)!.getCell("B11").text,
    "검증용 기록",
  );
  assert.equal(w.getWorksheet(selected.sheet)!.getCell("C3").text, "합성기업");
  const missing = await api("workbooks/read", { id: randomUUID() });
  assert.equal(missing.status, 404);
  const disconnected = await api("drive/read", { fileId: "anything" });
  assert.equal(disconnected.status, 400);
  const unauthorized = await fetch("http://127.0.0.1:3000/api/jobs");
  assert.equal(unauthorized.status, 401);
  const f = fakePort(bytes),
    ws = new DriveWorkspace(f.port, "root");
  const request = {
    requestId: randomUUID(),
    reason: "합성 테스트",
    command: { kind: "folder.create", parentId: "root", name: "합성 폴더" },
  };
  const job = await proposeDrive(uid, request, ws);
  assert.equal((await proposeDrive(uid, request, ws)).id, job.id);
  await assert.rejects(
    proposeDrive(
      uid,
      { ...request, command: { ...request.command, name: "다른 요청" } },
      ws,
    ),
    /다른 변경/,
  );
  assert.equal(
    (await processJob(uid, job.id, async () => ({}), ws)).skipped,
    true,
  );
  assert.equal(f.state.writes, 0);
  const decisions = await Promise.allSettled([
    decideJob(uid, job.id, true),
    decideJob(uid, job.id, true),
  ]);
  assert.equal(decisions.filter((x) => x.status === "fulfilled").length, 1);
  await Promise.all([
    processJob(uid, job.id, async () => ({}), ws),
    processJob(uid, job.id, async () => ({}), ws),
  ]);
  assert.equal(f.state.writes, 1);
  const record = await userDoc(uid).collection("jobs").doc(job.id).get();
  assert.equal(record.data()!.status, "done");
  const failure = await proposeDrive(
    uid,
    { ...request, requestId: randomUUID() },
    ws,
  );
  await decideJob(uid, failure.id, true);
  const create = f.port.create;
  f.port.create = async () => {
    throw new Error("응답 유실 테스트");
  };
  const failed = await processJob(uid, failure.id, async () => ({}), ws);
  assert.equal(failed.status, "uncertain");
  assert.equal(
    (await processJob(uid, failure.id, async () => ({}), ws)).skipped,
    true,
  );
  f.port.create = create;
  await userDoc(uid)
    .collection("jobs")
    .doc("expired")
    .set({ status: "running", leaseUntil: 0 });
  await recoverJobs(uid);
  assert.equal(
    (await userDoc(uid).collection("jobs").doc("expired").get()).data()!.status,
    "uncertain",
  );
  await userDoc(uid)
    .collection("config")
    .doc("drive")
    .set({ rootId: "root", label: "테스트" });
  let scan = await indexStep(uid, true, ws);
  for (let i = 0; i < 10 && !scan.complete; i++)
    scan = await indexStep(uid, false, ws);
  assert.equal(scan.complete, true);
  assert.equal((await searchIndex(uid, "report")).files.length, 1);
  await userDoc(uid)
    .collection("config")
    .doc("drive")
    .set({ rootId: "different", label: "변경" });
  assert.equal((await searchIndex(uid, "report")).files.length, 0);
  console.log(
    "PASS: XLSX upload/read/edit/download, stale save rejection, auth enforcement, proposal idempotency, concurrent approval/execution, uncertain-write no replay, expired lease, recursive index and root isolation. Google was not connected.",
  );
} finally {
  await storage().deleteFiles({ prefix: `users/${uid}/` });
  await db().recursiveDelete(userDoc(uid));
  await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: account.idToken }),
    },
  );
}
