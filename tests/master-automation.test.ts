import test from "node:test";
import assert from "node:assert/strict";
import {
  masterEventSchema,
  masterOverview,
  planMaster,
  planMasterReversal,
  type MasterGrid,
  type MasterEvent,
} from "../src/lib/automation/master";
function fixture(): MasterGrid {
  const rows: MasterGrid["rows"] = Array.from({ length: 6 }, () =>
    Array.from({ length: 28 }, () => ({ value: null })),
  );
  const headers = [
    "No.",
    "기업구분",
    "회사명",
    "대표자",
    "연락처",
    "이메일",
    "소속",
    "담당멘토",
    "",
    "",
    "",
    "",
    "",
    "총 진행 멘토링회차",
    "1회차",
    "보고서작성",
    "1회차 진행 후 특이사항",
    "2회차",
    "보고서작성",
    "2회차 진행 후 특이사항",
    "3회차",
    "보고서작성",
    "3회차 진행 후 특이사항",
    "4회차",
    "보고서작성",
    "4회차 진행 후 특이사항",
    "전문특화멘토링 완료여부",
    "보고서작성",
  ];
  rows[4] = headers.map((value) => ({ value }));
  rows[5][2] = { value: "합성기업" };
  rows[5][6] = { value: "남부캠퍼스" };
  rows[5][7] = { value: "합성멘토" };
  rows[5][13] = { value: 0, formula: "=O6+R6+U6+X6" };
  for (const c of [14, 17, 20, 23, 26])
    rows[5][c] = { value: false, checkbox: true };
  for (const c of [15, 18, 21, 24, 27])
    rows[5][c].numberFormat = { type: "DATE", pattern: "m/d" };
  return { rows, version: "v1" };
}
const event: MasterEvent = {
  eventId: "synthetic-1",
  company: "합성기업",
  campus: "남부",
  mentor: "합성멘토",
  kind: "전담",
  round: 2,
  completedOn: "2026-09-16",
  evidence: "합성 테스트 완료 확인 메모",
};
test("master maps each round to typed completion, date and note without touching N formula", () => {
  for (const [round, cells] of [
    [1, ["O6", "P6", "Q6"]],
    [2, ["R6", "S6", "T6"]],
    [3, ["U6", "V6", "W6"]],
    [4, ["X6", "Y6", "Z6"]],
  ] as const) {
    const grid = fixture(),
      before = structuredClone(grid);
    const p = planMaster(grid, {
      ...event,
      round,
      reportWrittenOn: "2026-09-16",
      notes: '=IMPORTXML("https://example.com")',
    });
    assert.deepEqual(
      p.changes.map((c) => c.cell),
      cells,
    );
    assert.equal(p.changes[0].after, true);
    assert.equal(typeof p.changes[1].after, "number");
    assert.deepEqual(grid, before);
  }
});
test("completion date alone never fills report-written date", () => {
  assert.deepEqual(
    planMaster(fixture(), event).changes.map((c) => c.cell),
    ["R6"],
  );
});
test("master refuses duplicates, unmatched companies and wrong dedicated mentor", () => {
  const duplicate = fixture();
  duplicate.rows.push(structuredClone(duplicate.rows[5]));
  assert.throws(() => planMaster(duplicate, event), /특정/);
  assert.throws(
    () => planMaster(fixture(), { ...event, company: "합성 기업" }),
    /특정/,
  );
  assert.throws(
    () => planMaster(fixture(), { ...event, mentor: "다른 멘토" }),
    /일치/,
  );
});
test("master rejects header drift, formulas, merges, malformed checkboxes and conflicting dates", () => {
  for (const patch of [
    { formula: "=TRUE()" },
    { merged: true },
    { checkbox: false },
    { value: "TRUE" },
  ]) {
    const g = fixture();
    Object.assign(g.rows[5][17], patch);
    assert.throws(() => planMaster(g, event));
  }
  const g = fixture();
  g.rows[4][17].value = "잘못된 열";
  assert.throws(() => planMaster(g, event), /양식/);
  const existing = fixture();
  existing.rows[5][18].value = 46000;
  assert.throws(
    () => planMaster(existing, { ...event, reportWrittenOn: "2026-09-16" }),
    /덮어쓰기/,
  );
});
test("same desired values produce no changes and overview reflects actual booleans", () => {
  const g = fixture();
  g.rows[5][17].value = true;
  assert.equal(planMaster(g, event).changes.length, 0);
  const view = masterOverview(g, "남부");
  assert.equal(view.totals.dedicated, 1);
  assert.equal(view.totals.missingReports, 1);
  g.rows[5][14].value = "TRUE";
  assert.equal(masterOverview(g).totals.dedicated, 1);
});
test("reversal restores only unchanged values written by the original plan", () => {
  const grid = fixture();
  const original = planMaster(grid, {
    ...event,
    reportWrittenOn: "2026-09-16",
    notes: "자동 반영 메모",
  });
  for (const change of original.changes)
    grid.rows[original.row - 1][change.column] = {
      ...grid.rows[original.row - 1][change.column],
      value: change.after,
    };

  const reversal = planMasterReversal(grid, original);
  assert.deepEqual(
    reversal.changes.map((change) => [change.cell, change.after]),
    [
      ["R6", false],
      ["S6", null],
      ["T6", null],
    ],
  );

  grid.rows[5][19].value = "운영자가 수정한 메모";
  assert.throws(
    () => planMasterReversal(grid, original),
    /자동 반영 후 값이 변경/,
  );
});
test("specialty uses AA/AB and does not mistake dedicated mentor for specialist", () => {
  const p = planMaster(fixture(), {
    ...event,
    kind: "특화",
    round: 1,
    mentor: "특화멘토",
    reportWrittenOn: "2026-09-16",
  });
  assert.deepEqual(
    p.changes.map((c) => c.cell),
    ["AA6", "AB6"],
  );
  assert.throws(() =>
    planMaster(fixture(), { ...event, kind: "특화", round: 2 }),
  );
});
test("event requires real date, evidence and explicit round; plan binds source version", () => {
  assert.equal(
    masterEventSchema.safeParse({ ...event, completedOn: "2026-02-30" })
      .success,
    false,
  );
  assert.equal(
    masterEventSchema.safeParse({ ...event, evidence: "" }).success,
    false,
  );
  assert.notEqual(
    planMaster(fixture(), event).planHash,
    planMaster({ ...fixture(), version: "v2" }, event).planHash,
  );
});
test("mentor role suffix is accepted but a different mentor is still rejected", () => {
  const grid = fixture();
  grid.rows[5][7].value = "합성담당자 멘토";
  assert.equal(
    planMaster(grid, { ...event, mentor: "합성담당자" }).changes.length,
    1,
  );
  assert.throws(
    () => planMaster(grid, { ...event, mentor: "다른담당자 멘토" }),
    /멘토가/,
  );
});

