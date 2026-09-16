import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { importWorkbooks, monitor, type Input } from "../src/lib/importer";
import { fillTemplate, defaultMapping } from "../src/lib/template";
import { ticketResult } from "../src/lib/store";
import { encrypt, decrypt, spreadsheetId } from "../src/lib/google";
async function fixtures(): Promise<Input[]> {
  const master = new ExcelJS.Workbook();
  const s = master.addWorksheet("✴️전체 사업관리현황");
  const headers = {
    C5: "회사명",
    D5: "대표자",
    N5: "총 진행 멘토링회차",
    O5: "1회차",
    R5: "2회차",
    U5: "3회차",
    X5: "4회차",
    AA5: "전문특화멘토링 완료여부",
  };
  for (const [cell, value] of Object.entries(headers))
    s.getCell(cell).value = value;
  s.getCell("C6").value = "테스트기업";
  s.getCell("F6").value = "test@example.com";
  s.getCell("B6").value = "기존신청";
  s.getCell("O6").value = true;
  s.getCell("R6").value = "FALSE";
  s.getCell("N6").value = 2;
  s.getCell("AA6").value = true;
  s.getCell("C7").value = "불참기업";
  s.getCell("F7").value = "no@example.com";
  s.getCell("B7").value = "사업불참확정";
  const applications = new ExcelJS.Workbook();
  const a = applications.addWorksheet("특화_가상멘토");
  a.getCell("F3").value = "기업명";
  a.getCell("C5").value = new Date("2026-09-16T00:00:00Z");
  a.mergeCells("C5:C6");
  a.getCell("F6").value = "테스트기업";
  a.getCell("E6").value = "11:00~12:00";
  a.getCell("F6").font = { strike: true };
  a.getCell("F7").value = "테스트 기업의 다른 표기";
  a.getCell("E7").value = "12:00~13:00";
  const dedicated = new ExcelJS.Workbook();
  const d = dedicated.addWorksheet("캠퍼스_가상멘토");
  d.getCell("H6").value = "기업명";
  d.getCell("E6").value = "시간";
  d.getCell("L6").value = "비고 및 요청사항";
  d.getCell("C7").value = "2026. 9. 18(금)";
  d.mergeCells("C7:C8");
  d.getCell("H8").value = "테스트기업";
  d.getCell("F8").value = "14:00~15:00";
  return Promise.all(
    [
      { role: "mentor", w: master },
      { role: "applications", w: applications },
      { role: "dedicated", w: dedicated },
    ].map(async (x) => ({
      role: x.role as Input["role"],
      name: `${x.role}.xlsx`,
      buffer: Buffer.from(await x.w.xlsx.writeBuffer()),
    })),
  );
}
test("완료 체크 재집계, 보고서 누락, 취소선, 병합 날짜, 전담 변형 헤더를 구분한다", async () => {
  const data = await importWorkbooks(await fixtures());
  assert.equal(data.companies[0].regular, 1);
  assert.equal(data.companies[0].specialty, true);
  assert.equal(data.appointments[0].date, "2026-09-16");
  assert.equal(data.appointments[0].status, "review");
  assert.equal(data.appointments[1].date, "");
  assert.equal(data.appointments[1].companyId, null);
  assert.equal(data.appointments[2].kind, "dedicated");
  assert.equal(data.appointments[2].date, "2026-09-18");
  assert.equal(data.appointments[2].time, "14:00~15:00");
  assert.ok(data.findings.some((x) => x.title === "집계 불일치"));
  assert.ok(data.findings.some((x) => x.title === "보고서 기록 누락"));
  assert.ok(
    !monitor(data, 3, "2026-09-16").some(
      (x) =>
        x.title === "목표 대비 잔여" && x.companyId === data.companies[1].id,
    ),
  );
});
test("템플릿 매핑된 셀만 바꾸고 나머지 XML·스타일·병합을 보존한다", async () => {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("원본 보고서");
  for (const cell of Object.values(defaultMapping)) {
    s.getCell(cell).value = "원본 예시";
    s.getCell(cell).font = { bold: true, size: 12 };
  }
  s.mergeCells("B9:E9");
  s.getCell("B8").value = "1. 기업현황";
  s.pageSetup = { paperSize: 9, orientation: "portrait", printArea: "B1:E15" };
  const source = Buffer.from(await w.xlsx.writeBuffer());
  const fields = Object.fromEntries(
    Object.keys(defaultMapping).map((k) => [
      k,
      `${k}: <검증 & 값>\n두 번째 줄`,
    ]),
  );
  const output = await fillTemplate(source, s.name, defaultMapping, fields);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(output as never);
  for (const [field, cell] of Object.entries(defaultMapping)) {
    assert.equal(loaded.worksheets[0].getCell(cell).value, fields[field]);
    assert.equal(loaded.worksheets[0].getCell(cell).font.bold, true);
  }
  assert.equal(loaded.worksheets[0].getCell("B8").value, "1. 기업현황");
  assert.equal(loaded.worksheets[0].getCell("C9").master.address, "B9");
  const before = await JSZip.loadAsync(source),
    after = await JSZip.loadAsync(output);
  for (const name of Object.keys(before.files)) {
    if (name === "xl/worksheets/sheet1.xml") continue;
    assert.deepEqual(
      await before.files[name].async("nodebuffer"),
      await after.files[name].async("nodebuffer"),
      name,
    );
  }
  await assert.rejects(
    () =>
      fillTemplate(
        source,
        s.name,
        { ...defaultMapping, companyStatus: "C9" },
        fields,
      ),
    /첫 셀/,
  );
  await assert.rejects(
    () =>
      fillTemplate(
        source,
        s.name,
        { ...defaultMapping, company: "E3" },
        fields,
      ),
    /중복/,
  );
});
test("티켓 미설정·음수·시간 단위를 검증한다", () => {
  assert.throws(
    () => ticketResult(undefined, { ticketMode: "adjust", ticketDelta: 1 }),
    /기준/,
  );
  assert.deepEqual(
    ticketResult(undefined, {
      ticketMode: "set",
      ticketDelta: 3,
      hoursDelta: 1.5,
    }),
    { remainingTickets: 3, remainingHours: 1.5 },
  );
  assert.throws(
    () =>
      ticketResult(
        { remainingTickets: 1 },
        { ticketMode: "adjust", ticketDelta: -2 },
      ),
    /음수/,
  );
  assert.deepEqual(
    ticketResult(
      { remainingTickets: 3, remainingHours: 2 },
      { ticketMode: "adjust", ticketDelta: -1 },
    ),
    { remainingTickets: 2, remainingHours: 2 },
  );
});
test("병합 기업의 아래 행에 기록한 전담·특화 실적을 누락하지 않는다", async () => {
  const inputs = await fixtures();
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(inputs[0].buffer as never);
  const s = w.worksheets[0];
  s.mergeCells("C6:C7");
  s.getCell("R7").value = true;
  s.getCell("S7").value = new Date("2026-09-15");
  s.getCell("AA7").value = true;
  s.getCell("N6").value = 1;
  s.getCell("N7").value = 1;
  inputs[0].buffer = Buffer.from(await w.xlsx.writeBuffer());
  const data = await importWorkbooks(inputs);
  assert.equal(data.companies.length, 1);
  assert.equal(data.companies[0].regular, 2);
  assert.equal(data.companies[0].specialtyCount, 2);
  assert.ok(!data.findings.some((f) => f.title === "집계 불일치"));
});
test("파일 메타데이터 변경만으로 승인 근거 스냅샷을 무효화하지 않는다", async () => {
  const inputs = await fixtures();
  const first = await importWorkbooks(inputs);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(inputs[0].buffer as never);
  w.modified = new Date("2030-01-01");
  inputs[0].buffer = Buffer.from(await w.xlsx.writeBuffer());
  assert.equal((await importWorkbooks(inputs)).id, first.id);
});
test("OAuth 토큰 암호화와 무결성 검증", () => {
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  const saved = encrypt({ refresh_token: "synthetic-secret" });
  assert.equal(saved.includes("synthetic-secret"), false);
  assert.deepEqual(decrypt(saved), { refresh_token: "synthetic-secret" });
  const parts = saved.split(".");
  parts[2] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
test("Sheets URL에서 ID만 추출하고 다른 URL은 거부한다", () => {
  assert.equal(
    spreadsheetId(
      "https://docs.google.com/spreadsheets/d/abcdefghijklmnop/edit",
    ),
    "abcdefghijklmnop",
  );
  assert.throws(() => spreadsheetId("https://example.com/secret"));
});

test("native Sheets titles retain slashes and long names in evidence after Excel transport conversion", async () => {
  const input = await fixtures();
  const applications = input.find((i) => i.role === "applications")!;
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(applications.buffer as never);
  const original = "마케팅/브랜딩_성지영_아주 긴 실제 Google Sheets 탭 이름";
  w.worksheets[0].name = "AXPM_1";
  applications.buffer = Buffer.from(await w.xlsx.writeBuffer());
  applications.sheetNames = { AXPM_1: original };
  const result = await importWorkbooks(input);
  assert.ok(result.appointments.some((a) => a.mentor === original));
  assert.ok(
    result.evidence.some(
      (e) => e.source === "applications" && e.sheet === original,
    ),
  );
  assert.ok(!result.evidence.some((e) => e.sheet === "AXPM_1"));
});
