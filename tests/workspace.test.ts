import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { DriveWorkspace, type DrivePort } from "../src/lib/workspace/drive";
import {
  FOLDER,
  SHEET,
  XLSX,
  type DriveFile,
  type Mapping,
  addressSchema,
  commandSchema,
} from "../src/lib/workspace/schema";
import { readWorkbook, editWorkbook } from "../src/lib/workspace/workbook";
import { executeCommand } from "../src/lib/workspace/commands";
const mapping: Mapping = [
  { key: "company", label: "기업명", cell: "C3" },
  { key: "notes", label: "논의", cell: "B11" },
];
import { fixture, fakePort, file } from "./fixtures/workspace";
test("arbitrary mapped edits preserve every ZIP member except selected worksheet", async () => {
  const original = await fixture(),
    info = await readWorkbook(original, { sheet: "보고서 ' 1회", mapping });
  const after = { ...info.values, notes: "실제 메모 & <검토>\n다음 단계" };
  const out = await editWorkbook(
    original,
    "보고서 ' 1회",
    mapping,
    info.values,
    after,
  );
  const check = await readWorkbook(out, { sheet: "보고서 ' 1회", mapping });
  assert.deepEqual(check.values, after);
  const a = await JSZip.loadAsync(original),
    b = await JSZip.loadAsync(out);
  assert.deepEqual(Object.keys(a.files), Object.keys(b.files));
  const changed: string[] = [];
  for (const key of Object.keys(a.files))
    if (
      !a.files[key].dir &&
      !(await a.files[key].async("nodebuffer")).equals(
        await b.files[key].async("nodebuffer"),
      )
    )
      changed.push(key);
  assert.deepEqual(changed, ["xl/worksheets/sheet1.xml"]);
});
test("stale cells, formulas, merged child cells and out-of-range addresses are rejected", async () => {
  const b = await fixture();
  await assert.rejects(
    editWorkbook(
      b,
      "보고서 ' 1회",
      mapping,
      { company: "다름", notes: "기존 논의" },
      { company: "x", notes: "x" },
    ),
    /변경/,
  );
  await assert.rejects(
    editWorkbook(
      b,
      "보고서 ' 1회",
      [{ key: "x", label: "수식", cell: "A1" }],
      { x: "2" },
      { x: "3" },
    ),
    /수식/,
  );
  await assert.rejects(
    editWorkbook(
      b,
      "보고서 ' 1회",
      [{ key: "x", label: "병합", cell: "D3" }],
      { x: "합성기업" },
      { x: "수정" },
    ),
    /병합/,
  );
  assert.equal(addressSchema.safeParse("XFE1").success, false);
  assert.equal(addressSchema.safeParse("XFD1048576").success, true);
});
test("scope boundary follows ancestry, refuses cycles, root edits and stale versions", async () => {
  const f = fakePort(await fixture()),
    ws = new DriveWorkspace(f.port, "root");
  assert.equal((await ws.scoped("report")).id, "report");
  await assert.rejects(ws.scoped("foreign"), /밖/);
  await assert.rejects(ws.expect("root", "1"), /루트/);
  await assert.rejects(ws.expect("report", "2"), /버전/);
  f.files.set("cycle", file("cycle", FOLDER, ["cycle"]));
  await assert.rejects(ws.scoped("cycle"), /밖/);
  assert.equal(f.state.writes, 0);
});
test("XLSX write is backed up, version checked and read back", async () => {
  const f = fakePort(await fixture()),
    ws = new DriveWorkspace(f.port, "root");
  const current = await ws.read("report", { sheet: "보고서 ' 1회", mapping });
  const order: string[] = [];
  const result = await executeCommand(
    ws,
    {
      kind: "cells.update",
      fileId: "report",
      version: "1",
      sheet: "보고서 ' 1회",
      mapping,
      before: current.values,
      after: { ...current.values, notes: "검토 후 기록" },
    },
    async (b) => {
      assert.deepEqual(b, f.state.bytes);
      order.push("backup");
    },
    async () => {
      order.push("write");
    },
  );
  assert.equal(result.version, "2");
  assert.deepEqual(order, ["backup", "write"]);
  assert.equal(f.state.writes, 1);
  assert.equal(
    (await ws.read("report", { sheet: "보고서 ' 1회", mapping })).values.notes,
    "검토 후 기록",
  );
});
test("native sheets update only changed cells and refuse stale before values", async () => {
  const f = fakePort(await fixture()),
    ws = new DriveWorkspace(f.port, "root");
  const command = commandSchema.parse({
    kind: "cells.update",
    fileId: "sheet",
    version: "1",
    sheet: "원본",
    mapping,
    before: f.state.native,
    after: { ...f.state.native, notes: "변경" },
  });
  await executeCommand(
    ws,
    command,
    async () => {},
    async () => {},
  );
  assert.deepEqual(f.state.changed, ["notes"]);
  await assert.rejects(
    executeCommand(
      ws,
      command,
      async () => {},
      async () => {},
    ),
    /버전/,
  );
  assert.equal(f.state.writes, 1);
});
test("rename, copy, create, trash and restore verify metadata", async () => {
  const f = fakePort(await fixture()),
    ws = new DriveWorkspace(f.port, "root");
  const run = (c: unknown) =>
    executeCommand(
      ws,
      commandSchema.parse(c),
      async () => {},
      async () => {},
    );
  assert.equal(
    (
      await run({
        kind: "folder.create",
        parentId: "root",
        name: "테스트 폴더",
      })
    ).name,
    "테스트 폴더",
  );
  assert.equal(
    (
      await run({
        kind: "file.copy",
        fileId: "report",
        version: "1",
        parentId: "root",
        name: "사본",
      })
    ).name,
    "사본",
  );
  assert.equal(
    (
      await run({
        kind: "file.rename",
        fileId: "report",
        version: "1",
        name: "수정 이름",
      })
    ).version,
    "2",
  );
  assert.equal(
    (await run({ kind: "file.trash", fileId: "report", version: "2" })).trashed,
    true,
  );
  assert.equal(
    (await run({ kind: "file.restore", fileId: "report", version: "3" }))
      .trashed,
    false,
  );
});

