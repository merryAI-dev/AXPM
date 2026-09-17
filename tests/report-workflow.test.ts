import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectSubmissions,
  reportWatchSchema,
  submissionState,
  type ReportSource,
  type ReportTab,
} from "../src/lib/automation/report-submission";
import { reportNamePlan, nameHints } from "../src/lib/automation/report-names";
const config = reportWatchSchema.parse({});
function tab(sectionStyle = false): ReportTab {
  const cells = Array.from({ length: 20 }, () => Array(8).fill(""));
  cells[2][1] = "기업명";
  cells[2][2] = "합성기업";
  cells[3][1] = "담당멘토";
  cells[3][2] = "합성멘토";
  cells[3][3] = "일시 및 장소";
  cells[3][4] = "- 일시 : 2026.04.28\n- 장소 : 남부캠퍼스 큰배움실";
  cells[4][1] = "참석자";
  cells[4][2] = "합성대표, 합성멘토";
  cells[5][1] = "멘토링 주제";
  cells[5][2] = "영업 전략 검토";
  cells[7][1] = sectionStyle
    ? "Section 1: 기업현황"
    : "1. 기업현황 (기업 현황, 이슈 등)";
  cells[8][1] = "매출 6000000원, 고객관리 업무를 검토했다.";
  cells[9][1] = sectionStyle
    ? "Section 2: 멘토링 내용"
    : "2. 멘토링 내용(논의 사항)";
  cells[10][1] = "고객 분류와 제안서 후속 연락 방안을 논의했다.";
  cells[11][1] = sectionStyle
    ? "Section 3: 다음 멘토링"
    : "3. 다음 멘토링 일정 및 논의 주제(안)";
  return { name: "1회차(2026.04.28)", cells, formulaCells: [] };
}
function source(t = tab()): ReportSource {
  return {
    id: "synthetic-source",
    name: "합성기업_멘토링보고서_공유.xlsx",
    version: "v1",
    tabs: [t],
  };
}
test("existing filled fields qualify without a submission marker in both actual section layouts", () => {
  for (const style of [false, true]) {
    const result = inspectSubmissions(source(tab(style)), config)[0];
    assert.deepEqual(result.issues, []);
    assert.equal(result.event?.campus, "남부캠퍼스");
    assert.equal(result.event?.round, 1);
    assert.equal(result.event?.completedOn, "2026-04-28");
    assert.equal(result.event?.reportWrittenOn, "2026-04-28");
  }
});
test("missing fields, copied sample content, future dates and canceled tabs are not ready", () => {
  for (const change of [
    (t: ReportTab) => {
      t.cells[4][2] = "";
    },
    (t: ReportTab) => {
      t.cells[10][1] = "내용내용내용내용";
    },
    (t: ReportTab) => {
      t.cells[3][4] = "2099.01.01 남부캠퍼스";
    },
    (t: ReportTab) => {
      t.name += " [취소]";
    },
  ]) {
    const t = tab();
    change(t);
    const result = inspectSubmissions(source(t), config)[0];
    assert.equal(result.event, null);
    assert.ok(result.issues.length);
  }
});
test("duplicate round tabs, hidden tabs and formula based reports do not auto apply", () => {
  const s = source();
  s.tabs.push({ ...tab(), name: "1회차 복사" });
  assert.ok(inspectSubmissions(s, config).every((r) => !r.event));
  const hidden = tab();
  hidden.hidden = true;
  assert.deepEqual(inspectSubmissions(source(hidden), config), []);
  const formula = tab();
  formula.formulaCells = ["C3"];
  assert.equal(inspectSubmissions(source(formula), config)[0].event, null);
});
test("complete fields are ready on the first read without a timer; edits revalidate immediately", () => {
  assert.equal(
    submissionState([], "a", "config", undefined, 100000).status,
    "ready",
  );
  const previous = {
    sourceHash: "a",
    configHash: "config",
    firstSeenAt: 100000,
  };
  assert.equal(
    submissionState([], "edited", "config", previous, 100001).status,
    "ready",
  );
  assert.equal(
    submissionState([], "edited", "config", previous, 100001).firstSeenAt,
    100001,
  );
  assert.equal(
    submissionState(["누락"], "a", "config", previous, 100001).status,
    "incomplete",
  );
});
test("tab date and explicit written date remain distinct from meeting date", () => {
  const t = tab();
  t.name = "1회차(2026.04.29)";
  let parsed = inspectSubmissions(source(t), config)[0];
  assert.equal(parsed.event?.completedOn, "2026-04-28");
  assert.equal(parsed.event?.reportWrittenOn, "2026-04-29");
  t.cells[14][1] = "보고서 작성일";
  t.cells[14][2] = "2026.04.30";
  parsed = inspectSubmissions(source(t), config)[0];
  assert.equal(parsed.event?.reportWrittenOn, "2026-04-30");
  t.cells[14][2] = "";
  assert.equal(inspectSubmissions(source(t), config)[0].event, null);
});
test("null placeholders, invalid or missing tab dates cannot mark completion", () => {
  for (const name of ["1회차", "1회차(2026.02.30)", "1회차(2099.01.01)"]) {
    const t = tab();
    t.name = name;
    assert.equal(inspectSubmissions(source(t), config)[0].event, null);
  }
  for (const value of [" ", "null", "undefined", "-"]) {
    const t = tab();
    t.cells[4][2] = value;
    assert.equal(inspectSubmissions(source(t), config)[0].event, null);
  }
});
const company = {
  row: 6,
  company: "주식회사 합성기업",
  campus: "남부캠퍼스",
  mentor: "합성멘토",
  completedRounds: [],
  specialtyComplete: false,
  missingReports: 0,
  missingReportRounds: [],
  unformattedReportRounds: [],
};
test("filename hints never establish identity alone; body and unique master determine canonical naming", () => {
  const plan = reportNamePlan(source(), [company], ".xlsx");
  assert.equal(plan.ready, true);
  assert.equal(
    plan.after,
    "[TestProgram] 남부캠퍼스_전담멘토링보고서_주식회사 합성기업.xlsx",
  );
  assert.equal(
    reportNamePlan(source(), [company, { ...company, row: 7 }], ".xlsx").ready,
    false,
  );
  const mismatch = source();
  mismatch.tabs[0].cells[2][2] = "없는 기업";
  assert.equal(reportNamePlan(mismatch, [company], ".xlsx").ready, false);
});
test("conflicting campus hints, inconsistent round identities and formulas block bulk rename", () => {
  const s = source();
  s.name = "(북부)합성기업_멘토링보고서.xlsx";
  assert.equal(reportNamePlan(s, [company], ".xlsx").ready, false);
  const inconsistent = source();
  const other = tab();
  other.name = "2회차";
  other.cells[2][2] = "다른기업";
  inconsistent.tabs.push(other);
  assert.equal(reportNamePlan(inconsistent, [company], ".xlsx").ready, false);
  assert.equal(
    nameHints("(남부)합성기업_멘토링보고서_공유.xlsx").campus,
    "남부",
  );
});