test("write reconciliation requires the exact sheet-scoped receipt", async () => {
  const { hasMasterReceipt, MASTER } =
    await import("../src/lib/automation/master");
  const receipt = {
    metadataKey: "axpm.master.event",
    metadataValue: "expected",
    location: { sheetId: MASTER.sheetId },
  };
  assert.equal(
    hasMasterReceipt(
      { sheets: [{ developerMetadata: [receipt] }] },
      "expected",
    ),
    true,
  );
  assert.equal(
    hasMasterReceipt({ sheets: [{ developerMetadata: [receipt] }] }, "other"),
    false,
  );
  assert.equal(
    hasMasterReceipt(
      { developerMetadata: [{ ...receipt, location: { sheetId: 123 } }] },
      "expected",
    ),
    false,
  );
  assert.equal(hasMasterReceipt({}, "expected"), false);
});

test("an existing completion with an empty report date fills only the date and does not double count", () => {
  const grid = fixture();
  grid.rows[5][23].value = true;
  assert.deepEqual(masterOverview(grid).companies[0].missingReportRounds, [4]);
  const desired = { ...event, round: 4, reportWrittenOn: "2026-09-17" };
  const plan = planMaster(grid, desired);
  assert.deepEqual(
    plan.changes.map((c) => c.cell),
    ["Y6"],
  );
  for (const change of plan.changes)
    grid.rows[5][change.column].value = change.after;
  assert.equal(planMaster(grid, desired).changes.length, 0);
  assert.deepEqual(masterOverview(grid).companies[0].completedRounds, [4]);
  assert.deepEqual(masterOverview(grid).companies[0].missingReportRounds, []);
  assert.equal(grid.rows[5][13].formula, "=O6+R6+U6+X6");
});

test("report dates receive a date format when the master cell is General", () => {
  const grid = fixture();
  delete grid.rows[5][24].numberFormat;
  const desired = { ...event, round: 4, reportWrittenOn: "2026-09-17" };
  const plan = planMaster(grid, desired);
  const dateChange = plan.changes.find((c) => c.cell === "Y6")!;
  assert.deepEqual(dateChange.numberFormat, { type: "DATE", pattern: "m/d" });
  for (const c of plan.changes) {
    grid.rows[5][c.column].value = c.after;
    if (c.numberFormat) grid.rows[5][c.column].numberFormat = c.numberFormat;
  }
  assert.equal(planMaster(grid, desired).changes.length, 0);
});