test("archives without directory entries keep exactly the original member set", async () => {
  const zip = await JSZip.loadAsync(await fixture());
  for (const name of Object.keys(zip.files))
    if (zip.files[name].dir) delete zip.files[name];
  const original = await zip.generateAsync({ type: "nodebuffer" });
  const selected = { sheet: "보고서 ' 1회", mapping };
  const read = await readWorkbook(original, selected);
  const output = await editWorkbook(
    original,
    selected.sheet,
    mapping,
    read.values,
    { ...read.values, notes: "변경" },
  );
  assert.deepEqual(
    Object.keys((await JSZip.loadAsync(output)).files).sort(),
    Object.keys(zip.files).sort(),
  );
});

test("changing Drive revisions retry only reads and stop after a bounded number of attempts", async () => {
  const f = fakePort(await fixture()),
    ws = new DriveWorkspace(f.port, "root");
  const original = f.port.download;
  let reads = 0;
  f.port.download = async (id) => {
    reads++;
    if (reads === 1) f.files.get("report")!.version = "2";
    return original(id);
  };
  assert.equal(
    (await ws.read("report", { sheet: "보고서 ' 1회", mapping })).version,
    "2",
  );
  assert.equal(reads, 2);
  assert.equal(f.state.writes, 0);
  reads = 0;
  f.port.download = async (id) => {
    reads++;
    f.files.get("report")!.version = String(reads + 2);
    return original(id);
  };
  await assert.rejects(ws.read("report"), /읽는 동안/);
  assert.equal(reads, 3);
  assert.equal(f.state.writes, 0);
});