test("report scanner reads real XLSX merged cells and preserves the original bytes", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const { readReportSource } =
    await import("../src/lib/automation/report-source");
  const { XLSX } = await import("../src/lib/workspace/schema");
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("1회차(2026.04.28)");
  const fixture = tab();
  fixture.cells.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value) sheet.getCell(r + 1, c + 1).value = value;
    }),
  );
  sheet.mergeCells("B9:F9");
  sheet.mergeCells("B11:F11");
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const original = Buffer.from(bytes);
  let checked = false;
  const ws = {
    scoped: async () => ({
      id: "synthetic",
      name: "보고서.xlsx",
      version: "v1",
      mimeType: XLSX,
    }),
    port: { download: async () => bytes },
    expect: async (id: string, version: string) => {
      assert.equal(id, "synthetic");
      assert.equal(version, "v1");
      checked = true;
    },
  };
  const read = await readReportSource("synthetic", ws as never, "synthetic");
  assert.ok(checked);
  assert.deepEqual(bytes, original);
  assert.equal(read.tabs[0].cells[8][2], "");
  assert.deepEqual(inspectSubmissions(read, config)[0].issues, []);
});

test("report catalog follows pagination but excludes archive folders and shortcuts", async () => {
  const { reportCatalog } =
    await import("../src/lib/automation/report-catalog");
  const { FOLDER, SHEET, XLSX } = await import("../src/lib/workspace/schema");
  const visited: string[] = [];
  const ws = {
    list: async (id: string, token?: string) => {
      visited.push(`${id}:${token || ""}`);
      if (id === "root" && !token)
        return {
          files: [
            { id: "campus", name: "남부캠퍼스", mimeType: FOLDER },
            { id: "archive", name: "00_이전자료", mimeType: FOLDER },
          ],
          nextPageToken: "page2",
        };
      if (id === "root")
        return {
          files: [
            {
              id: "shortcut",
              name: "링크",
              mimeType: "application/vnd.google-apps.shortcut",
            },
          ],
          nextPageToken: "",
        };
      return {
        files: [
          { id: "b", name: "보고서.xlsx", mimeType: XLSX },
          { id: "a", name: "보고서", mimeType: SHEET },
        ],
        nextPageToken: "",
      };
    },
  };
  assert.deepEqual(
    (await reportCatalog(ws as never, "root")).map((f) => f.id),
    ["a", "b"],
  );
  assert.deepEqual(visited, ["root:", "root:page2", "campus:"]);
});

test("left-shifted mentor workbook retains source addresses and still blocks missing attendees", () => {
  const shifted = tab(true);
  shifted.cells = shifted.cells.map((row) => [...row.slice(1), ""]);
  const result = inspectSubmissions(source(shifted), config)[0];
  assert.deepEqual(result.issues, []);
  assert.match(result.event!.evidence, /기업 B3, 멘토 B4, 진행일 D4/);
  shifted.cells[4][1] = "";
  assert.equal(inspectSubmissions(source(shifted), config)[0].event, null);
});
